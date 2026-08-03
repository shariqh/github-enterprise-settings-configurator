import type { RecommendedSetting, Setting } from "../types"

type Band = "Low" | "Moderate" | "High"
type Influence = "Protective" | "Enabling" | "Guardrail"

export interface DomainProfile {
  domain: string
  posture: number
  postureLabel: "Lower" | "Moderate" | "Higher"
  foundationLimited: boolean
  rolloutLoad: number
  rolloutBand: Band
  ongoingLoad: number
  ongoingBand: Band
}

const bandValue: Record<Band, number> = { Low: 1, Moderate: 2, High: 3 }
const influenceWeight: Record<Influence, number> = { Protective: 3, Guardrail: 2, Enabling: 1 }

function choiceStrength(setting: Setting, selected: string): number {
  const index = setting.choices.findIndex((choice) => choice.id === selected)
  if (index < 0) return 0
  if (setting.choices.length === 1) return 1
  return 1 - index / (setting.choices.length - 1)
}

function effortFactor(setting: Setting, selected: string): number {
  const explicit = setting.effortByChoice?.[selected]
  return explicit ?? 0.2 + choiceStrength(setting, selected) * 0.8
}

function toPostureLabel(value: number): DomainProfile["postureLabel"] {
  if (value < 0.35) return "Lower"
  if (value < 0.7) return "Moderate"
  return "Higher"
}

function toBand(value: number): Band {
  if (value < 0.34) return "Low"
  if (value < 0.68) return "Moderate"
  return "High"
}

export const buildDomainProfiles = (settings: RecommendedSetting[]): DomainProfile[] => {
  const groups = new Map<string, RecommendedSetting[]>()
  settings
    .filter((item) => item.disposition !== "Not applicable")
    .forEach((item) => groups.set(item.setting.domain, [...(groups.get(item.setting.domain) ?? []), item]))

  return [...groups.entries()].map(([domain, items]) => {
    const scoredItems = items.filter((item) => (item.setting.postureWeight ?? influenceWeight[item.setting.influence]) > 0)
    const totalWeight = scoredItems.reduce((sum, item) => sum + (item.setting.postureWeight ?? influenceWeight[item.setting.influence]), 0)
    const rawPosture = totalWeight === 0 ? 0 : scoredItems.reduce((sum, item) => {
      const weight = item.setting.postureWeight ?? influenceWeight[item.setting.influence]
      return sum + choiceStrength(item.setting, item.selected) * weight
    }, 0) / totalWeight

    const foundations = scoredItems.filter((item) => item.setting.foundational)
    const foundationPosture = foundations.length === 0
      ? 1
      : foundations.reduce((sum, item) => sum + choiceStrength(item.setting, item.selected), 0) / foundations.length
    const foundationCap = 0.45 + foundationPosture * 0.55
    const posture = Math.min(rawPosture, foundationCap)

    const rolloutPotential = items.reduce((sum, item) => sum + bandValue[item.setting.rolloutBand], 0)
    const ongoingPotential = items.reduce((sum, item) => sum + bandValue[item.setting.ongoingBand], 0)
    const rolloutLoad = items.reduce((sum, item) => sum + bandValue[item.setting.rolloutBand] * effortFactor(item.setting, item.selected), 0) / rolloutPotential
    const ongoingLoad = items.reduce((sum, item) => sum + bandValue[item.setting.ongoingBand] * effortFactor(item.setting, item.selected), 0) / ongoingPotential

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
