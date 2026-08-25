import { describe, expect, it } from "vitest"
import { buildNextStepLanes } from "./nextSteps"
import { defaultIntent } from "./intent"
import { defaultProfile } from "./profile"
import { buildPlanReviewAnalysis } from "./readiness"
import { getRecommendedSettings } from "./recommendations"
import { buildDomainProfiles } from "./scoring"
import type { DomainProfile } from "./scoring"
import type { PlanReviewAnalysis } from "./readiness"
import type { Plan } from "../types"

const baseAnalysis = (overrides: Partial<PlanReviewAnalysis> = {}): PlanReviewAnalysis => ({
  readiness: {
    status: "ready-for-handoff",
    artifactStatus: "final",
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

  it("flags an actionable caveat and reports exclusions as traceability, without listing underlying items", () => {
    const analysis = baseAnalysis({
      caveats: [{ code: "profile-warning-example", message: "message" }],
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
    expect(lane?.detail).toContain("1 catalog decision is also excluded")
    expect(lane?.detail).not.toContain("Excluded setting")
  })

  it("does not treat summary caveat codes (unreviewed-decisions, default-no-exclusions) as actionable on their own", () => {
    const analysis = baseAnalysis({
      caveats: [
        { code: "unreviewed-decisions", message: "message" },
        { code: "default-no-exclusions", message: "message" },
      ],
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

    expect(lane?.status).toBe("clear")
    expect(lane?.detail).toContain("No open caveats need validation")
    expect(lane?.detail).toContain("traceability")
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

describe("buildNextStepLanes validate-caveats real-analysis regression", () => {
  const planWith = (currentState: Plan["profile"]["currentState"]): Plan => ({
    profile: { ...defaultProfile, currentState },
    intent: defaultIntent,
    priorities: [],
    selections: {},
  })

  it("stays Clear for a fully reviewed real plan whose only caveat is expected default-no exclusions", () => {
    const plan = planWith("greenfield")
    const settings = getRecommendedSettings(plan)
    const reviewedIds = settings
      .filter((item) => item.setting.editable !== false)
      .map((item) => item.setting.id)
    const analysis = buildPlanReviewAnalysis(plan, settings, reviewedIds)
    const profiles = buildDomainProfiles(settings)

    // Guard the fixture's own assumptions so this regression stays meaningful.
    expect(analysis.readiness.isReady).toBe(true)
    expect(analysis.excludedDecisions.length).toBeGreaterThan(0)
    expect(analysis.caveats.every((caveat) => caveat.code === "default-no-exclusions")).toBe(true)

    const lanes = buildNextStepLanes(analysis, profiles)
    const lane = lanes.find((item) => item.id === "validate-caveats")

    expect(lane?.status).toBe("clear")
    expect(lane?.detail).toContain("No open caveats need validation")
    expect(lane?.detail).toContain("traceability")
  })

  it("flags a real plan with an actionable caveat such as unresolved current tenant state", () => {
    const plan = planWith("unknown")
    const settings = getRecommendedSettings(plan)
    const reviewedIds = settings
      .filter((item) => item.setting.editable !== false)
      .map((item) => item.setting.id)
    const analysis = buildPlanReviewAnalysis(plan, settings, reviewedIds)
    const profiles = buildDomainProfiles(settings)

    expect(analysis.caveats.some((caveat) => caveat.code === "unresolved-current-state")).toBe(true)

    const lanes = buildNextStepLanes(analysis, profiles)
    const lane = lanes.find((item) => item.id === "validate-caveats")

    expect(lane?.status).toBe("attention")
    expect(lane?.detail).toContain("1 open caveat")
  })
})
