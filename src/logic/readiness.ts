import { catalog } from "../catalog"
import { resolveProfile } from "./capabilities"
import type {
  CapabilityId,
  CapabilityRequirement,
  Plan,
  RecommendedSetting,
  Setting,
} from "../types"

export type ArtifactStatus = "draft" | "final"
export type ReadinessStatus = "draft" | "ready-for-handoff"
export type DecisionReviewStatus = "derived" | "reviewed" | "not-reviewed"
export type SelectionSource = "explicit-selection" | "generated-recommendation"

export interface PlanReadiness {
  status: ReadinessStatus
  artifactStatus: ArtifactStatus
  applicableEditableDecisionCount: number
  reviewedDecisionCount: number
  remainingDecisionCount: number
  isReady: boolean
}

export interface RequirementEvaluation {
  allOf: CapabilityId[]
  anyOf: CapabilityId[]
  noneOf: CapabilityId[]
  missingAllOf: CapabilityId[]
  anyOfSatisfied: boolean | null
  presentNoneOf: CapabilityId[]
}

export interface ExcludedDecision {
  id: string
  domain: Setting["domain"]
  title: string
  applicability: {
    status: "excluded"
    reason: string
    requirements: RequirementEvaluation
  }
}

export interface ReviewCaveat {
  code: string
  message: string
  decisionIds?: string[]
}

export interface DecisionReviewState {
  id: string
  domain: Setting["domain"]
  title: string
  reviewStatus: DecisionReviewStatus
  selectionSource: SelectionSource
  disposition: RecommendedSetting["disposition"]
}

export interface PlanReviewAnalysis {
  readiness: PlanReadiness
  applicableDecisionCount: number
  derivedDecisionCount: number
  recommendedDecisionCount: number
  overrideCount: number
  reviewedSettingIds: string[]
  decisions: DecisionReviewState[]
  caveats: ReviewCaveat[]
  excludedDecisions: ExcludedDecision[]
}

const evaluateRequirement = (
  requirement: CapabilityRequirement | undefined,
  capabilities: ReadonlySet<CapabilityId>,
): RequirementEvaluation => {
  const allOf = requirement?.allOf ?? []
  const anyOf = requirement?.anyOf ?? []
  const noneOf = requirement?.noneOf ?? []
  return {
    allOf,
    anyOf,
    noneOf,
    missingAllOf: allOf.filter((capability) => !capabilities.has(capability)),
    anyOfSatisfied: anyOf.length === 0 ? null : anyOf.some((capability) => capabilities.has(capability)),
    presentNoneOf: noneOf.filter((capability) => capabilities.has(capability)),
  }
}

const capabilityList = (capabilities: CapabilityId[]): string =>
  capabilities.map((capability) => `\`${capability}\``).join(", ")

const exclusionReason = (
  setting: Setting,
  capabilities: ReadonlySet<CapabilityId>,
): string => {
  const evaluation = evaluateRequirement(setting.availability, capabilities)
  const reasons: string[] = []
  if (evaluation.missingAllOf.length > 0) {
    reasons.push(`missing required capabilities ${capabilityList(evaluation.missingAllOf)}`)
  }
  if (evaluation.anyOfSatisfied === false) {
    reasons.push(`requires at least one of ${capabilityList(evaluation.anyOf)}`)
  }
  if (evaluation.presentNoneOf.length > 0) {
    reasons.push(`conflicts with present capabilities ${capabilityList(evaluation.presentNoneOf)}`)
  }
  if (reasons.length > 0) return `Excluded by catalog availability: ${reasons.join("; ")}.`
  return "Excluded because no catalog choice is compatible with the resolved capabilities."
}

export const getDecisionReviewStatus = (
  item: RecommendedSetting,
  reviewedIds: ReadonlySet<string>,
): DecisionReviewStatus =>
  item.setting.editable === false
    ? "derived"
    : reviewedIds.has(item.setting.id) ? "reviewed" : "not-reviewed"

export const getRequirementEvaluation = (
  requirement: CapabilityRequirement | undefined,
  capabilities: ReadonlySet<CapabilityId>,
): RequirementEvaluation => evaluateRequirement(requirement, capabilities)

export const buildPlanReviewAnalysis = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
): PlanReviewAnalysis => {
  const resolved = resolveProfile(plan.profile)
  const editableIds = new Set(
    settings
      .filter((item) => item.setting.editable !== false)
      .map((item) => item.setting.id),
  )
  const applicableReviewedSettingIds = [...new Set(reviewedSettingIds.filter((id) => editableIds.has(id)))]
  const reviewedIds = new Set(applicableReviewedSettingIds)
  const decisions = settings.map((item) => ({
    id: item.setting.id,
    domain: item.setting.domain,
    title: item.setting.title,
    reviewStatus: getDecisionReviewStatus(item, reviewedIds),
    selectionSource: plan.selections[item.setting.id] === item.selected
      ? "explicit-selection" as const
      : "generated-recommendation" as const,
    disposition: item.disposition,
  }))
  const unreviewed = decisions
    .filter((item) => item.reviewStatus === "not-reviewed")
    .map((item) => item.id)
  const excludedDecisions = (() => {
    const includedIds = new Set(settings.map((item) => item.setting.id))
    return catalog
      .filter((setting) => !includedIds.has(setting.id))
      .map((setting) => ({
        id: setting.id,
        domain: setting.domain,
        title: setting.title,
        applicability: {
          status: "excluded" as const,
          reason: exclusionReason(setting, resolved.capabilities),
          requirements: evaluateRequirement(setting.availability, resolved.capabilities),
        },
      }))
  })()
  const caveats: ReviewCaveat[] = [
    ...resolved.errors.map((issue) => ({ code: issue.code, message: issue.message })),
    ...resolved.warnings.map((issue) => ({ code: issue.code, message: issue.message })),
  ]

  if (plan.profile.currentState === "unknown") {
    caveats.push({
      code: "unresolved-current-state",
      message: "Current tenant state is unknown; missing evidence is not treated as a gap.",
    })
  }
  if (unreviewed.length > 0) {
    caveats.push({
      code: "unreviewed-decisions",
      message: `${unreviewed.length} applicable editable decision${unreviewed.length === 1 ? " has" : "s have"} not been reviewed; values may be generated recommendations or explicit selections.`,
      decisionIds: unreviewed,
    })
  }
  if (excludedDecisions.length > 0) {
    caveats.push({
      code: "default-no-exclusions",
      message: `${excludedDecisions.length} catalog decision${excludedDecisions.length === 1 ? " is" : "s are"} excluded by the resolved capability model. Exclusion is a default-no planning result, not live product or tenant validation.`,
      decisionIds: excludedDecisions.map((item) => item.id),
    })
  }

  const applicableEditableDecisionCount = editableIds.size
  const reviewedDecisionCount = applicableReviewedSettingIds.length
  const remainingDecisionCount = applicableEditableDecisionCount - reviewedDecisionCount
  const isReady = remainingDecisionCount === 0

  return {
    readiness: {
      status: isReady ? "ready-for-handoff" : "draft",
      artifactStatus: isReady ? "final" : "draft",
      applicableEditableDecisionCount,
      reviewedDecisionCount,
      remainingDecisionCount,
      isReady,
    },
    applicableDecisionCount: settings.length,
    derivedDecisionCount: decisions.filter((item) => item.reviewStatus === "derived").length,
    recommendedDecisionCount: decisions.filter((item) => item.disposition === "Recommended").length,
    overrideCount: decisions.filter((item) => item.disposition === "Override").length,
    reviewedSettingIds: applicableReviewedSettingIds,
    decisions,
    caveats,
    excludedDecisions,
  }
}
