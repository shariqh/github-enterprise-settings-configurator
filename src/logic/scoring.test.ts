import { describe, expect, it } from "vitest"
import { buildDomainProfiles, choiceStrength, getChoiceImpact } from "./scoring"
import type { RecommendedSetting, Setting } from "../types"

const baseSetting = (overrides: Partial<Setting> = {}): Setting => ({
  id: overrides.id ?? "setting",
  domain: overrides.domain ?? "Code security",
  title: overrides.title ?? "Setting",
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
  role: "Owner",
  applyMethod: "Manual",
  influence: overrides.influence ?? "Protective",
  foundational: overrides.foundational,
  postureWeight: overrides.postureWeight,
  effortByChoice: overrides.effortByChoice,
  rolloutBand: overrides.rolloutBand ?? "Moderate",
  ongoingBand: overrides.ongoingBand ?? "Moderate",
  sources: [],
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

describe("buildDomainProfiles degenerate inputs", () => {
  it("returns an empty, finite array for no settings", () => {
    expect(buildDomainProfiles([])).toEqual([])
  })

  it("stays finite for a context-only domain (postureWeight 0)", () => {
    const setting = baseSetting({
      id: "hosting",
      domain: "Identity & administration",
      postureWeight: 0,
      influence: "Guardrail",
    })
    const [profile] = buildDomainProfiles([recommendedFor(setting, "strong")])

    expect(profile.posture).toBe(0)
    expect(Number.isFinite(profile.posture)).toBe(true)
    expect(Number.isFinite(profile.rolloutLoad)).toBe(true)
    expect(Number.isFinite(profile.ongoingLoad)).toBe(true)
    expect(profile.foundationLimited).toBe(false)
  })

  it("stays finite for a single-item domain", () => {
    const setting = baseSetting({ id: "solo", domain: "Audit visibility" })
    const [profile] = buildDomainProfiles([recommendedFor(setting, "strong")])

    expect(profile.domain).toBe("Audit visibility")
    expect(Number.isFinite(profile.posture)).toBe(true)
    expect(profile.posture).toBeGreaterThanOrEqual(0)
    expect(profile.posture).toBeLessThanOrEqual(1)
  })

  it("stays finite when the selected choice id does not exist on the setting", () => {
    const setting = baseSetting({ id: "bogus" })
    const [profile] = buildDomainProfiles([recommendedFor(setting, "no-such-choice")])

    expect(Number.isFinite(profile.posture)).toBe(true)
    expect(profile.posture).toBe(0)
  })

  it("treats a single-choice setting as full strength", () => {
    const setting = baseSetting({
      id: "single-choice",
      choices: [{ id: "only", label: "Only", description: "Only" }],
      recommended: "only",
    })
    expect(choiceStrength(setting, "only")).toBe(1)

    const [profile] = buildDomainProfiles([recommendedFor(setting, "only")])
    expect(profile.posture).toBe(1)
  })

  it("caps a domain's posture when a foundational choice is weak", () => {
    const foundational = baseSetting({
      id: "foundation",
      domain: "Code security",
      foundational: true,
      influence: "Protective",
    })
    const strongSibling = baseSetting({
      id: "sibling",
      domain: "Code security",
      influence: "Protective",
    })
    const settings = [
      recommendedFor(foundational, "light"),
      recommendedFor(strongSibling, "strong"),
    ]
    const [profile] = buildDomainProfiles(settings)

    expect(profile.foundationLimited).toBe(true)
    expect(profile.posture).toBeLessThan(1)
  })
})

describe("buildDomainProfiles applicable-only behavior", () => {
  it("only reflects settings actually passed in (callers pre-filter non-applicable/product-disabled settings)", () => {
    const included = baseSetting({ id: "included", domain: "Code security" })
    const settings = [recommendedFor(included, "strong")]
    const profiles = buildDomainProfiles(settings)

    expect(profiles).toHaveLength(1)
    expect(profiles[0].domain).toBe("Code security")
  })

  it("groups by domain across multiple applicable settings", () => {
    const first = baseSetting({ id: "first", domain: "Organization & repository governance" })
    const second = baseSetting({ id: "second", domain: "Organization & repository governance" })
    const other = baseSetting({ id: "other", domain: "Copilot governance" })
    const profiles = buildDomainProfiles([
      recommendedFor(first, "strong"),
      recommendedFor(second, "light", "Override"),
      recommendedFor(other, "strong"),
    ])

    expect(profiles.map((profile) => profile.domain).sort()).toEqual(
      ["Copilot governance", "Organization & repository governance"].sort(),
    )
  })

  it("changes domain posture when the recommended-vs-override selection changes", () => {
    const setting = baseSetting({ id: "toggle", domain: "Code security" })
    const strongProfile = buildDomainProfiles([recommendedFor(setting, "strong")])[0]
    const lightProfile = buildDomainProfiles([recommendedFor(setting, "light", "Override")])[0]

    expect(strongProfile.posture).toBeGreaterThan(lightProfile.posture)
  })
})

describe("Code quality domain support", () => {
  it("produces a domain profile for Code quality settings", () => {
    const setting = baseSetting({
      id: "codeql-config",
      domain: "Code quality",
      influence: "Enabling",
    })
    const profiles = buildDomainProfiles([recommendedFor(setting, "strong")])

    expect(profiles).toHaveLength(1)
    expect(profiles[0].domain).toBe("Code quality")
    expect(Number.isFinite(profiles[0].posture)).toBe(true)
  })
})

describe("getChoiceImpact", () => {
  it("reports zero control for context-only (postureWeight 0) settings", () => {
    const setting = baseSetting({ id: "hosting", postureWeight: 0 })
    expect(getChoiceImpact(setting, "strong").control).toBe(0)
  })
})
