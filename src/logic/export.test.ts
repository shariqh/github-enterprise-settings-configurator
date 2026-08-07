import { describe, expect, it } from "vitest"
import { buildMarkdown, exportObject } from "./export"
import { defaultIntent } from "./intent"
import { defaultProfile } from "./profile"
import type { Plan, RecommendedSetting, Setting } from "../types"

const baseSetting = (overrides: Partial<Setting> = {}): Setting => ({
  id: overrides.id ?? "setting",
  domain: overrides.domain ?? "Code security",
  title: overrides.title ?? "Setting title",
  prompt: "Prompt",
  choices: overrides.choices ?? [
    { id: "strong", label: "Strong", description: "Strong" },
    { id: "light", label: "Light", description: "Light" },
  ],
  recommended: overrides.recommended ?? "strong",
  rationale: "Rationale",
  tradeoff: "Tradeoff",
  prerequisites: "Prerequisites",
  consequences: "Consequences",
  scope: "Enterprise",
  role: "Enterprise owner",
  applyMethod: "Manual",
  influence: overrides.influence ?? "Protective",
  foundational: overrides.foundational,
  postureWeight: overrides.postureWeight,
  effortByChoice: overrides.effortByChoice,
  rolloutBand: overrides.rolloutBand ?? "Moderate",
  ongoingBand: overrides.ongoingBand ?? "Moderate",
  sources: [{ label: "GitHub Docs", tier: "GitHub Docs · mechanics", url: "https://docs.github.com/example" }],
  editable: overrides.editable,
})

const recommendedFor = (
  setting: Setting,
  selected: string,
  disposition: RecommendedSetting["disposition"] = "Recommended",
): RecommendedSetting => ({
  setting,
  recommended: setting.recommended,
  selected,
  disposition,
})

const basePlan = (): Plan => ({
  profile: {
    ...defaultProfile,
    licensedProducts: { ...defaultProfile.licensedProducts, secretProtection: "licensed" },
    planningScope: { ...defaultProfile.planningScope },
  },
  intent: { ...defaultIntent },
  priorities: ["secure-ghec"],
  selections: {},
})

describe("exportObject", () => {
  it("stays finite/empty for zero settings", () => {
    const plan = basePlan()
    const result = exportObject(plan, [], [])

    expect(result.schemaVersion).toBe(2)
    expect(result.settings).toEqual([])
    expect(result.domainProfiles).toEqual([])
    expect(result.reviewedSettingIds).toEqual([])
  })

  it("uses schema version 2 and serializes the new profile/license/planning scope shape", () => {
    const plan = basePlan()
    const result = exportObject(plan, [], [])

    expect(result.schemaVersion).toBe(2)
    expect(result.profile.deployment).toBe(plan.profile.deployment)
    expect(result.profile.basePlan).toBe(plan.profile.basePlan)
    expect(result.profile.licensedProducts).toEqual(plan.profile.licensedProducts)
    expect(result.profile.planningScope).toEqual(plan.profile.planningScope)
  })

  it("serializes only applicable settings and their domain profiles", () => {
    const included = baseSetting({ id: "included", domain: "Code security" })
    const settings = [recommendedFor(included, "strong")]
    const result = exportObject(basePlan(), settings, [])

    expect(result.settings).toHaveLength(1)
    expect(result.settings[0].id).toBe("included")
    expect(result.domainProfiles).toHaveLength(1)
    expect(result.domainProfiles[0].domain).toBe("Code security")
  })

  it("narrows reviewedSettingIds to only the applicable settings actually provided", () => {
    const included = baseSetting({ id: "included" })
    const settings = [recommendedFor(included, "strong")]
    const result = exportObject(basePlan(), settings, ["included", "stale-non-applicable-id"])

    expect(result.reviewedSettingIds).toEqual(["included"])
  })

  it("does not include dormant selections in the export", () => {
    const result = exportObject(basePlan(), [], [])
    expect(result).not.toHaveProperty("dormantSelections")
  })
})

describe("buildMarkdown", () => {
  it("stays finite/well-formed for zero settings", () => {
    const markdown = buildMarkdown(basePlan(), [])
    expect(markdown).toContain("# GitHub Enterprise Settings Configurator")
    expect(markdown).toContain("## Desired settings")
    expect(markdown).toContain("## Boundaries")
  })

  it("labels every new profile dimension", () => {
    const markdown = buildMarkdown(basePlan(), [])

    expect(markdown).toContain("## Target profile")
    expect(markdown).toContain("- Deployment: GitHub Enterprise Cloud")
    expect(markdown).toContain("- Base plan: Enterprise")
    expect(markdown).toContain("- Account model: Personal accounts")
    expect(markdown).toContain("- Authentication: GitHub authentication")
    expect(markdown).toContain("- Provisioning: None")
    expect(markdown).toContain("- Repository visibility: Mixed")
    expect(markdown).toContain("- Current state: Greenfield")
    expect(markdown).toContain("## Licensed products")
    expect(markdown).toContain("- Secret Protection: Licensed")
    expect(markdown).toContain("- Code Security: Not licensed")
    expect(markdown).toContain("- Code Quality: Not licensed")
    expect(markdown).toContain("- Copilot: None")
    expect(markdown).toContain("## Planning scope")
    expect(markdown).toContain("- GitHub Actions: Included")
    expect(markdown).toContain("- Audit log: Included")
  })

  it("only lists applicable settings and includes Code quality domain output", () => {
    const included = baseSetting({ id: "included", title: "Included setting", domain: "Code security" })
    const codeQuality = baseSetting({ id: "codeql-config", title: "CodeQL configuration", domain: "Code quality" })
    const settings = [recommendedFor(included, "strong"), recommendedFor(codeQuality, "strong")]
    const markdown = buildMarkdown(basePlan(), settings)

    expect(markdown).toContain("### Included setting")
    expect(markdown).toContain("### CodeQL configuration")
    expect(markdown).toContain("**Code quality**")
  })

  it("preserves the desired-state boundaries language", () => {
    const markdown = buildMarkdown(basePlan(), [])
    expect(markdown).toContain("Static desired state only; no tenant observation, direct apply, or backend connection.")
    expect(markdown).toContain("Settings that do not apply to this profile are omitted from the plan, not represented as gaps or divergence.")
    expect(markdown).toContain("not a universal security score, breach prediction, or cross-customer comparison.")
  })
})
