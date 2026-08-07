import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearCachedPlan,
  migrateLegacyDecisions,
  parseImportedPlan,
  readCachedPlan,
  saveCachedPlan,
} from "./persistence"
import type { PlanDraftState, Profile, Setting } from "../types"

// -----------------------------------------------------------------------
// In-memory localStorage stub (vitest runs this suite in a Node
// environment with no `window`/`localStorage`, so persistence.ts's calls
// to `window.localStorage` need a stand-in).
// -----------------------------------------------------------------------
class MemoryStorage implements Storage {
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal("window", { localStorage: storage })
})

const V2_KEY = "github-enterprise-settings-configurator.plan.v2"
const V1_KEY = "github-enterprise-settings-configurator.plan.v1"

const baseProfile: Profile = {
  deployment: "dotcom",
  basePlan: "enterprise",
  accountModel: "personal",
  authentication: "github",
  provisioning: "none",
  repositoryVisibility: "mixed",
  currentState: "greenfield",
  licensedProducts: {
    secretProtection: "licensed",
    codeSecurity: "licensed",
    codeQuality: "unlicensed",
    copilot: "business",
  },
  planningScope: { actions: true, audit: true },
}

const baseDraft: PlanDraftState = {
  profile: baseProfile,
  intent: { guardrailStrength: 1, rolloutPace: 2, operationalCapacity: 0 },
  priorities: ["secure-ghec", "copilot-cost"],
  selections: { "enterprise-type": "dotcom", "admin-redundancy": "three" },
  dormantSelections: { "security-configuration": "wave" },
  reviewed: { "admin-redundancy": true },
}

const setting = (id: string, choices = ["baseline-all", "wave", "opt-in"]): Setting => ({
  id,
  domain: "Code security",
  title: id,
  prompt: id,
  choices: choices.map((choice) => ({ id: choice, label: choice, description: choice })),
  recommended: choices[0],
  rationale: id,
  tradeoff: id,
  prerequisites: id,
  consequences: id,
  scope: id,
  role: id,
  applyMethod: id,
  influence: "Protective",
  rolloutBand: "Low",
  ongoingBand: "Low",
  sources: [],
})

describe("v2 cache roundtrip", () => {
  it("saves and restores a full draft, including dormant selections", () => {
    const saved = saveCachedPlan(baseDraft)
    expect(saved.ok).toBe(true)

    const read = readCachedPlan()
    expect(read.ok).toBe(true)
    if (!read.ok || !read.value) throw new Error("expected a cached draft")
    expect(read.value.migratedFromVersion).toBeNull()
    expect(read.value.notices).toEqual([])
    expect(read.value.state).toEqual(baseDraft)
  })

  it("returns null when nothing is cached", () => {
    const read = readCachedPlan()
    expect(read).toEqual({ ok: true, value: null })
  })

  it("clearCachedPlan removes both the v2 and legacy v1 keys", () => {
    saveCachedPlan(baseDraft)
    storage.setItem(V1_KEY, JSON.stringify({ version: 1, savedAt: "x", state: {} }))
    expect(storage.getItem(V2_KEY)).not.toBeNull()
    expect(storage.getItem(V1_KEY)).not.toBeNull()

    const cleared = clearCachedPlan()
    expect(cleared).toEqual({ ok: true, value: null })
    expect(storage.getItem(V2_KEY)).toBeNull()
    expect(storage.getItem(V1_KEY)).toBeNull()
  })

  it("fails to read a v2 cache entry with an unknown setting id", () => {
    storage.setItem(V2_KEY, JSON.stringify({
      version: 2,
      savedAt: "x",
      state: { ...baseDraft, selections: { "not-a-real-setting": "x" } },
    }))
    const read = readCachedPlan()
    expect(read.ok).toBe(false)
  })
})

describe("v2 export/import roundtrip", () => {
  it("imports a schemaVersion 2 export with settings + reviewedSettingIds", () => {
    const file = JSON.stringify({
      schemaVersion: 2,
      profile: baseProfile,
      intent: baseDraft.intent,
      priorities: baseDraft.priorities,
      settings: [
        { id: "enterprise-type", selected: "dotcom" },
        { id: "admin-redundancy", selected: "three" },
      ],
      dormantSettings: [{ id: "security-configuration", selected: "wave" }],
      reviewedSettingIds: ["admin-redundancy"],
    })

    const result = parseImportedPlan(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.migratedFromVersion).toBeNull()
    expect(result.value.notices).toEqual([])
    expect(result.value.usedDefaultIntent).toBe(false)
    expect(result.value.restoredReviewState).toBe(true)
    expect(result.value.state).toEqual(baseDraft)
  })

  it("still fails on an unknown v2 setting or choice (no legacy leniency)", () => {
    const unknownSetting = JSON.stringify({
      schemaVersion: 2,
      profile: baseProfile,
      settings: [{ id: "not-a-real-setting", selected: "x" }],
    })
    expect(parseImportedPlan(unknownSetting).ok).toBe(false)

    const unknownChoice = JSON.stringify({
      schemaVersion: 2,
      profile: baseProfile,
      settings: [{ id: "enterprise-type", selected: "not-a-real-choice" }],
    })
    expect(parseImportedPlan(unknownChoice).ok).toBe(false)
  })
})

describe("v1 cache migration", () => {
  it("migrates a legacy GHES envelope, preserving valid selections and dropping stale ones", () => {
    storage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      savedAt: "2023-01-01T00:00:00.000Z",
      state: {
        profile: {
          platform: "ghes",
          identity: "personal",
          entitlement: "enterprise",
          currentState: "existing",
          products: { actions: true, security: true, copilot: true, audit: false },
        },
        intent: { guardrailStrength: 2, rolloutPace: 1, operationalCapacity: 1 },
        priorities: ["secure-ghec"],
        selections: {
          "enterprise-type": "ghes",
          "admin-redundancy": "three",
          "old-removed-setting": "some-choice",
        },
        reviewed: {
          "enterprise-type": true,
          "admin-redundancy": true,
          "old-removed-setting": true,
        },
      },
    }))

    const read = readCachedPlan()
    expect(read.ok).toBe(true)
    if (!read.ok || !read.value) throw new Error("expected a migrated draft")

    expect(read.value.migratedFromVersion).toBe(1)
    expect(read.value.state.profile).toMatchObject({
      deployment: "ghes",
      basePlan: "enterprise",
      accountModel: "instance",
      authentication: "unknown",
      provisioning: "unknown",
      repositoryVisibility: "unknown",
      currentState: "existing",
      licensedProducts: {
        secretProtection: "unknown",
        codeSecurity: "unknown",
        codeQuality: "unlicensed",
        copilot: "unknown",
      },
      planningScope: { actions: true, audit: false },
    })

    // Preserved, unchanged selections keep their prior review state.
    expect(read.value.state.selections).toEqual({ "enterprise-type": "ghes", "admin-redundancy": "three" })
    expect(read.value.state.reviewed).toEqual({ "enterprise-type": true, "admin-redundancy": true })

    // Stale/removed legacy settings become dormant instead of failing, and lose review state.
    expect(read.value.state.dormantSelections).toEqual({ "old-removed-setting": "some-choice" })
    expect(read.value.state.reviewed["old-removed-setting"]).toBeUndefined()

    const codes = read.value.notices.map((notice) => notice.code)
    expect(codes).toContain("legacy-ghes-identity-unknown")
    expect(codes).toContain("legacy-repository-visibility-unknown")
    expect(codes).toContain("legacy-security-license-unknown")
    expect(codes).toContain("legacy-copilot-plan-unknown")
    expect(codes).toContain("dormant-legacy-old-removed-setting")
    expect(codes).not.toContain("legacy-base-plan-unknown")
  })

  it("fails to read a malformed legacy cache entry", () => {
    storage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      savedAt: "x",
      state: { profile: { platform: "not-a-platform" } },
    }))
    const read = readCachedPlan()
    expect(read.ok).toBe(false)
  })

  it("normalizes a legacy GHE.com personal-account profile to required managed users", () => {
    storage.setItem(V1_KEY, JSON.stringify({
      version: 1,
      savedAt: "2023-01-01T00:00:00.000Z",
      state: {
        profile: {
          platform: "residency",
          identity: "personal",
          entitlement: "enterprise",
          currentState: "existing",
          products: { actions: true, security: false, copilot: false, audit: true },
        },
        intent: { guardrailStrength: 1, rolloutPace: 1, operationalCapacity: 1 },
        priorities: [],
        selections: {},
        reviewed: {},
      },
    }))

    const read = readCachedPlan()
    expect(read.ok).toBe(true)
    if (!read.ok || !read.value) throw new Error("expected a migrated draft")
    expect(read.value.state.profile).toMatchObject({
      deployment: "residency",
      accountModel: "managed",
      authentication: "unknown",
      provisioning: "scim",
    })
    expect(read.value.notices.map((notice) => notice.code)).toContain("legacy-residency-emu-required")
  })
})

describe("v1 export migration and Copilot/security ambiguity", () => {
  it("maps security true / copilot true to unknown licensing", () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      profile: {
        platform: "dotcom",
        identity: "personal",
        entitlement: "enterprise",
        currentState: "greenfield",
        products: { actions: true, security: true, copilot: true, audit: true },
      },
      intent: { guardrailStrength: 1, rolloutPace: 1, operationalCapacity: 1 },
      priorities: [],
      settings: [{ id: "enterprise-type", selected: "dotcom" }],
      reviewedSettingIds: ["enterprise-type"],
    })

    const result = parseImportedPlan(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.migratedFromVersion).toBe(1)
    expect(result.value.state.profile.licensedProducts).toEqual({
      secretProtection: "unknown",
      codeSecurity: "unknown",
      codeQuality: "unlicensed",
      copilot: "unknown",
    })
    const codes = result.value.notices.map((notice) => notice.code)
    expect(codes).toContain("legacy-security-license-unknown")
    expect(codes).toContain("legacy-copilot-plan-unknown")
  })

  it("maps security false / copilot false to unlicensed/none with no ambiguity notices, and defaults intent/review when absent", () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      profile: {
        platform: "dotcom",
        identity: "emu",
        entitlement: "copilot",
        currentState: "migration",
        products: { actions: false, security: false, copilot: false, audit: true },
      },
      priorities: ["emu-entra"],
      settings: [
        { id: "enterprise-type", selected: "dotcom" },
        { id: "admin-redundancy", selected: "two" },
      ],
    })

    const result = parseImportedPlan(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.migratedFromVersion).toBe(1)
    expect(result.value.usedDefaultIntent).toBe(true)
    expect(result.value.state.intent).toEqual({ guardrailStrength: 1, rolloutPace: 1, operationalCapacity: 1 })
    expect(result.value.restoredReviewState).toBe(false)
    expect(result.value.state.reviewed).toEqual({})

    expect(result.value.state.profile).toMatchObject({
      deployment: "dotcom",
      basePlan: "unknown",
      accountModel: "managed",
      authentication: "unknown",
      provisioning: "scim",
      repositoryVisibility: "unknown",
      licensedProducts: {
        secretProtection: "unlicensed",
        codeSecurity: "unlicensed",
        codeQuality: "unlicensed",
        copilot: "none",
      },
      planningScope: { actions: false, audit: true },
    })

    const codes = result.value.notices.map((notice) => notice.code)
    expect(codes).toContain("legacy-base-plan-unknown")
    expect(codes).toContain("legacy-emu-authentication-unknown")
    expect(codes).not.toContain("legacy-security-license-unknown")
    expect(codes).not.toContain("legacy-copilot-plan-unknown")
  })

  it("treats a schemaVersion-less export the same as schemaVersion 1", () => {
    const file = JSON.stringify({
      profile: {
        platform: "residency",
        identity: "emu",
        entitlement: "enterprise",
        currentState: "greenfield",
        products: { actions: true, security: false, copilot: false, audit: true },
      },
      settings: [{ id: "enterprise-type", selected: "residency" }],
    })
    const result = parseImportedPlan(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.migratedFromVersion).toBe(1)
    expect(result.value.state.profile.deployment).toBe("residency")
  })
})

describe("malformed and future versions", () => {
  it("fails on invalid JSON", () => {
    expect(parseImportedPlan("{ not json").ok).toBe(false)
  })

  it("fails on a future cache envelope version", () => {
    const file = JSON.stringify({ version: 3, savedAt: "x", state: {} })
    expect(parseImportedPlan(file).ok).toBe(false)
  })

  it("fails on a future export schemaVersion", () => {
    const file = JSON.stringify({ schemaVersion: 99, profile: baseProfile })
    expect(parseImportedPlan(file).ok).toBe(false)
  })

  it("fails on a structurally malformed legacy profile", () => {
    const file = JSON.stringify({
      schemaVersion: 1,
      profile: { platform: "dotcom" },
      settings: [],
    })
    expect(parseImportedPlan(file).ok).toBe(false)
  })

  it("fails to read an unparsable v2 cache entry", () => {
    storage.setItem(V2_KEY, "{ not json")
    expect(readCachedPlan().ok).toBe(false)
  })
})

describe("migrateLegacyDecisions: split mapping and review invalidation", () => {
  it("preserves an unchanged selection's prior review state when the setting still exists", () => {
    const unsplitCatalog = new Map<string, Setting>([["still-current-setting", setting("still-current-setting")]])

    const result = migrateLegacyDecisions(
      [["still-current-setting", "wave"]],
      new Set(["still-current-setting"]),
      unsplitCatalog,
    )
    expect(result.selections).toEqual({ "still-current-setting": "wave" })
    expect(result.reviewed).toEqual({ "still-current-setting": true })
    expect(result.dormantSelections).toEqual({})
    expect(result.notices).toEqual([])
  })

  it("splits a legacy setting into new catalog ids and clears review when both split ids exist", () => {
    const splitCatalog = new Map<string, Setting>([
      ["secret-protection-configuration", setting("secret-protection-configuration")],
      ["code-security-configuration", setting("code-security-configuration")],
    ])

    const result = migrateLegacyDecisions(
      [["security-configuration", "wave"]],
      new Set(["security-configuration"]),
      splitCatalog,
    )

    expect(result.selections).toEqual({
      "secret-protection-configuration": "wave",
      "code-security-configuration": "wave",
    })
    expect(result.reviewed).toEqual({})
    expect(result.dormantSelections).toEqual({})
    expect(result.notices).toEqual([{
      code: "security-configuration-split",
      message: "The legacy Security configuration setting was split into Secret Protection and Code Security configurations; review the migrated choices.",
    }])
  })

  it("falls back to dormant when the legacy choice has no match in either split setting", () => {
    const splitCatalog = new Map<string, Setting>([
      ["secret-protection-configuration", setting("secret-protection-configuration", ["a", "b"])],
      ["code-security-configuration", setting("code-security-configuration", ["a", "b"])],
    ])

    const result = migrateLegacyDecisions(
      [["security-configuration", "legacy-only-choice"]],
      new Set(),
      splitCatalog,
    )

    expect(result.selections).toEqual({})
    expect(result.dormantSelections).toEqual({ "security-configuration": "legacy-only-choice" })
    expect(result.notices[0]?.code).toBe("dormant-legacy-security-configuration")
  })

  it("never marks a stale/removed setting as reviewed, even if it was previously reviewed", () => {
    const result = migrateLegacyDecisions(
      [["fully-removed-setting", "x"]],
      new Set(["fully-removed-setting"]),
    )
    expect(result.selections).toEqual({})
    expect(result.dormantSelections).toEqual({ "fully-removed-setting": "x" })
    expect(result.reviewed).toEqual({})
  })
})
