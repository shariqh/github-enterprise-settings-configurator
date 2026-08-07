import { priorityOptions } from "../catalog"
import { buildPlanSignature, intentAxes, intentAxisDefinitions, intentLabel } from "./intent"
import { buildDomainProfiles } from "./scoring"
import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CopilotPlan,
  CurrentState,
  Deployment,
  LicenseStatus,
  LicensedProductId,
  Plan,
  ProvisioningMethod,
  RecommendedSetting,
  RepositoryVisibility,
} from "../types"

const date = () => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date())

const deploymentLabels: Record<Deployment, string> = {
  dotcom: "GitHub Enterprise Cloud",
  residency: "GHE.com data residency",
  ghes: "GitHub Enterprise Server",
}

const basePlanLabels: Record<BasePlan, string> = {
  team: "Team",
  enterprise: "Enterprise",
  unknown: "Unknown",
}

const accountModelLabels: Record<AccountModel, string> = {
  personal: "Personal accounts",
  managed: "Managed user accounts (EMU)",
  instance: "Instance accounts",
  unknown: "Unknown",
}

const authenticationLabels: Record<AuthenticationMethod, string> = {
  github: "GitHub authentication",
  saml: "SAML SSO",
  oidc: "OIDC SSO",
  "built-in": "Built-in authentication",
  ldap: "LDAP",
  cas: "CAS",
  unknown: "Unknown",
}

const provisioningLabels: Record<ProvisioningMethod, string> = {
  none: "None",
  "scim-access": "SCIM (SSO-triggered access)",
  scim: "SCIM provisioning",
  jit: "Just-in-time provisioning",
  ldap: "LDAP sync",
  "first-sign-in": "First sign-in provisioning",
  manual: "Manual provisioning",
  unknown: "Unknown",
}

const repositoryVisibilityLabels: Record<RepositoryVisibility, string> = {
  public: "Public",
  "private-internal": "Private/internal",
  mixed: "Mixed",
  unknown: "Unknown",
}

const currentStateLabels: Record<CurrentState, string> = {
  greenfield: "Greenfield",
  existing: "Existing tenant",
  migration: "Migration in progress",
  unknown: "Unknown",
}

const licenseStatusLabels: Record<LicenseStatus, string> = {
  unlicensed: "Not licensed",
  licensed: "Licensed",
  unknown: "Unknown",
}

const copilotPlanLabels: Record<CopilotPlan, string> = {
  none: "None",
  business: "Copilot Business",
  enterprise: "Copilot Enterprise",
  unknown: "Unknown",
}

const licensedProductLabels: Record<LicensedProductId, string> = {
  secretProtection: "Secret Protection",
  codeSecurity: "Code Security",
  codeQuality: "Code Quality",
}

/**
 * settings is already applicable-only (RecommendedSetting carries only the
 * Recommended/Override dispositions), so no additional "not applicable"
 * filtering happens here. reviewedSettingIds is still narrowed to the
 * applicable set in case the caller passed review state for settings that
 * are no longer applicable to the current profile.
 */
export const exportObject = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
) => {
  const applicableIds = new Set(settings.map((item) => item.setting.id))
  const applicableReviewedSettingIds = reviewedSettingIds.filter((id) => applicableIds.has(id))

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    scope: "Desired-state configurator plan; not observed tenant state.",
    profile: plan.profile,
    intent: plan.intent,
    planSignature: buildPlanSignature(plan.intent, settings),
    priorities: plan.priorities,
    reviewedSettingIds: applicableReviewedSettingIds,
    domainProfiles: buildDomainProfiles(settings),
    settings: settings.map(({ setting, selected, disposition }) => ({
      id: setting.id,
      domain: setting.domain,
      title: setting.title,
      selected,
      disposition,
      scope: setting.scope,
      role: setting.role,
      applyMethod: setting.applyMethod,
      sources: setting.sources,
    })),
  }
}

export const buildMarkdown = (plan: Plan, settings: RecommendedSetting[]): string => {
  const profile = plan.profile
  const profiles = buildDomainProfiles(settings)
  const signature = buildPlanSignature(plan.intent, settings)
  const licensedProductLines = (Object.keys(licensedProductLabels) as LicensedProductId[])
    .map((product) => `- ${licensedProductLabels[product]}: ${licenseStatusLabels[profile.licensedProducts[product]]}`)

  const lines = [
    "# GitHub Enterprise Settings Configurator",
    "",
    `Generated ${date()}. This is a desired-state plan, not observed tenant state or a compliance assessment.`,
    "",
    "## Target profile",
    `- Deployment: ${deploymentLabels[profile.deployment]}`,
    `- Base plan: ${basePlanLabels[profile.basePlan]}`,
    `- Account model: ${accountModelLabels[profile.accountModel]}`,
    `- Authentication: ${authenticationLabels[profile.authentication]}`,
    `- Provisioning: ${provisioningLabels[profile.provisioning]}`,
    `- Repository visibility: ${repositoryVisibilityLabels[profile.repositoryVisibility]}`,
    `- Current state: ${currentStateLabels[profile.currentState]}`,
    "",
    "## Licensed products",
    ...licensedProductLines,
    `- Copilot: ${copilotPlanLabels[profile.licensedProducts.copilot]}`,
    "",
    "## Planning scope",
    `- GitHub Actions: ${profile.planningScope.actions ? "Included" : "Not included"}`,
    `- Audit log: ${profile.planningScope.audit ? "Included" : "Not included"}`,
    "",
    "## Planning intent",
    ...intentAxes.map((axis) => `- ${intentAxisDefinitions[axis].label}: ${intentLabel(axis, plan.intent[axis])}`),
    `- Plan signature: ${signature.headline}`,
    `- Interpretation: ${signature.narrative}`,
    "",
    "## Priorities",
    ...(plan.priorities.length ? plan.priorities.map((priority) => `- ${priorityOptions.find((option) => option.id === priority)?.label ?? priority}`) : ["- No additional priority selected"]),
    "",
    "## Relative domain profile",
    ...profiles.map((item) => `- **${item.domain}** — control influence ${item.postureLabel}; rollout effort ${item.rolloutBand}; ongoing effort ${item.ongoingBand}${item.foundationLimited ? "; foundational choice limits the domain" : ""}`),
    "",
    "## Desired settings",
    ...settings.flatMap(({ setting, selected: choice, disposition }) => [
      `### ${setting.title}`,
      `- Disposition: ${disposition}`,
      `- Desired value: ${setting.choices.find((item) => item.id === choice)?.label ?? choice}`,
      `- Scope: ${setting.scope}`,
      `- Responsible role: ${setting.role}`,
      `- Apply method: ${setting.applyMethod}`,
      `- Sources: ${setting.sources.map((source) => `[${source.label}](${source.url}) — ${source.tier}`).join("; ")}`,
      "",
    ]),
    "## Boundaries",
    "- Static desired state only; no tenant observation, direct apply, or backend connection.",
    "- Settings that do not apply to this profile are omitted from the plan, not represented as gaps or divergence.",
    "- Unknown current-state evidence is not treated as a gap.",
    "- This plan provides decision support, not a universal security score, breach prediction, or cross-customer comparison.",
  ]
  return lines.join("\n")
}

export const download = (filename: string, contents: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([contents], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
