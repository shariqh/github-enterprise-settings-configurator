import { describe, expect, it } from "vitest"
import { defaultIntent } from "./intent"
import { defaultProfile } from "./profile"
import { buildPlanReviewAnalysis } from "./readiness"
import type { Plan, RecommendedSetting, Setting } from "../types"

const setting = (id: string, editable = true): Setting => ({
  id,
  domain: "Code security",
  title: id,
  prompt: id,
  choices: [
    { id: "strong", label: "Strong", description: "Strong" },
    { id: "light", label: "Light", description: "Light" },
  ],
  recommended: "strong",
  editable,
  rationale: id,
  tradeoff: id,
  prerequisites: id,
  consequences: id,
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

const plan: Plan = {
  profile: defaultProfile,
  intent: defaultIntent,
  priorities: [],
  selections: {},
}

describe("buildPlanReviewAnalysis readiness", () => {
  it("is ready when there are zero applicable editable decisions", () => {
    const analysis = buildPlanReviewAnalysis(plan, [], [])

    expect(analysis.readiness).toEqual({
      status: "ready-for-handoff",
      artifactStatus: "final",
      applicableEditableDecisionCount: 0,
      reviewedDecisionCount: 0,
      remainingDecisionCount: 0,
      isReady: true,
    })
  })

  it("stays draft when zero of the applicable editable decisions are reviewed", () => {
    const settings = [recommended(setting("one"))]
    const analysis = buildPlanReviewAnalysis(plan, settings, [])

    expect(analysis.readiness).toMatchObject({
      status: "draft",
      applicableEditableDecisionCount: 1,
      reviewedDecisionCount: 0,
      remainingDecisionCount: 1,
      isReady: false,
    })
  })

  it("stays draft while only some applicable editable decisions are reviewed", () => {
    const settings = [recommended(setting("one")), recommended(setting("two"))]
    const analysis = buildPlanReviewAnalysis(plan, settings, ["one"])

    expect(analysis.readiness).toMatchObject({
      status: "draft",
      artifactStatus: "draft",
      applicableEditableDecisionCount: 2,
      reviewedDecisionCount: 1,
      remainingDecisionCount: 1,
      isReady: false,
    })
  })

  it("is ready when all applicable editable decisions are reviewed", () => {
    const settings = [recommended(setting("one")), recommended(setting("two"))]
    const analysis = buildPlanReviewAnalysis(plan, settings, ["one", "two", "two", "stale"])

    expect(analysis.readiness.isReady).toBe(true)
    expect(analysis.readiness.reviewedDecisionCount).toBe(2)
    expect(analysis.reviewedSettingIds).toEqual(["one", "two"])
  })

  it("does not let derived decisions block readiness or enter reviewedSettingIds", () => {
    const derived = recommended(setting("derived", false))
    const editable = recommended(setting("editable"))
    const analysis = buildPlanReviewAnalysis(plan, [derived, editable], ["derived", "editable"])

    expect(analysis.readiness).toMatchObject({
      isReady: true,
      applicableEditableDecisionCount: 1,
      reviewedDecisionCount: 1,
      remainingDecisionCount: 0,
    })
    expect(analysis.derivedDecisionCount).toBe(1)
    expect(analysis.reviewedSettingIds).toEqual(["editable"])
    expect(analysis.decisions.find((item) => item.id === "derived")?.reviewStatus).toBe("derived")
  })
})
