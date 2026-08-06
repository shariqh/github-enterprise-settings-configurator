import { catalog } from "../catalog"
import type { Plan, Profile, RecommendedSetting, Setting } from "../types"

const recommendationFor = (setting: Setting, plan: Plan): string => {
  const { profile, priorities } = plan
  if (setting.id === "enterprise-type") return profile.platform
  if (setting.id === "sso-scim" && profile.identity === "emu") return "saml-scim"
  if (setting.id === "verified-domains" && profile.currentState === "migration") return "verify-migration"
  if (setting.id === "workflow-token" && profile.currentState === "migration") return "migration"
  if (priorities.includes("security-rollout") && setting.id === "security-configuration") return "wave"
  if (setting.id === "security-configuration" && profile.currentState === "greenfield") return "baseline-all"
  if (setting.id === "included-usage-cap" && profile.currentState === "greenfield") return "cap-overage"
  if (priorities.includes("regulated-overlay") && setting.id === "audit-streaming") return "stream-siem"
  if (priorities.includes("copilot-cost") && setting.id === "included-usage-cap") return "cap-overage"
  if (priorities.includes("migration-ready") && setting.id === "default-branch-ruleset") return "pr-only"
  return setting.recommended
}

export const getRecommendedSettings = (plan: Plan): RecommendedSetting[] =>
  catalog.map((setting) => {
    const recommended = recommendationFor(setting, plan)
    const selected = plan.selections[setting.id] ?? recommended
    const applies = setting.applies(plan.profile)
    return {
      setting,
      recommended,
      selected,
      disposition: applies ? (selected === recommended ? "Recommended" : "Override") : "Not applicable",
    }
  })

export const getProfileWarnings = (profile: Profile): string[] => {
  const warnings: string[] = []
  if (profile.platform === "ghes" && profile.identity === "emu") {
    warnings.push("Enterprise Managed Users is a GitHub Enterprise Cloud model. Select personal accounts for GHES 3.21.")
  }
  if (profile.platform === "residency" && profile.identity === "personal") {
    warnings.push("GHE.com data residency requires Enterprise Managed Users (EMU).")
  }
  if (!profile.products.copilot && profile.entitlement === "copilot") {
    warnings.push("Copilot-only entitlement requires the Copilot product area.")
  }
  return warnings
}

export const isProfileValid = (profile: Profile): boolean => getProfileWarnings(profile).length === 0
