import { describe, expect, it } from "vitest"
import { EXPORT_SCHEMA_NAME, buildMarkdown, exportFilename, exportObject } from "./export"
import { defaultIntent } from "./intent"
import { parseImportedPlan } from "./persistence"
import { defaultProfile } from "./profile"
import { getRecommendedSettings } from "./recommendations"
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
    expect(result.schema).toEqual(expect.objectContaining({
      name: EXPORT_SCHEMA_NAME,
      version: 2,
    }))
    expect(result.settings).toEqual([])
    expect(result.domainProfiles).toEqual([])
    expect(result.reviewedSettingIds).toEqual([])
    expect(result.summary.applicableDecisionCount).toBe(0)
    expect(result.summary.excludedDecisionCount).toBeGreaterThan(0)
    expect(result.readiness).toEqual(expect.objectContaining({
      status: "ready-for-handoff",
      artifactStatus: "final",
      applicableEditableDecisionCount: 0,
      reviewedDecisionCount: 0,
      remainingDecisionCount: 0,
    }))
  })

  it("uses additive schema version 2 and serializes profile, capability, and planning context", () => {
    const plan = basePlan()
    const result = exportObject(plan, [], [])

    expect(result.schemaVersion).toBe(2)
    expect(result.profile.deployment).toBe(plan.profile.deployment)
    expect(result.profile.basePlan).toBe(plan.profile.basePlan)
    expect(result.profile.licensedProducts).toEqual(plan.profile.licensedProducts)
    expect(result.profile.planningScope).toEqual(plan.profile.planningScope)
    expect(result.capabilityContext.resolvedCapabilities).toContain("enterprise-account")
    expect(result.planningContext.priorities[0]).toEqual(expect.objectContaining({
      id: "secure-ghec",
      label: "Secure GHEC baseline",
    }))
    expect(result.limitations).toContain("Does not inspect, validate, or change a GitHub tenant.")
    expect(result.artifactStatus).toBe("final")
  })

  it("serializes ordered, actionable fields for applicable settings", () => {
    const included = baseSetting({ id: "included", domain: "Code security" })
    const settings = [recommendedFor(included, "strong")]
    const result = exportObject(basePlan(), settings, [])

    expect(result.settings).toHaveLength(1)
    expect(result.settings[0]).toEqual(expect.objectContaining({
      order: 1,
      id: "included",
      selected: "strong",
      reviewStatus: "not-reviewed",
      rationale: "Rationale",
      prerequisites: "Prerequisites",
      consequences: "Consequences",
      role: "Enterprise owner",
      applyMethod: "Manual",
    }))
    expect(result.settings[0].desiredState).toEqual({
      id: "strong",
      label: "Strong",
      description: "Strong",
    })
    expect(result.settings[0].sources[0].tier).toBe("GitHub Docs · mechanics")
    expect(result.implementationSteps[0]).toEqual({
      order: 1,
      decisionId: "included",
      domain: "Code security",
      desiredStateId: "strong",
      reviewStatus: "not-reviewed",
    })
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

  it("summarizes excluded catalog decisions with structured default-no reasoning", () => {
    const result = exportObject(basePlan(), getRecommendedSettings(basePlan()), [])
    const excluded = result.excludedDecisions.find((item) => item.id === "copilot-license-topology")

    expect(result.summary.catalogDecisionCount).toBe(result.settings.length + result.excludedDecisions.length)
    expect(excluded?.applicability.status).toBe("excluded")
    expect(excluded?.applicability.reason).toContain("requires at least one of")
    expect(result.caveats).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "default-no-exclusions" }),
      expect.objectContaining({ code: "unreviewed-decisions" }),
    ]))
  })

  it("remains importable through the existing schema-v2 path", () => {
    const plan = basePlan()
    const settings = getRecommendedSettings(plan)
    const exported = exportObject(plan, settings, [settings[0].setting.id])
    const imported = parseImportedPlan(JSON.stringify(exported))

    expect(imported.ok).toBe(true)
    if (!imported.ok) return
    expect(imported.value.migratedFromVersion).toBeNull()
    expect(imported.value.state.profile).toEqual(plan.profile)
    expect(imported.value.state.intent).toEqual(plan.intent)
    expect(imported.value.state.priorities).toEqual(plan.priorities)
    expect(imported.value.importedSettingCount).toBe(settings.length)
  })

  it("adds draft readiness metadata without changing schema version or import-critical fields", () => {
    const plan = basePlan()
    const settings = getRecommendedSettings(plan)
    const result = exportObject(plan, settings, [])

    expect(result.schemaVersion).toBe(2)
    expect(result.artifactType).toBe("machine-readable desired-state contract")
    expect(result.artifactStatus).toBe("draft")
    expect(result.readiness).toEqual(expect.objectContaining({
      status: "draft",
      artifactStatus: "draft",
      applicableEditableDecisionCount: expect.any(Number),
      reviewedDecisionCount: 0,
      remainingDecisionCount: expect.any(Number),
    }))
    expect(result.summary.remainingDecisionCount).toBe(result.readiness.remainingDecisionCount)
    expect(result.profile).toEqual(plan.profile)
    expect(result.intent).toEqual(plan.intent)
    expect(result.priorities).toEqual(plan.priorities)
    expect(result.settings.every((item) => typeof item.id === "string" && typeof item.selected === "string")).toBe(true)
    expect(parseImportedPlan(JSON.stringify(result)).ok).toBe(true)
  })
})

describe("buildMarkdown", () => {
  it("stays finite/well-formed for zero settings", () => {
    const markdown = buildMarkdown(basePlan(), [])
    expect(markdown).toContain("# GitHub Enterprise final desired-state handoff")
    expect(markdown).toContain("## Purpose and how to use this document")
    expect(markdown).toContain("## Implementation checklist")
    expect(markdown).toContain("## Excluded / not applicable catalog decisions")
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

  it("turns applicable settings into a domain-ordered implementation checklist", () => {
    const included = baseSetting({ id: "included", title: "Included setting", domain: "Code security" })
    const codeQuality = baseSetting({ id: "codeql-config", title: "CodeQL configuration", domain: "Code quality" })
    const settings = [recommendedFor(included, "strong"), recommendedFor(codeQuality, "strong")]
    const markdown = buildMarkdown(basePlan(), settings, ["included"])

    expect(markdown).toContain("- [ ] **1. Included setting — Strong**")
    expect(markdown).toContain("Decision ID: `included`; review state: reviewed")
    expect(markdown).toContain("- Why: Rationale")
    expect(markdown).toContain("- Scope / owner: Enterprise / Enterprise owner")
    expect(markdown).toContain("- Apply method: Manual")
    expect(markdown).toContain("- Prerequisites: Prerequisites")
    expect(markdown).toContain("- Consequences: Consequences")
    expect(markdown).toContain("Authoritative product sources: [GitHub Docs]")
    expect(markdown).toContain("- [ ] **2. CodeQL configuration — Strong**")
    expect(markdown).toContain("**Code quality**")
  })

  it("surfaces unresolved review state and excluded decisions instead of silently omitting them", () => {
    const plan = basePlan()
    const settings = getRecommendedSettings(plan)
    const markdown = buildMarkdown(plan, settings)

    expect(markdown).toContain("**unreviewed-decisions:**")
    expect(markdown).toContain("**default-no-exclusions:**")
    expect(markdown).toContain("### Copilot governance")
    expect(markdown).toContain("`copilot-license-topology`")
    expect(markdown).toContain("Excluded by catalog availability")
  })

  it("does not describe an unreviewed explicit selection as generated", () => {
    const included = baseSetting({ id: "included" })
    const plan = { ...basePlan(), selections: { included: "light" } }
    const markdown = buildMarkdown(plan, [recommendedFor(included, "light", "Override")])

    expect(markdown).toContain("Unreviewed editable decisions: 1")
    expect(markdown).toContain("values may be generated recommendations or explicit selections")
    expect(markdown).not.toContain("Unreviewed generated decisions")
  })

  it("preserves the desired-state boundaries language", () => {
    const markdown = buildMarkdown(basePlan(), [])
    expect(markdown).toContain("Static desired state only; no tenant observation, direct apply, or backend connection.")
    expect(markdown).toContain("Excluded decisions reflect catalog capability filters and default-no planning, not live tenant validation.")
    expect(markdown).toContain("not a universal security score, breach prediction, or cross-customer comparison.")
  })

  it("uses draft/final filenames and content based on readiness", () => {
    const plan = basePlan()
    const settings = getRecommendedSettings(plan)
    const reviewedIds = settings
      .filter((item) => item.setting.editable !== false)
      .map((item) => item.setting.id)
    const draftMarkdown = buildMarkdown(plan, settings)
    const finalMarkdown = buildMarkdown(plan, settings, reviewedIds)

    expect(exportFilename("markdown", "draft")).toBe("github-enterprise-draft-review-handoff.md")
    expect(exportFilename("json", "draft")).toBe("github-enterprise-draft-desired-state.json")
    expect(exportFilename("markdown", "final")).toBe("github-enterprise-final-review-handoff.md")
    expect(exportFilename("json", "final")).toBe("github-enterprise-final-desired-state.json")
    expect(draftMarkdown).toContain("# GitHub Enterprise draft desired-state handoff")
    expect(draftMarkdown).toContain("- Readiness status: Draft")
    expect(draftMarkdown).toContain("- Artifact status: draft")
    expect(finalMarkdown).toContain("# GitHub Enterprise final desired-state handoff")
    expect(finalMarkdown).toContain("- Readiness status: Ready for handoff")
    expect(finalMarkdown).toContain("- Artifact status: final")
  })
})
