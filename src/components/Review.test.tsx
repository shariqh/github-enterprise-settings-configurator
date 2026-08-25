import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { defaultIntent } from "../logic/intent"
import { defaultProfile } from "../logic/profile"
import { buildPlanReviewAnalysis } from "../logic/readiness"
import { getRecommendedSettings } from "../logic/recommendations"
import type { Plan, RecommendedSetting, Setting } from "../types"
import { Review } from "./Review"

const plan = (currentState: Plan["profile"]["currentState"] = "greenfield"): Plan => ({
  profile: { ...defaultProfile, currentState },
  intent: defaultIntent,
  priorities: [],
  selections: {},
})

const setting = (editable = true): Setting => ({
  id: editable ? "editable-setting" : "derived-setting",
  domain: "Code security",
  title: editable ? "Editable setting" : "Derived setting",
  prompt: "Choose a value",
  choices: [{ id: "strong", label: "Strong", description: "Strong" }],
  recommended: "strong",
  editable,
  rationale: "Rationale",
  tradeoff: "Tradeoff",
  prerequisites: "Prerequisites",
  consequences: "Consequences",
  scope: "Enterprise",
  role: "Enterprise owner",
  applyMethod: "Manual",
  influence: "Protective",
  rolloutBand: "Low",
  ongoingBand: "Low",
  sources: [],
})

const twoChoiceSetting = (overrides: Partial<Setting> = {}): Setting => ({
  id: overrides.id ?? "two-choice-setting",
  domain: overrides.domain ?? "Code security",
  title: overrides.title ?? "Two choice setting",
  prompt: "Choose a value",
  choices: [
    { id: "strong", label: "Strong", description: "Strong" },
    { id: "light", label: "Light", description: "Light" },
  ],
  recommended: "strong",
  editable: true,
  rationale: "Rationale",
  tradeoff: "Tradeoff",
  prerequisites: "Prerequisites",
  consequences: "Consequences",
  scope: "Enterprise",
  role: "Enterprise owner",
  applyMethod: "Manual",
  influence: overrides.influence ?? "Protective",
  foundational: overrides.foundational,
  rolloutBand: overrides.rolloutBand ?? "Low",
  ongoingBand: overrides.ongoingBand ?? "Low",
  sources: [],
})

const recommended = (item: Setting): RecommendedSetting => ({
  setting: item,
  recommended: "strong",
  selected: "strong",
  disposition: "Recommended",
})

const override = (item: Setting): RecommendedSetting => ({
  setting: item,
  recommended: "strong",
  selected: "light",
  disposition: "Override",
})

const renderReview = (
  currentPlan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
  pendingDraftExport: "json" | "markdown" | null = null,
) => renderToStaticMarkup(
  <Review
    analysis={buildPlanReviewAnalysis(currentPlan, settings, reviewedSettingIds)}
    intent={defaultIntent}
    onCancelDraftExport={() => undefined}
    onConfirmDraftExport={() => undefined}
    onOpenDomain={() => undefined}
    onRequestExport={() => undefined}
    pendingDraftExport={pendingDraftExport}
    settings={settings}
  />,
)

describe("Review export choices", () => {
  it("shows truthful draft wording and explicit inline confirmation before download", () => {
    const currentPlan = plan()
    const html = renderReview(currentPlan, [recommended(setting())], [], "markdown")

    expect(html).toContain("Draft desired state.")
    expect(html).toContain("0 of 1 applicable editable decisions reviewed; 1 remaining.")
    expect(html).toContain("Generated recommendation")
    expect(html).toContain("Draft review handoff")
    expect(html).toContain("Markdown · for people")
    expect(html).toContain("Download draft review handoff (.md)")
    expect(html).toContain("Draft desired-state contract")
    expect(html).toContain("JSON · for tools and re-entry")
    expect(html).toContain("Download draft desired-state contract (.json)")
    expect(html).toContain("Confirm incomplete draft download")
    expect(html).toContain("Download draft review handoff")
    expect(html).toContain("Import it back here or adapt it downstream.")
  })

  it("shows final handoff labels without a draft warning once all editable decisions are reviewed", () => {
    const currentPlan = plan()
    const editable = recommended(setting())
    const derived = recommended(setting(false))
    const html = renderReview(currentPlan, [editable, derived], [editable.setting.id])

    expect(html).toContain("Ready for handoff.")
    expect(html).toContain("1 of 1 applicable editable decisions reviewed.")
    expect(html).toContain("1 profile-derived decision")
    expect(html).toContain("Download final review handoff (.md)")
    expect(html).toContain("Download final desired-state contract (.json)")
    expect(html).not.toContain("Confirm incomplete draft download")
  })

  it("renders canonical profile caveats and default-no exclusions with stable identities", () => {
    const currentPlan = plan("unknown")
    const settings = getRecommendedSettings(currentPlan)
    const html = renderReview(currentPlan, settings)

    expect(html).toContain("unresolved-current-state")
    expect(html).toContain("Current tenant state is unknown")
    expect(html).toContain("excluded / default-no catalog decision")
    expect(html).toContain("copilot-license-topology")
    expect(html).toContain("Excluded by catalog availability")
    expect(html).toContain("not live tenant or product validation")
  })
})

describe("Review customer outcome and next-step story", () => {
  it("presents all four new framing headings without duplicating existing lists", () => {
    const currentPlan = plan()
    const html = renderReview(currentPlan, [recommended(setting())], [], "markdown")

    expect(html).toContain("What this result means")
    expect(html).toContain("What happens next")
    expect(html).toContain("What the customer takes away")
    expect(html).toContain("How GitHub helps")
    expect(html).toContain("desired-state decision record")
    expect(html).toContain("This configurator does not inspect this tenant, apply these settings, or assess compliance")
    expect(html).toContain("Use them as the handoff agenda with the customer")
  })

  it("gives truthful draft next-step guidance when a single decision remains unreviewed (singular copy)", () => {
    const currentPlan = plan()
    const html = renderReview(currentPlan, [recommended(setting())], [], "markdown")

    expect(html).toContain("1 applicable editable decision still needs")
    expect(html).toContain("Needs attention")
    expect(html).toContain("A draft desired-state artifact")
    expect(html).toContain("draft handoff export is available for workshop continuity")
    expect(html).toContain("1 of 1 applicable editable decision remains pending review, held as a named, open choice rather than a resolved fact.")
  })

  it("gives truthful ready next-step guidance once a single decision is reviewed (singular copy)", () => {
    const currentPlan = plan()
    const item = recommended(setting())
    const html = renderReview(currentPlan, [item], [item.setting.id])

    expect(html).toContain("Every applicable editable decision has already been reviewed")
    expect(html).toContain("A reviewed desired-state artifact")
    expect(html).toContain("ready for a final handoff export")
    expect(html).toContain("The 1 applicable editable decision has been reviewed, but the result is still this desired-state record, not an observed or independently validated fact.")
  })

  it("gives grammatically correct plural copy when multiple decisions remain unreviewed", () => {
    const currentPlan = plan()
    const first = recommended(twoChoiceSetting({ id: "first-decision" }))
    const second = recommended(twoChoiceSetting({ id: "second-decision" }))
    const html = renderReview(currentPlan, [first, second], [])

    expect(html).toContain("2 of 2 applicable editable decisions remain pending review, held as named, open choices rather than resolved facts.")
  })

  it("gives grammatically correct plural copy once multiple decisions are reviewed", () => {
    const currentPlan = plan()
    const first = recommended(twoChoiceSetting({ id: "first-decision" }))
    const second = recommended(twoChoiceSetting({ id: "second-decision" }))
    const html = renderReview(currentPlan, [first, second], [first.setting.id, second.setting.id])

    expect(html).toContain("All 2 applicable editable decisions have been reviewed, but the result is still this desired-state record, not an observed or independently validated fact.")
  })

  it("flags deliberate overrides for rationale and owner confirmation", () => {
    const currentPlan = plan()
    const item = override(twoChoiceSetting({ id: "override-setting" }))
    const html = renderReview(currentPlan, [item], [item.setting.id])

    expect(html).toContain("Confirm the rationale and owner for deliberate overrides")
    expect(html).toContain("1 value differs")
  })

  it("names a foundational-limited domain without treating it as an observed gap", () => {
    const currentPlan = plan()
    const foundational = override(twoChoiceSetting({ id: "foundation", foundational: true }))
    const sibling = recommended(twoChoiceSetting({ id: "sibling" }))
    const html = renderReview(currentPlan, [foundational, sibling], [foundational.setting.id, sibling.setting.id])

    expect(html).toContain("Address foundational constraints before downstream enhancements")
    expect(html).toContain("Code security")
    expect(html).toContain("capped by a foundational decision")
  })

  it("names a High-effort domain as a phasing candidate, never as weak security", () => {
    const currentPlan = plan()
    const item = recommended(twoChoiceSetting({ id: "high-effort", rolloutBand: "High" }))
    const html = renderReview(currentPlan, [item], [item.setting.id])

    expect(html).toContain("Phase or pilot high-effort work")
    expect(html).toContain("not weak security")
  })
})
