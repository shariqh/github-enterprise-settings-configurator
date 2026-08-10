import { catalog, priorityOptions } from "../catalog"
import { catalogMetadata } from "../catalogMetadata"
import { resolveProfile } from "./capabilities"
import { buildPlanSignature, intentAxes, intentAxisDefinitions, intentLabel } from "./intent"
import { buildDomainProfiles } from "./scoring"
import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CapabilityId,
  CapabilityRequirement,
  CopilotPlan,
  CurrentState,
  Deployment,
  LicenseStatus,
  LicensedProductId,
  Plan,
  ProvisioningMethod,
  RecommendedSetting,
  RepositoryVisibility,
  Setting,
  Source,
} from "../types"

export const EXPORT_SCHEMA_NAME = "github-enterprise-settings-configurator.desired-state"
export const EXPORT_SCHEMA_VERSION = 2

const generatedAt = () => new Date().toISOString()

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

interface RequirementEvaluation {
  allOf: CapabilityId[]
  anyOf: CapabilityId[]
  noneOf: CapabilityId[]
  missingAllOf: CapabilityId[]
  anyOfSatisfied: boolean | null
  presentNoneOf: CapabilityId[]
}

interface ExcludedDecision {
  id: string
  domain: Setting["domain"]
  title: string
  applicability: {
    status: "excluded"
    reason: string
    requirements: RequirementEvaluation
  }
}

interface ExportCaveat {
  code: string
  message: string
  decisionIds?: string[]
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

const getExcludedDecisions = (
  plan: Plan,
  settings: RecommendedSetting[],
): ExcludedDecision[] => {
  const { capabilities } = resolveProfile(plan.profile)
  const includedIds = new Set(settings.map((item) => item.setting.id))
  return catalog
    .filter((setting) => !includedIds.has(setting.id))
    .map((setting) => ({
      id: setting.id,
      domain: setting.domain,
      title: setting.title,
      applicability: {
        status: "excluded" as const,
        reason: exclusionReason(setting, capabilities),
        requirements: evaluateRequirement(setting.availability, capabilities),
      },
    }))
}

const reviewStatus = (
  item: RecommendedSetting,
  reviewedIds: ReadonlySet<string>,
): "derived" | "reviewed" | "not-reviewed" =>
  item.setting.editable === false
    ? "derived"
    : reviewedIds.has(item.setting.id) ? "reviewed" : "not-reviewed"

const selectedChoice = (item: RecommendedSetting) =>
  item.setting.choices.find((choice) => choice.id === item.selected)

const recommendedChoice = (item: RecommendedSetting) =>
  item.setting.choices.find((choice) => choice.id === item.recommended)

const buildCaveats = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedIds: ReadonlySet<string>,
  excluded: ExcludedDecision[],
): ExportCaveat[] => {
  const resolved = resolveProfile(plan.profile)
  const caveats: ExportCaveat[] = [
    ...resolved.errors.map((issue) => ({ code: issue.code, message: issue.message })),
    ...resolved.warnings.map((issue) => ({ code: issue.code, message: issue.message })),
  ]
  const unreviewed = settings
    .filter((item) => item.setting.editable !== false && !reviewedIds.has(item.setting.id))
    .map((item) => item.setting.id)

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
  if (excluded.length > 0) {
    caveats.push({
      code: "default-no-exclusions",
      message: `${excluded.length} catalog decision${excluded.length === 1 ? " is" : "s are"} excluded by the resolved capability model. Exclusion is a default-no planning result, not live product or tenant validation.`,
      decisionIds: excluded.map((item) => item.id),
    })
  }
  return caveats
}

const sourceLinks = (sources: Source[]): string =>
  sources.map((source) => `[${source.label}](${source.url}) — ${source.tier}`).join("; ")

const sourceLines = (sources: Source[]): string[] => {
  const authoritative = sources.filter((source) => source.tier === "GitHub Docs · mechanics")
  const supporting = sources.filter((source) => source.tier !== "GitHub Docs · mechanics")
  return [
    ...(authoritative.length > 0
      ? [`  - Authoritative product sources: ${sourceLinks(authoritative)}`]
      : ["  - Authoritative product sources: None recorded in the catalog."]),
    ...(supporting.length > 0 ? [`  - Supporting sources: ${sourceLinks(supporting)}`] : []),
  ]
}

const priorityDetails = (plan: Plan) =>
  plan.priorities.map((id) => {
    const option = priorityOptions.find((priority) => priority.id === id)
    return { id, label: option?.label ?? id, description: option?.description ?? "" }
  })

/**
 * `settings` is already applicable-only. The top-level schemaVersion and
 * settings[].id/selected fields remain compatible with the existing v2 import
 * path; the richer fields below are additive for machine consumers.
 */
export const exportObject = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
) => {
  const applicableIds = new Set(settings.map((item) => item.setting.id))
  const applicableReviewedSettingIds = reviewedSettingIds.filter((id) => applicableIds.has(id))
  const reviewedIds = new Set(applicableReviewedSettingIds)
  const resolved = resolveProfile(plan.profile)
  const excludedDecisions = getExcludedDecisions(plan, settings)
  const caveats = buildCaveats(plan, settings, reviewedIds, excludedDecisions)
  const decisions = settings.map((item, index) => {
    const { setting, selected, recommended, disposition } = item
    const choice = selectedChoice(item)
    const recommendedValue = recommendedChoice(item)
    return {
      order: index + 1,
      id: setting.id,
      domain: setting.domain,
      title: setting.title,
      selected,
      desiredState: {
        id: selected,
        label: choice?.label ?? selected,
        description: choice?.description ?? "",
      },
      recommendedState: {
        id: recommended,
        label: recommendedValue?.label ?? recommended,
      },
      disposition,
      reviewStatus: reviewStatus(item, reviewedIds),
      selectionSource: plan.selections[setting.id] === selected ? "explicit-selection" : "generated-recommendation",
      applicability: {
        status: "applicable" as const,
        reason: "Catalog availability requirements are satisfied by the resolved profile capabilities.",
        requirements: evaluateRequirement(setting.availability, resolved.capabilities),
      },
      rationale: setting.rationale,
      tradeoff: setting.tradeoff,
      prerequisites: setting.prerequisites,
      consequences: setting.consequences,
      scope: setting.scope,
      role: setting.role,
      applyMethod: setting.applyMethod,
      influence: setting.influence,
      rolloutBand: setting.rolloutBand,
      ongoingBand: setting.ongoingBand,
      sources: setting.sources,
    }
  })

  return {
    schema: {
      name: EXPORT_SCHEMA_NAME,
      version: EXPORT_SCHEMA_VERSION,
      compatibility: "Additive schema v2; importers may rely on profile, intent, priorities, settings[].id/selected, and reviewedSettingIds.",
    },
    schemaVersion: EXPORT_SCHEMA_VERSION,
    artifactType: "machine-readable desired-state contract",
    generatedAt: generatedAt(),
    purpose: "Preserve a versioned desired-state plan for configurator re-entry and authorized downstream adapters.",
    scope: "Desired-state configurator plan; not observed tenant state.",
    limitations: [
      "Does not inspect, validate, or change a GitHub tenant.",
      "Does not establish compliance or confirm product availability beyond the catalog evidence and resolved profile.",
      "Application outcomes must be validated by an authorized operator.",
    ],
    catalog: catalogMetadata,
    profile: plan.profile,
    capabilityContext: {
      resolvedCapabilities: [...resolved.capabilities],
      profileErrors: resolved.errors,
      profileWarnings: resolved.warnings,
      exclusionPolicy: "Catalog decisions remain excluded by default when capability requirements are not satisfied.",
    },
    intent: plan.intent,
    planningContext: {
      intent: intentAxes.map((axis) => ({
        id: axis,
        level: plan.intent[axis],
        label: intentAxisDefinitions[axis].label,
        valueLabel: intentLabel(axis, plan.intent[axis]),
      })),
      priorities: priorityDetails(plan),
      planSignature: buildPlanSignature(plan.intent, settings),
    },
    planSignature: buildPlanSignature(plan.intent, settings),
    priorities: plan.priorities,
    summary: {
      catalogDecisionCount: catalog.length,
      applicableDecisionCount: settings.length,
      excludedDecisionCount: excludedDecisions.length,
      reviewedDecisionCount: settings.filter((item) => reviewStatus(item, reviewedIds) === "reviewed").length,
      derivedDecisionCount: settings.filter((item) => reviewStatus(item, reviewedIds) === "derived").length,
      unreviewedDecisionCount: settings.filter((item) => reviewStatus(item, reviewedIds) === "not-reviewed").length,
      overrideCount: settings.filter((item) => item.disposition === "Override").length,
    },
    caveats,
    reviewedSettingIds: applicableReviewedSettingIds,
    domainProfiles: buildDomainProfiles(settings),
    implementationSteps: decisions.map((decision) => ({
      order: decision.order,
      decisionId: decision.id,
      domain: decision.domain,
      desiredStateId: decision.selected,
      reviewStatus: decision.reviewStatus,
    })),
    settings: decisions,
    excludedDecisions,
  }
}

export const buildMarkdown = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
): string => {
  const profile = plan.profile
  const profiles = buildDomainProfiles(settings)
  const signature = buildPlanSignature(plan.intent, settings)
  const reviewedIds = new Set(reviewedSettingIds)
  const excluded = getExcludedDecisions(plan, settings)
  const caveats = buildCaveats(plan, settings, reviewedIds, excluded)
  const licensedProductLines = (Object.keys(licensedProductLabels) as LicensedProductId[])
    .map((product) => `- ${licensedProductLabels[product]}: ${licenseStatusLabels[profile.licensedProducts[product]]}`)
  const domainGroups = settings.reduce<Map<Setting["domain"], RecommendedSetting[]>>((groups, item) => {
    const current = groups.get(item.setting.domain) ?? []
    current.push(item)
    groups.set(item.setting.domain, current)
    return groups
  }, new Map())
  const excludedGroups = excluded.reduce<Map<Setting["domain"], ExcludedDecision[]>>((groups, item) => {
    const current = groups.get(item.domain) ?? []
    current.push(item)
    groups.set(item.domain, current)
    return groups
  }, new Map())

  const checklistLines = [...domainGroups.entries()].flatMap(([domain, items]) => [
    `### ${domain}`,
    "",
    ...items.flatMap((item) => {
      const index = settings.findIndex((candidate) => candidate.setting.id === item.setting.id) + 1
      const status = reviewStatus(item, reviewedIds)
      const choice = selectedChoice(item)
      return [
        `- [ ] **${index}. ${item.setting.title} — ${choice?.label ?? item.selected}**`,
        `  - Decision ID: \`${item.setting.id}\`; review state: ${status}; disposition: ${item.disposition.toLowerCase()}.`,
        `  - Why: ${item.setting.rationale}`,
        `  - Scope / owner: ${item.setting.scope} / ${item.setting.role}`,
        `  - Apply method: ${item.setting.applyMethod}`,
        `  - Prerequisites: ${item.setting.prerequisites}`,
        `  - Consequences: ${item.setting.consequences}`,
        `  - Tradeoff: ${item.setting.tradeoff}`,
        ...sourceLines(item.setting.sources),
        "",
      ]
    }),
  ])

  const excludedLines = excluded.length === 0
    ? ["No catalog decisions were excluded for this profile."]
    : [...excludedGroups.entries()].flatMap(([domain, items]) => [
      `### ${domain}`,
      ...items.map((item) => `- **${item.title}** (\`${item.id}\`) — ${item.applicability.reason}`),
      "",
    ])

  const lines = [
    "# GitHub Enterprise desired-state handoff",
    "",
    "## Purpose and how to use this document",
    "",
    "Use this human-readable handoff to review decisions with accountable owners, confirm prerequisites and evidence, then work the implementation checklist in the catalog order shown. Checkboxes are intentionally left open for the delivery team; review state is recorded separately.",
    "",
    "This document does not inspect, validate, or change a GitHub tenant. It is not a compliance assessment or proof of product availability.",
    "",
    "## Plan summary",
    `- Generated: ${generatedAt()}`,
    `- Applicable decisions: ${settings.length}`,
    `- Excluded / not applicable: ${excluded.length}`,
    `- Reviewed editable decisions: ${settings.filter((item) => reviewStatus(item, reviewedIds) === "reviewed").length}`,
    `- Derived profile decisions: ${settings.filter((item) => reviewStatus(item, reviewedIds) === "derived").length}`,
    `- Unreviewed editable decisions: ${settings.filter((item) => reviewStatus(item, reviewedIds) === "not-reviewed").length}`,
    `- Deliberate overrides: ${settings.filter((item) => item.disposition === "Override").length}`,
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
    "### Licensed products",
    ...licensedProductLines,
    `- Copilot: ${copilotPlanLabels[profile.licensedProducts.copilot]}`,
    "",
    "### Planning scope",
    `- GitHub Actions: ${profile.planningScope.actions ? "Included" : "Not included"}`,
    `- Audit log: ${profile.planningScope.audit ? "Included" : "Not included"}`,
    "",
    "### Planning intent and priorities",
    ...intentAxes.map((axis) => `- ${intentAxisDefinitions[axis].label}: ${intentLabel(axis, plan.intent[axis])}`),
    `- Plan signature: ${signature.headline}`,
    `- Interpretation: ${signature.narrative}`,
    ...(plan.priorities.length
      ? plan.priorities.map((priority) => `- Priority: ${priorityOptions.find((option) => option.id === priority)?.label ?? priority}`)
      : ["- Priority: No additional priority selected"]),
    "",
    "## Assumptions and caveats",
    ...(caveats.length > 0
      ? caveats.map((caveat) => `- **${caveat.code}:** ${caveat.message}`)
      : ["- No unresolved profile warnings or review caveats were recorded."]),
    "- Unknown current-state evidence is never treated as a gap.",
    "- Excluded decisions reflect catalog capability filters and default-no planning, not live tenant validation.",
    "",
    "## Relative domain profile",
    "These are separate, relative planning signals rather than a composite score.",
    ...profiles.map((item) => `- **${item.domain}** — control influence ${item.postureLabel}; rollout effort ${item.rolloutBand}; ongoing effort ${item.ongoingBand}${item.foundationLimited ? "; foundational choice limits the domain" : ""}`),
    "",
    "## Implementation checklist",
    "Work within each domain in the existing catalog order. Priorities and planning intent tune desired values; they do not assert hidden technical dependencies.",
    "",
    ...(checklistLines.length > 0 ? checklistLines : ["No applicable decisions were generated.", ""]),
    "## Excluded / not applicable catalog decisions",
    "These items are shown for traceability and remain outside the implementation checklist. Exclusion does not establish live product availability or tenant state.",
    "",
    ...excludedLines,
    "## Boundaries",
    "- Static desired state only; no tenant observation, direct apply, or backend connection.",
    "- This plan provides decision support, not a universal security score, breach prediction, or cross-customer comparison.",
    "- An authorized operator must validate target capability, access, implementation, and outcome.",
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
