import { catalog } from "../catalog"
import { getProfileErrors, getProfileWarnings as getCapabilityWarnings, meetsCapabilityRequirement, resolveProfile } from "./capabilities"
import type { Choice, IntentLevel, Plan, Profile, RecommendedSetting, Setting } from "../types"

/**
 * Maps the profile's account model, authentication method, and provisioning
 * method to the matching `identity-lifecycle` choice id. The identity
 * compatibility matrix in capabilities.ts guarantees at most one of these
 * predicates matches a valid profile.
 */
const identityLifecycleChoiceFor = (profile: Profile): string => {
  const { accountModel, authentication, provisioning } = profile
  if (accountModel === "personal" && authentication === "saml" && provisioning === "scim-access") {
    return "personal-access-scim"
  }
  if (accountModel === "personal" && authentication === "saml") return "personal-saml"
  if (accountModel === "personal") return "personal-github"
  if (accountModel === "managed" && authentication === "saml") return "emu-saml-scim"
  if (accountModel === "managed" && authentication === "oidc") return "emu-oidc-scim"
  if (accountModel === "instance" && authentication === "saml" && provisioning === "jit") return "ghes-saml-jit"
  if (accountModel === "instance" && authentication === "saml" && provisioning === "scim") return "ghes-saml-scim-preview"
  if (accountModel === "instance" && authentication === "ldap") return "ghes-ldap"
  if (accountModel === "instance" && authentication === "cas") return "ghes-cas"
  if (accountModel === "instance") return "ghes-built-in"
  return "personal-github"
}

const baseRecommendationFor = (setting: Setting, plan: Plan): string => {
  const { profile, priorities } = plan
  if (setting.id === "enterprise-type") return profile.deployment
  if (setting.id === "identity-lifecycle") return identityLifecycleChoiceFor(profile)
  if (setting.id === "verified-domains" && profile.currentState === "migration") return "verify-migration"
  if (setting.id === "workflow-token" && profile.currentState === "migration") return "migration"
  if (priorities.includes("security-rollout") && setting.id === "secret-protection-configuration") return "wave"
  if (priorities.includes("security-rollout") && setting.id === "code-security-configuration") return "wave"
  if (setting.id === "secret-protection-configuration" && profile.currentState === "greenfield") return "baseline-all"
  if (setting.id === "code-security-configuration" && profile.currentState === "greenfield") return "baseline-all"
  if (setting.id === "included-usage-cap" && profile.currentState === "greenfield") return "cap-overage"
  if (priorities.includes("regulated-overlay") && setting.id === "audit-streaming") return "stream-siem"
  if (priorities.includes("copilot-cost") && setting.id === "included-usage-cap") return "cap-overage"
  if (priorities.includes("migration-ready") && setting.id === "default-branch-ruleset") return "pr-only"
  return setting.recommended
}

const intentDirection = (level: IntentLevel): number => 1 - level

/**
 * Derives the recommended choice id for a setting, constrained to the
 * choices that are available for the resolved profile. Intent tuning can
 * only move the recommendation within `filteredChoices`, so it can never
 * weaken a hard derived/identity/product constraint by selecting an
 * unavailable choice.
 */
const recommendationFor = (setting: Setting, filteredChoices: Choice[], plan: Plan): string => {
  const baseRecommendation = baseRecommendationFor(setting, plan)
  const isAvailable = filteredChoices.some((choice) => choice.id === baseRecommendation)
  const fallback = isAvailable ? baseRecommendation : (filteredChoices[0]?.id ?? baseRecommendation)

  if (setting.editable === false) return fallback

  const baseIndex = filteredChoices.findIndex((choice) => choice.id === fallback)
  if (baseIndex < 0) return fallback

  const guardrailDirection = intentDirection(plan.intent.guardrailStrength) * 2
  const rolloutDirection = setting.rolloutBand === "High"
    ? intentDirection(plan.intent.rolloutPace)
    : 0
  const capacityDirection = setting.ongoingBand === "High"
    ? intentDirection(plan.intent.operationalCapacity)
    : 0
  const combinedDirection = guardrailDirection + rolloutDirection + capacityDirection
  if (combinedDirection === 0) return fallback

  const choiceOffset = combinedDirection > 0 ? 1 : -1
  const adjustedIndex = Math.max(0, Math.min(filteredChoices.length - 1, baseIndex + choiceOffset))
  return filteredChoices[adjustedIndex].id
}

export const getRecommendedSettings = (plan: Plan): RecommendedSetting[] => {
  const { capabilities } = resolveProfile(plan.profile)

  const applicableSettings = catalog.filter((setting) =>
    meetsCapabilityRequirement(capabilities, setting.availability))

  return applicableSettings.flatMap((setting) => {
    const filteredChoices = setting.choices.filter((choice) =>
      meetsCapabilityRequirement(capabilities, choice.availability))
    if (filteredChoices.length === 0) return []

    const availableSetting: Setting = { ...setting, choices: filteredChoices }

    const recommended = recommendationFor(setting, filteredChoices, plan)
    const requestedSelection = setting.editable === false
      ? undefined
      : plan.selections[setting.id]
    const selected = requestedSelection && filteredChoices.some((choice) => choice.id === requestedSelection)
      ? requestedSelection
      : recommended

    return [{
      setting: availableSetting,
      recommended,
      selected,
      disposition: selected === recommended ? "Recommended" : "Override",
    }]
  })
}

export const getProfileWarnings = (profile: Profile): string[] => [
  ...getProfileErrors(profile).map((issue) => issue.message),
  ...getCapabilityWarnings(profile).map((issue) => issue.message),
]

export const isProfileValid = (profile: Profile): boolean => getProfileErrors(profile).length === 0
