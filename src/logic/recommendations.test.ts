import { describe, expect, it } from "vitest"
import { getProfileWarnings, getRecommendedSettings, isProfileValid } from "./recommendations"
import { identityCompatibilityMatrix, resolveProfile } from "./capabilities"
import { defaultProfile } from "./profile"
import { defaultIntent } from "./intent"
import type { IntentLevel, LicenseStatus, Plan, PlanIntent, PriorityId, Profile } from "../types"

const profileFor = (
  combination: (typeof identityCompatibilityMatrix)[number],
  overrides: Partial<Profile> = {},
): Profile => ({
  ...defaultProfile,
  ...combination,
  repositoryVisibility: combination.deployment === "residency" ? "private-internal" : "mixed",
  licensedProducts: { ...defaultProfile.licensedProducts },
  planningScope: { ...defaultProfile.planningScope },
  ...overrides,
})

const planFor = (
  profile: Profile,
  overrides: Partial<Omit<Plan, "profile">> = {},
): Plan => ({
  profile,
  intent: overrides.intent ?? { ...defaultIntent },
  priorities: overrides.priorities ?? [],
  selections: overrides.selections ?? {},
})

const intentLevels: IntentLevel[] = [0, 1, 2]
const licenseStatuses: Exclude<LicenseStatus, "unknown">[] = ["unlicensed", "licensed"]
const priorityOptionsUnderTest: PriorityId[] = [
  "secure-ghec",
  "emu-entra",
  "regulated-overlay",
  "copilot-cost",
  "security-rollout",
  "migration-ready",
]

const extremeIntents: PlanIntent[] = []
for (const guardrailStrength of intentLevels) {
  for (const rolloutPace of intentLevels) {
    for (const operationalCapacity of intentLevels) {
      extremeIntents.push({ guardrailStrength, rolloutPace, operationalCapacity })
    }
  }
}

describe("recommendation choice validity", () => {
  it.each(identityCompatibilityMatrix)(
    "keeps recommended and selected within the available choices for $deployment/$basePlan/$accountModel/$authentication/$provisioning",
    (combination) => {
      const profile = profileFor(combination)
      for (const intent of [extremeIntents[0], extremeIntents[extremeIntents.length - 1], defaultIntent]) {
        for (const priorities of [[], priorityOptionsUnderTest]) {
          const plan = planFor(profile, { intent, priorities })
          const recommendedSettings = getRecommendedSettings(plan)
          for (const entry of recommendedSettings) {
            const availableIds = entry.setting.choices.map((choice) => choice.id)
            expect(availableIds, `${entry.setting.id} recommended`).toContain(entry.recommended)
            expect(availableIds, `${entry.setting.id} selected`).toContain(entry.selected)
          }
        }
      }
    },
  )

  it("falls back to selected/recommended when a stored selection is no longer available", () => {
    const profile = profileFor(
      identityCompatibilityMatrix.find((entry) => entry.deployment === "dotcom" && entry.accountModel === "personal")!,
    )
    const plan = planFor(profile, { selections: { "identity-lifecycle": "ghes-ldap" } })
    const entry = getRecommendedSettings(plan).find((item) => item.setting.id === "identity-lifecycle")
    expect(entry?.selected).toBe(entry?.recommended)
    expect(entry?.disposition).toBe("Recommended")
  })

  it("never returns a disposition other than Recommended or Override", () => {
    const plan = planFor(defaultProfile)
    for (const entry of getRecommendedSettings(plan)) {
      expect(["Recommended", "Override"]).toContain(entry.disposition)
    }
  })

  it.each(identityCompatibilityMatrix)(
    "exposes exactly one derived identity lifecycle for $deployment/$basePlan/$accountModel/$authentication/$provisioning",
    (combination) => {
      const entry = getRecommendedSettings(planFor(profileFor(combination)))
        .find((item) => item.setting.id === "identity-lifecycle")
      expect(entry?.setting.choices).toHaveLength(1)
      expect(entry?.selected).toBe(entry?.recommended)
    },
  )

  it("ignores stored overrides for derived settings", () => {
    const profile = profileFor(
      identityCompatibilityMatrix.find((entry) => entry.deployment === "ghes" && entry.authentication === "built-in")!,
    )
    const entries = getRecommendedSettings(planFor(profile, {
      selections: {
        "enterprise-type": "dotcom",
        "identity-lifecycle": "ghes-cas",
      },
    }))
    expect(entries.find((entry) => entry.setting.id === "enterprise-type")).toMatchObject({
      selected: "ghes",
      recommended: "ghes",
      disposition: "Recommended",
    })
    expect(entries.find((entry) => entry.setting.id === "identity-lifecycle")).toMatchObject({
      selected: "ghes-built-in",
      recommended: "ghes-built-in",
      disposition: "Recommended",
    })
  })

  it("omits settings with no compatible choices while migration fields remain unresolved", () => {
    const settings = getRecommendedSettings(planFor({
      ...defaultProfile,
      accountModel: "unknown",
      authentication: "unknown",
      provisioning: "unknown",
    }))
    expect(settings.some((entry) => entry.setting.id === "identity-lifecycle")).toBe(false)
  })
})

describe("independent Secret Protection and Code Security toggles", () => {
  const basePrivateProfile: Profile = {
    ...defaultProfile,
    repositoryVisibility: "private-internal",
  }

  it("exposes Secret Protection settings without licensing Code Security", () => {
    const profile: Profile = {
      ...basePrivateProfile,
      licensedProducts: {
        ...basePrivateProfile.licensedProducts,
        secretProtection: "licensed",
        codeSecurity: "unlicensed",
      },
    }
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).toContain("secret-protection-configuration")
    expect(ids).toContain("secret-scanning-push-protection")
    expect(ids).not.toContain("code-security-configuration")
    expect(ids).not.toContain("code-scanning-setup")
    expect(ids).not.toContain("premium-dependabot")
  })

  it("exposes Code Security settings without licensing Secret Protection", () => {
    const profile: Profile = {
      ...basePrivateProfile,
      licensedProducts: {
        ...basePrivateProfile.licensedProducts,
        secretProtection: "unlicensed",
        codeSecurity: "licensed",
      },
    }
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).toContain("code-security-configuration")
    expect(ids).toContain("code-scanning-setup")
    expect(ids).toContain("premium-dependabot")
    expect(ids).not.toContain("secret-protection-configuration")
    expect(ids).not.toContain("secret-scanning-push-protection")
  })

  it("exposes neither paid configuration without either license on a private/internal estate", () => {
    const profile: Profile = { ...basePrivateProfile }
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).not.toContain("secret-protection-configuration")
    expect(ids).not.toContain("code-security-configuration")
    expect(ids).not.toContain("premium-dependabot")
  })
})

describe("base dependency coverage availability", () => {
  it.each([
    ["unlicensed", "unlicensed"],
    ["licensed", "unlicensed"],
    ["unlicensed", "licensed"],
    ["licensed", "licensed"],
  ] as const)(
    "keeps dependency-coverage available regardless of paid license state (%s secretProtection, %s codeSecurity)",
    (secretProtection, codeSecurity) => {
      const profile: Profile = {
        ...defaultProfile,
        repositoryVisibility: "private-internal",
        licensedProducts: { ...defaultProfile.licensedProducts, secretProtection, codeSecurity },
      }
      const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
      expect(ids).toContain("dependency-coverage")
    },
  )

  it.each(licenseStatuses)("keeps dependency-coverage's own choices constant (%s)", (secretProtection) => {
    const profile: Profile = {
      ...defaultProfile,
      repositoryVisibility: "private-internal",
      licensedProducts: { ...defaultProfile.licensedProducts, secretProtection },
    }
    const entry = getRecommendedSettings(planFor(profile)).find((item) => item.setting.id === "dependency-coverage")
    expect(entry?.setting.choices.map((choice) => choice.id)).toEqual([
      "graph-alerts-updates",
      "graph-alerts",
      "graph-only",
    ])
  })
})

describe("hard constraints resist intent tuning", () => {
  const derivedSettingIds = ["enterprise-type", "identity-lifecycle"]

  it.each(identityCompatibilityMatrix)(
    "keeps derived settings fixed across every intent extreme for $deployment/$basePlan/$accountModel/$authentication/$provisioning",
    (combination) => {
      const profile = profileFor(combination)
      const recommendations = extremeIntents.map((intent) =>
        getRecommendedSettings(planFor(profile, { intent })))

      for (const settingId of derivedSettingIds) {
        const values = recommendations.map((entries) =>
          entries.find((entry) => entry.setting.id === settingId)?.recommended)
        expect(new Set(values).size, settingId).toBe(1)
      }
    },
  )

  it("never lets intent tuning select a choice outside the profile's availability for identity-lifecycle", () => {
    const combination = identityCompatibilityMatrix.find((entry) => entry.deployment === "ghes")!
    const profile = profileFor(combination)
    for (const intent of extremeIntents) {
      const entry = getRecommendedSettings(planFor(profile, { intent }))
        .find((item) => item.setting.id === "identity-lifecycle")!
      expect(entry.recommended).toBe("ghes-built-in")
    }
  })

  it("keeps priority-driven overrides within the filtered choices for every combination", () => {
    for (const combination of identityCompatibilityMatrix) {
      const profile = profileFor(combination, {
        licensedProducts: {
          ...defaultProfile.licensedProducts,
          secretProtection: "licensed",
          codeSecurity: "licensed",
        },
      })
      const plan = planFor(profile, { priorities: ["security-rollout", "regulated-overlay", "copilot-cost", "migration-ready"] })
      for (const entry of getRecommendedSettings(plan)) {
        const availableIds = entry.setting.choices.map((choice) => choice.id)
        expect(availableIds, entry.setting.id).toContain(entry.recommended)
      }
    }
  })
})

describe("Team, GHES, and GHE.com constraints", () => {
  it("excludes enterprise-only governance settings for Team base plan", () => {
    const teamCombination = identityCompatibilityMatrix.find((entry) => entry.basePlan === "team")!
    const profile = profileFor(teamCombination)
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).not.toContain("admin-redundancy")
    expect(ids).not.toContain("verified-domains")
    expect(ids).not.toContain("default-repo-permission")
    expect(ids).not.toContain("member-repo-creation")
    expect(ids).not.toContain("default-branch-ruleset")
    expect(ids).not.toContain("outside-collaborators")
  })

  it("includes enterprise-only governance settings for an Enterprise base plan", () => {
    const enterpriseCombination = identityCompatibilityMatrix.find(
      (entry) => entry.basePlan === "enterprise" && entry.deployment === "dotcom",
    )!
    const profile = profileFor(enterpriseCombination)
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).toContain("admin-redundancy")
    expect(ids).toContain("verified-domains")
    expect(ids).toContain("default-repo-permission")
  })

  it("keeps Actions, audit, and Copilot domains available for Team plans without an enterprise-account gate", () => {
    const teamCombination = identityCompatibilityMatrix.find((entry) => entry.basePlan === "team")!
    const profile = profileFor(teamCombination, {
      planningScope: { actions: true, audit: true },
      licensedProducts: { ...defaultProfile.licensedProducts, copilot: "business" },
    })
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids).toContain("allowed-actions")
    expect(ids).toContain("workflow-token")
    expect(ids).toContain("runner-network")
    expect(ids).toContain("copilot-license-topology")
  })

  it("resolves every GHES identity combination to the matching lifecycle choice", () => {
    const expectedByAuthentication: Record<string, string> = {
      "built-in": "ghes-built-in",
      saml: "ghes-saml-jit",
      ldap: "ghes-ldap",
      cas: "ghes-cas",
    }
    for (const combination of identityCompatibilityMatrix.filter((entry) => entry.deployment === "ghes")) {
      const profile = profileFor(combination)
      const entry = getRecommendedSettings(planFor(profile))
        .find((item) => item.setting.id === "identity-lifecycle")!
      const expected = combination.authentication === "saml" && combination.provisioning === "scim"
        ? "ghes-saml-scim-preview"
        : expectedByAuthentication[combination.authentication]
      expect(entry.recommended).toBe(expected)
    }
  })

  it("flags GHES SAML+SCIM as a preview-only warning, not an error", () => {
    const combination = identityCompatibilityMatrix.find(
      (entry) => entry.deployment === "ghes" && entry.authentication === "saml" && entry.provisioning === "scim",
    )!
    const profile = profileFor(combination)
    expect(isProfileValid(profile)).toBe(true)
    expect(getProfileWarnings(profile).some((message) => message.toLowerCase().includes("public preview"))).toBe(true)
  })

  it("excludes Code Quality settings on GHE.com data residency even when the license flag is set", () => {
    const combination = identityCompatibilityMatrix.find((entry) => entry.deployment === "residency")!
    const profile = profileFor(combination, {
      planningScope: { actions: true, audit: true },
    })
    expect(resolveProfile(profile).capabilities.has("code-quality")).toBe(false)
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids.some((id) => id.startsWith("code-quality"))).toBe(false)
  })

  it("excludes Code Quality settings on GHES even when the license flag is set", () => {
    const combination = identityCompatibilityMatrix.find((entry) => entry.deployment === "ghes")!
    const profile = profileFor(combination, {
      planningScope: { actions: true, audit: true },
    })
    expect(resolveProfile(profile).capabilities.has("code-quality")).toBe(false)
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids.some((id) => id.startsWith("code-quality"))).toBe(false)
  })
})

describe("Code Quality support", () => {
  const codeQualitySettingIds = [
    "code-quality-targeting",
    "code-quality-setup-findings",
    "code-quality-coverage",
    "code-quality-merge-gates",
  ]

  it("includes every Code Quality setting for a licensed dotcom profile with actions planning", () => {
    const combination = identityCompatibilityMatrix.find(
      (entry) => entry.deployment === "dotcom" && entry.basePlan === "enterprise",
    )!
    const profile = profileFor(combination, {
      planningScope: { actions: true, audit: true },
      licensedProducts: { ...defaultProfile.licensedProducts, codeQuality: "licensed" },
    })
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    for (const settingId of codeQualitySettingIds) {
      expect(ids, settingId).toContain(settingId)
    }
  })

  it("excludes Code Quality settings when the license is not set", () => {
    const combination = identityCompatibilityMatrix.find(
      (entry) => entry.deployment === "dotcom" && entry.basePlan === "enterprise",
    )!
    const profile = profileFor(combination, {
      planningScope: { actions: true, audit: true },
      licensedProducts: { ...defaultProfile.licensedProducts, codeQuality: "unlicensed" },
    })
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids.some((id) => codeQualitySettingIds.includes(id))).toBe(false)
  })

  it("excludes Code Quality settings when the Actions planning scope is off, even if licensed", () => {
    const combination = identityCompatibilityMatrix.find(
      (entry) => entry.deployment === "dotcom" && entry.basePlan === "enterprise",
    )!
    const profile = profileFor(combination, {
      planningScope: { actions: false, audit: true },
      licensedProducts: { ...defaultProfile.licensedProducts, codeQuality: "licensed" },
    })
    expect(resolveProfile(profile).capabilities.has("code-quality")).toBe(false)
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    expect(ids.some((id) => codeQualitySettingIds.includes(id))).toBe(false)
  })

  it("works for Team-plan dotcom profiles too, since Code Quality is not enterprise-gated", () => {
    const combination = identityCompatibilityMatrix.find((entry) => entry.basePlan === "team")!
    const profile = profileFor(combination, {
      planningScope: { actions: true, audit: true },
      licensedProducts: { ...defaultProfile.licensedProducts, codeQuality: "licensed" },
    })
    const ids = getRecommendedSettings(planFor(profile)).map((entry) => entry.setting.id)
    for (const settingId of codeQualitySettingIds) {
      expect(ids, settingId).toContain(settingId)
    }
  })
})

describe("getProfileWarnings / isProfileValid wrappers", () => {
  it("stays valid and warning-free for the default profile", () => {
    expect(isProfileValid(defaultProfile)).toBe(true)
    expect(getProfileWarnings(defaultProfile)).toEqual([])
  })

  it("reports an error-derived warning for an unresolved profile field", () => {
    const profile: Profile = { ...defaultProfile, basePlan: "unknown" }
    expect(isProfileValid(profile)).toBe(false)
    expect(getProfileWarnings(profile).length).toBeGreaterThan(0)
  })
})
