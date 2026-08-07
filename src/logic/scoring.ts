import type { Domain, RecommendedSetting, Setting } from "../types"

type Band = "Low" | "Moderate" | "High"
type Influence = "Protective" | "Enabling" | "Guardrail"

export interface DomainProfile {
  domain: Domain
  posture: number
  postureLabel: "Lower" | "Moderate" | "Higher"
  foundationLimited: boolean
  rolloutLoad: number
  rolloutBand: Band
  ongoingLoad: number
  ongoingBand: Band
}

export interface ChoiceImpact {
  control: number
  rollout: number
  ongoing: number
}

const bandValue: Record<Band, number> = { Low: 1, Moderate: 2, High: 3 }
const influenceWeight: Record<Influence, number> = { Protective: 3, Guardrail: 2, Enabling: 1 }

export function choiceStrength(setting: Setting, selected: string): number {
  const index = setting.choices.findIndex((choice) => choice.id === selected)
  if (index < 0) return 0
  if (setting.choices.length === 1) return 1
  return 1 - index / (setting.choices.length - 1)
}

export function effortFactor(setting: Setting, selected: string): number {
  const explicit = setting.effortByChoice?.[selected]
  return explicit ?? 0.2 + choiceStrength(setting, selected) * 0.8
}

export function toPostureLabel(value: number): DomainProfile["postureLabel"] {
  if (value < 0.35) return "Lower"
  if (value < 0.7) return "Moderate"
  return "Higher"
}

export function toBand(value: number): Band {
  if (value < 0.34) return "Low"
  if (value < 0.68) return "Moderate"
  return "High"
}

export function getChoiceImpact(setting: Setting, selected: string): ChoiceImpact {
  const controlWeight = setting.postureWeight ?? influenceWeight[setting.influence]
  const effort = effortFactor(setting, selected)
  return {
    control: controlWeight === 0 ? 0 : choiceStrength(setting, selected),
    rollout: bandValue[setting.rolloutBand] / 3 * effort,
    ongoing: bandValue[setting.ongoingBand] / 3 * effort,
  }
}

const controlWeightOf = (setting: RecommendedSetting["setting"]): number =>
  setting.postureWeight ?? influenceWeight[setting.influence]

/** Guards against zero/degenerate denominators so every ratio stays finite. */
const safeDivide = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const finite = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback

/**
 * Groups only the applicable settings supplied by the caller (RecommendedSetting[]
 * carries Recommended/Override dispositions only — non-applicable and
 * product-disabled settings never reach this function). Empty, context-only
 * (postureWeight 0), single-item, and other degenerate groups always resolve to
 * finite, in-range output.
 */
export const buildDomainProfiles = (settings: RecommendedSetting[]): DomainProfile[] => {
  const groups = new Map<Domain, RecommendedSetting[]>()
  settings.forEach((item) =>
    groups.set(item.setting.domain, [...(groups.get(item.setting.domain) ?? []), item]))

  return [...groups.entries()].map(([domain, items]) => {
    const scoredItems = items.filter((item) => controlWeightOf(item.setting) > 0)
    const totalWeight = scoredItems.reduce((sum, item) => sum + controlWeightOf(item.setting), 0)
    const rawPosture = finite(safeDivide(
      scoredItems.reduce((sum, item) => sum + choiceStrength(item.setting, item.selected) * controlWeightOf(item.setting), 0),
      totalWeight,
    ))

    const foundations = scoredItems.filter((item) => item.setting.foundational)
    const foundationPosture = foundations.length === 0
      ? 1
      : finite(safeDivide(
        foundations.reduce((sum, item) => sum + choiceStrength(item.setting, item.selected), 0),
        foundations.length,
      ), 1)
    const foundationCap = 0.45 + foundationPosture * 0.55
    const posture = Math.min(rawPosture, foundationCap)

    const rolloutPotential = items.reduce((sum, item) => sum + bandValue[item.setting.rolloutBand], 0)
    const ongoingPotential = items.reduce((sum, item) => sum + bandValue[item.setting.ongoingBand], 0)
    const rolloutLoad = finite(safeDivide(
      items.reduce((sum, item) => sum + bandValue[item.setting.rolloutBand] * effortFactor(item.setting, item.selected), 0),
      rolloutPotential,
    ))
    const ongoingLoad = finite(safeDivide(
      items.reduce((sum, item) => sum + bandValue[item.setting.ongoingBand] * effortFactor(item.setting, item.selected), 0),
      ongoingPotential,
    ))

    return {
      domain,
      posture,
      postureLabel: toPostureLabel(posture),
      foundationLimited: posture + 0.001 < rawPosture,
      rolloutLoad,
      rolloutBand: toBand(rolloutLoad),
      ongoingLoad,
      ongoingBand: toBand(ongoingLoad),
    }
  })
}
