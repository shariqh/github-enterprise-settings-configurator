import { describe, expect, it } from "vitest"
import { catalog, priorityOptions } from "./catalog"
import type { CapabilityId, CapabilityRequirement, Domain, PriorityId, SourceTier } from "./types"

const domains: Domain[] = [
  "Identity & administration",
  "Organization & repository governance",
  "Code security",
  "Code quality",
  "Actions & supply chain",
  "Audit visibility",
  "Copilot governance",
  "Copilot cost controls",
]

const priorityIds: PriorityId[] = [
  "secure-ghec",
  "emu-entra",
  "regulated-overlay",
  "copilot-cost",
  "security-rollout",
  "migration-ready",
]

const sourceTiers: SourceTier[] = [
  "GitHub Docs · mechanics",
  "Well-Architected · principles",
  "Worked example · adaptable",
  "Automation adapter · execution",
]

const capabilityIds: CapabilityId[] = [
  "enterprise-account",
  "internal-repositories",
  "managed-users",
  "personal-accounts",
  "instance-accounts",
  "enterprise-saml",
  "oidc",
  "built-in-authentication",
  "cas-authentication",
  "scim",
  "scim-access",
  "jit-provisioning",
  "ldap-lifecycle",
  "first-sign-in-provisioning",
  "manual-provisioning",
  "ghes-scim-preview",
  "actions",
  "actions-planning",
  "organization-audit",
  "enterprise-audit",
  "audit-planning",
  "dependency-graph",
  "dependabot-alerts",
  "public-repository-security",
  "secret-scanning",
  "secret-protection",
  "code-scanning",
  "code-security",
  "code-quality",
  "copilot-business",
  "copilot-enterprise",
]

const requirementCapabilities = (requirement?: CapabilityRequirement) => [
  ...(requirement?.allOf ?? []),
  ...(requirement?.anyOf ?? []),
  ...(requirement?.noneOf ?? []),
]

describe("catalog data integrity", () => {
  it("has at least one setting", () => {
    expect(catalog.length).toBeGreaterThan(0)
  })

  it("has unique setting ids", () => {
    const ids = catalog.map((setting) => setting.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("assigns every setting to a known domain", () => {
    for (const setting of catalog) {
      expect(domains, setting.id).toContain(setting.domain)
    }
  })

  it("gives every setting at least two choices", () => {
    for (const setting of catalog) {
      expect(setting.choices.length, setting.id).toBeGreaterThanOrEqual(2)
    }
  })

  it("gives every setting unique choice ids", () => {
    for (const setting of catalog) {
      const choiceIds = setting.choices.map((choice) => choice.id)
      expect(new Set(choiceIds).size, setting.id).toBe(choiceIds.length)
    }
  })

  it("has a recommended choice that is one of the setting's own choices", () => {
    for (const setting of catalog) {
      const choiceIds = setting.choices.map((choice) => choice.id)
      expect(choiceIds, setting.id).toContain(setting.recommended)
    }
  })

  it("gives every choice non-empty label and description text", () => {
    for (const setting of catalog) {
      for (const choice of setting.choices) {
        expect(choice.label.length, `${setting.id}/${choice.id}`).toBeGreaterThan(0)
        expect(choice.description.length, `${setting.id}/${choice.id}`).toBeGreaterThan(0)
      }
    }
  })

  it("gives every setting non-empty narrative fields", () => {
    for (const setting of catalog) {
      for (const field of ["rationale", "tradeoff", "prerequisites", "consequences", "scope", "role", "applyMethod"] as const) {
        expect(setting[field].length, `${setting.id}.${field}`).toBeGreaterThan(0)
      }
    }
  })

  it("gives every setting at least one source with a valid tier and URL", () => {
    for (const setting of catalog) {
      expect(setting.sources.length, setting.id).toBeGreaterThan(0)
      for (const source of setting.sources) {
        expect(sourceTiers, `${setting.id} source ${source.label}`).toContain(source.tier)
        expect(source.url, `${setting.id} source ${source.label}`).toMatch(/^https:\/\//)
        expect(source.label.length, setting.id).toBeGreaterThan(0)
      }
    }
  })

  it("only uses known capability ids in setting and choice availability requirements", () => {
    for (const setting of catalog) {
      for (const capability of requirementCapabilities(setting.availability)) {
        expect(capabilityIds, `${setting.id} availability`).toContain(capability)
      }
      for (const choice of setting.choices) {
        for (const capability of requirementCapabilities(choice.availability)) {
          expect(capabilityIds, `${setting.id}/${choice.id} availability`).toContain(capability)
        }
      }
    }
  })

  it("keys effortByChoice only by ids that exist among the setting's choices", () => {
    for (const setting of catalog) {
      if (!setting.effortByChoice) continue
      const choiceIds = new Set(setting.choices.map((choice) => choice.id))
      for (const key of Object.keys(setting.effortByChoice)) {
        expect(choiceIds, setting.id).toContain(key)
      }
    }
  })

  it("only assigns postureWeight 0 to non-foundational, contextual decisions", () => {
    for (const setting of catalog) {
      if (setting.postureWeight === 0) {
        expect(setting.foundational, setting.id).not.toBe(true)
      }
    }
  })

  it("does not model target-profile exclusion as an editable choice list workaround", () => {
    // Settings gated purely on deployment/plan capabilities (not identity) should
    // declare `availability`, not attempt to encode exclusion via choice content.
    for (const setting of catalog) {
      if (setting.domain === "Code quality") {
        expect(setting.availability, setting.id).toBeDefined()
      }
    }
  })
})

describe("priorityOptions", () => {
  it("matches the full PriorityId union exactly once each", () => {
    const ids = priorityOptions.map((option) => option.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...priorityIds].sort())
  })

  it("gives every priority a label and description", () => {
    for (const option of priorityOptions) {
      expect(option.label.length, option.id).toBeGreaterThan(0)
      expect(option.description.length, option.id).toBeGreaterThan(0)
    }
  })
})

describe("catalog domain coverage", () => {
  it("covers identity, security, quality, actions, audit, and Copilot decisions", () => {
    const settingIds = new Set(catalog.map((setting) => setting.id))
    expect(settingIds.has("enterprise-type")).toBe(true)
    expect(settingIds.has("identity-lifecycle")).toBe(true)
    expect(settingIds.has("secret-protection-configuration")).toBe(true)
    expect(settingIds.has("code-security-configuration")).toBe(true)
    expect(settingIds.has("dependency-coverage")).toBe(true)
    expect(settingIds.has("premium-dependabot")).toBe(true)
    expect(settingIds.has("code-quality-targeting")).toBe(true)
    expect(settingIds.has("code-quality-setup-findings")).toBe(true)
    expect(settingIds.has("code-quality-coverage")).toBe(true)
    expect(settingIds.has("code-quality-merge-gates")).toBe(true)
    expect(settingIds.has("audit-streaming")).toBe(true)
  })

  it("gates every Actions & supply chain setting on actions-planning", () => {
    for (const setting of catalog.filter((entry) => entry.domain === "Actions & supply chain")) {
      expect(setting.availability?.allOf, setting.id).toContain("actions-planning")
    }
  })

  it("gates the audit setting on enterprise-audit and audit-planning", () => {
    const audit = catalog.find((entry) => entry.id === "audit-streaming")
    expect(audit?.availability?.allOf).toEqual(expect.arrayContaining(["enterprise-audit", "audit-planning"]))
  })

  it("gates every Copilot setting on a Copilot capability", () => {
    for (const setting of catalog.filter((entry) => entry.domain === "Copilot governance" || entry.domain === "Copilot cost controls")) {
      expect(setting.availability?.anyOf, setting.id).toEqual(
        expect.arrayContaining(["copilot-business", "copilot-enterprise"]),
      )
    }
  })

  it("gates every Code quality setting on the code-quality capability", () => {
    for (const setting of catalog.filter((entry) => entry.domain === "Code quality")) {
      expect(setting.availability?.allOf, setting.id).toContain("code-quality")
    }
  })

  it("keeps Secret Protection and Code Security configuration availability independent", () => {
    const secretProtection = catalog.find((entry) => entry.id === "secret-protection-configuration")
    const codeSecurity = catalog.find((entry) => entry.id === "code-security-configuration")
    expect(secretProtection?.availability).toEqual({ anyOf: ["secret-scanning"] })
    expect(codeSecurity?.availability).toEqual({ anyOf: ["code-scanning"] })
  })

  it("keeps dependency coverage gated only on base dependency capabilities", () => {
    const dependencyCoverage = catalog.find((entry) => entry.id === "dependency-coverage")
    expect(dependencyCoverage?.availability).toEqual({ allOf: ["dependency-graph", "dependabot-alerts"] })
  })

  it("gates Organization & repository governance settings on enterprise-account", () => {
    for (const setting of catalog.filter((entry) => entry.domain === "Organization & repository governance")) {
      expect(setting.availability?.allOf, setting.id).toContain("enterprise-account")
    }
  })
})
