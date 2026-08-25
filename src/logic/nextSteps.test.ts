import { describe, expect, it } from "vitest"
import { buildNextStepLanes } from "./nextSteps"
import type { DomainProfile } from "./scoring"
import type { PlanReviewAnalysis } from "./readiness"

const baseAnalysis = (overrides: Partial<PlanReviewAnalysis> = {}): PlanReviewAnalysis => ({
  readiness: {
    status: "draft",
    artifactStatus: "draft",
    applicableEditableDecisionCount: 4,
    reviewedDecisionCount: 4,
    remainingDecisionCount: 0,
    isReady: true,
  },
  applicableDecisionCount: 4,
  derivedDecisionCount: 0,
  recommendedDecisionCount: 4,
  overrideCount: 0,
  reviewedSettingIds: [],
  decisions: [],
  caveats: [],
  excludedDecisions: [],
  ...overrides,
})

const domainProfile = (overrides: Partial<DomainProfile> = {}): DomainProfile => ({
  domain: "Code security",
  posture: 0.6,
  postureLabel: "Moderate",
  foundationLimited: false,
  rolloutLoad: 0.4,
  rolloutBand: "Moderate",
  ongoingLoad: 0.4,
  ongoingBand: "Moderate",
  ...overrides,
})

describe("buildNextStepLanes", () => {
  it("returns six lanes covering the full canonical next-step story", () => {
    const lanes = buildNextStepLanes(baseAnalysis(), [domainProfile()])
    expect(lanes.map((lane) => lane.id)).toEqual([
      "finish-unreviewed",
      "confirm-overrides",
      "validate-caveats",
      "foundational-limits",
      "phase-high-effort",
      "export-and-follow-up",
    ])
  })

  it("marks every lane clear for a fully reviewed, unremarkable plan", () => {
    const lanes = buildNextStepLanes(baseAnalysis(), [domainProfile()])
    expect(lanes.every((lane) => lane.status === "clear")).toBe(true)
    expect(lanes.find((lane) => lane.id === "export-and-follow-up")?.detail).toContain("ready for a final handoff")
  })

  it("flags unreviewed decisions with a count and stakeholder framing", () => {
    const analysis = baseAnalysis({
      readiness: {
        status: "draft",
        artifactStatus: "draft",
        applicableEditableDecisionCount: 4,
        reviewedDecisionCount: 1,
        remainingDecisionCount: 3,
        isReady: false,
      },
    })
    const lanes = buildNextStepLanes(analysis, [domainProfile()])
    const lane = lanes.find((item) => item.id === "finish-unreviewed")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("3 applicable editable decisions still need")
    const exportLane = lanes.find((item) => item.id === "export-and-follow-up")
    expect(exportLane?.status).toBe("attention")
    expect(exportLane?.detail).toContain("draft handoff export")
  })

  it("flags deliberate overrides for rationale/owner confirmation", () => {
    const analysis = baseAnalysis({ overrideCount: 2 })
    const lanes = buildNextStepLanes(analysis, [domainProfile()])
    const lane = lanes.find((item) => item.id === "confirm-overrides")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("2 values differ")
  })

  it("flags caveats and exclusions without listing the underlying items", () => {
    const analysis = baseAnalysis({
      caveats: [{ code: "unreviewed-decisions", message: "message" }],
      excludedDecisions: [
        {
          id: "excluded-1",
          domain: "Code security",
          title: "Excluded setting",
          applicability: { status: "excluded", reason: "reason", requirements: { allOf: [], anyOf: [], noneOf: [], missingAllOf: [], anyOfSatisfied: null, presentNoneOf: [] } },
        },
      ],
    })
    const lanes = buildNextStepLanes(analysis, [domainProfile()])
    const lane = lanes.find((item) => item.id === "validate-caveats")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("1 open caveat")
    expect(lane?.detail).toContain("1 excluded catalog decision")
    expect(lane?.detail).not.toContain("Excluded setting")
    expect(lane?.detail).toContain("not observed tenant state")
  })

  it("flags a foundational-limited domain by name without treating it as a gap", () => {
    const lanes = buildNextStepLanes(baseAnalysis(), [
      domainProfile({ domain: "Identity & administration", foundationLimited: true }),
    ])
    const lane = lanes.find((item) => item.id === "foundational-limits")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("Identity & administration")
    expect(lane?.detail).toContain("capped by a foundational decision")
  })

  it("flags a High-effort domain as a phasing candidate, never as weak security", () => {
    const lanes = buildNextStepLanes(baseAnalysis(), [
      domainProfile({ domain: "Actions & supply chain", rolloutBand: "High" }),
    ])
    const lane = lanes.find((item) => item.id === "phase-high-effort")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("Actions & supply chain")
    expect(lane?.detail).toContain("not weak security")
  })
})
