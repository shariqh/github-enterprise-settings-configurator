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

const recommended = (item: Setting): RecommendedSetting => ({
  setting: item,
  recommended: "strong",
  selected: "strong",
  disposition: "Recommended",
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
