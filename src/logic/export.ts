import { catalog, priorityOptions } from "../catalog"
import { catalogMetadata } from "../catalogMetadata"
import { resolveProfile } from "./capabilities"
import { buildPlanSignature, intentAxes, intentAxisDefinitions, intentLabel } from "./intent"
import {
  buildPlanReviewAnalysis,
  getDecisionReviewStatus,
  getRequirementEvaluation,
} from "./readiness"
import type { ExcludedDecision } from "./readiness"
import { buildDomainProfiles } from "./scoring"
import {
  accountModelLabels,
  authenticationLabels,
  basePlanLabels,
  copilotPlanLabels,
  currentStateLabels,
  deploymentLabels,
  licensedProductLabels,
  licensedProductOrder,
  licenseStatusLabels,
  planningScopeLabels,
  planningScopeOrder,
  provisioningLabels,
  repositoryVisibilityLabels,
} from "../profileLabels"
import type {
  Plan,
  RecommendedSetting,
  Setting,
  Source,
} from "../types"

export const EXPORT_SCHEMA_NAME = "github-enterprise-settings-configurator.desired-state"
export const EXPORT_SCHEMA_VERSION = 2
export type ExportFormat = "json" | "markdown"

const generatedAt = () => new Date().toISOString()

const selectedChoice = (item: RecommendedSetting) =>
  item.setting.choices.find((choice) => choice.id === item.selected)

const recommendedChoice = (item: RecommendedSetting) =>
  item.setting.choices.find((choice) => choice.id === item.recommended)

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
  const analysis = buildPlanReviewAnalysis(plan, settings, reviewedSettingIds)
  const reviewedIds = new Set(analysis.reviewedSettingIds)
  const resolved = resolveProfile(plan.profile)
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
      reviewStatus: getDecisionReviewStatus(item, reviewedIds),
      selectionSource: plan.selections[setting.id] === selected ? "explicit-selection" : "generated-recommendation",
      applicability: {
        status: "applicable" as const,
        reason: "Catalog availability requirements are satisfied by the resolved profile capabilities.",
        requirements: getRequirementEvaluation(setting.availability, resolved.capabilities),
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
    artifactStatus: analysis.readiness.artifactStatus,
    readiness: analysis.readiness,
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
      applicableDecisionCount: analysis.applicableDecisionCount,
      applicableEditableDecisionCount: analysis.readiness.applicableEditableDecisionCount,
      excludedDecisionCount: analysis.excludedDecisions.length,
      reviewedDecisionCount: analysis.readiness.reviewedDecisionCount,
      derivedDecisionCount: analysis.derivedDecisionCount,
      unreviewedDecisionCount: analysis.readiness.remainingDecisionCount,
      remainingDecisionCount: analysis.readiness.remainingDecisionCount,
      overrideCount: analysis.overrideCount,
    },
    caveats: analysis.caveats,
    reviewedSettingIds: analysis.reviewedSettingIds,
    domainProfiles: buildDomainProfiles(settings),
    implementationSteps: decisions.map((decision) => ({
      order: decision.order,
      decisionId: decision.id,
      domain: decision.domain,
      desiredStateId: decision.selected,
      reviewStatus: decision.reviewStatus,
    })),
    settings: decisions,
    excludedDecisions: analysis.excludedDecisions,
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
  const analysis = buildPlanReviewAnalysis(plan, settings, reviewedSettingIds)
  const reviewedIds = new Set(analysis.reviewedSettingIds)
  const excluded = analysis.excludedDecisions
  const caveats = analysis.caveats
  const licensedProductLines = licensedProductOrder
    .map((product) => `- ${licensedProductLabels[product]}: ${licenseStatusLabels[profile.licensedProducts[product]]}`)
  const planningScopeLines = planningScopeOrder
    .map((scope) => `- ${planningScopeLabels[scope]}: ${profile.planningScope[scope] ? "Included" : "Not included"}`)
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
      const status = getDecisionReviewStatus(item, reviewedIds)
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
    `# GitHub Enterprise ${analysis.readiness.artifactStatus} desired-state handoff`,
    "",
    "## Purpose and how to use this document",
    "",
    "Use this human-readable handoff to review decisions with accountable owners, confirm prerequisites and evidence, then work the implementation checklist in the catalog order shown. Checkboxes are intentionally left open for the delivery team; review state is recorded separately.",
    "",
    "This document does not inspect, validate, or change a GitHub tenant. It is not a compliance assessment or proof of product availability.",
    "",
    "## Plan summary",
    `- Generated: ${generatedAt()}`,
    `- Readiness status: ${analysis.readiness.status === "ready-for-handoff" ? "Ready for handoff" : "Draft"}`,
    `- Artifact status: ${analysis.readiness.artifactStatus}`,
    `- Applicable decisions: ${settings.length}`,
    `- Applicable editable decisions: ${analysis.readiness.applicableEditableDecisionCount}`,
    `- Excluded / not applicable: ${excluded.length}`,
    `- Reviewed editable decisions: ${analysis.readiness.reviewedDecisionCount}`,
    `- Remaining editable decisions: ${analysis.readiness.remainingDecisionCount}`,
    `- Derived profile decisions: ${analysis.derivedDecisionCount}`,
    `- Unreviewed editable decisions: ${analysis.readiness.remainingDecisionCount}`,
    `- Deliberate overrides: ${analysis.overrideCount}`,
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
    ...planningScopeLines,
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

export const exportFilename = (
  format: ExportFormat,
  artifactStatus: "draft" | "final",
): string => format === "json"
  ? `github-enterprise-${artifactStatus}-desired-state.json`
  : `github-enterprise-${artifactStatus}-review-handoff.md`
