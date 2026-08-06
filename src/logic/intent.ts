import { buildDomainProfiles } from "./scoring"
import type {
  IntentAxis,
  IntentLevel,
  PlanIntent,
  RecommendedSetting,
} from "../types"

interface IntentAxisDefinition {
  label: string
  description: string
  values: readonly [string, string, string]
}

export const defaultIntent: PlanIntent = {
  guardrailStrength: 1,
  rolloutPace: 1,
  operationalCapacity: 1,
}

export const intentAxisDefinitions: Record<IntentAxis, IntentAxisDefinition> = {
  guardrailStrength: {
    label: "Guardrail strength",
    description: "How strongly shared controls should guide repository and product choices.",
    values: ["Flexible", "Balanced", "Strong"],
  },
  rolloutPace: {
    label: "Rollout pace",
    description: "How quickly high-rollout-effort controls should move toward the target state.",
    values: ["Phased", "Steady", "Accelerated"],
  },
  operationalCapacity: {
    label: "Operational capacity",
    description: "How much continuing ownership the operating model can reasonably sustain.",
    values: ["Lean", "Balanced", "Well staffed"],
  },
}

export const intentAxes: IntentAxis[] = [
  "guardrailStrength",
  "rolloutPace",
  "operationalCapacity",
]

export const intentLabel = (axis: IntentAxis, level: IntentLevel): string =>
  intentAxisDefinitions[axis].values[level]

export interface PlanSignatureSummary {
  headline: string
  narrative: string
}

const domainPhrase = (
  settings: RecommendedSetting[],
  dimension: "rolloutLoad" | "ongoingLoad",
): string | null => {
  const profiles = buildDomainProfiles(settings)
  if (profiles.length === 0) return null

  const maximum = Math.max(...profiles.map((profile) => profile[dimension]))
  const leaders = profiles.filter((profile) => Math.abs(profile[dimension] - maximum) < 0.03)
  if (leaders.length !== 1) return null
  return leaders[0].domain
}

export function buildPlanSignature(
  intent: PlanIntent,
  settings: RecommendedSetting[],
): PlanSignatureSummary {
  const guardrail = intentLabel("guardrailStrength", intent.guardrailStrength)
  const rollout = intentLabel("rolloutPace", intent.rolloutPace)
  const capacity = intentLabel("operationalCapacity", intent.operationalCapacity)
  const rolloutLeader = domainPhrase(settings, "rolloutLoad")
  const ongoingLeader = domainPhrase(settings, "ongoingLoad")

  const observations = [
    rolloutLeader ? `${rolloutLeader} carries the greatest rollout effort.` : "Rollout effort is distributed across several domains.",
    ongoingLeader ? `${ongoingLeader} carries the greatest ongoing ownership.` : "Ongoing ownership is distributed across several domains.",
  ]

  return {
    headline: `${guardrail} guardrails · ${rollout} rollout`,
    narrative: `This plan assumes a ${capacity.toLowerCase()} operating model. ${observations.join(" ")}`,
  }
}
