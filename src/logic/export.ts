import { priorityOptions, productLabels } from "../catalog"
import { buildPlanSignature, intentAxes, intentAxisDefinitions, intentLabel } from "./intent"
import { buildDomainProfiles } from "./scoring"
import type { Plan, RecommendedSetting } from "../types"

const date = () => new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date())

export const exportObject = (
  plan: Plan,
  settings: RecommendedSetting[],
  reviewedSettingIds: string[] = [],
) => ({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  scope: "Desired-state configurator plan; not observed tenant state.",
  profile: plan.profile,
  intent: plan.intent,
  planSignature: buildPlanSignature(plan.intent, settings),
  priorities: plan.priorities,
  reviewedSettingIds,
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
})

export const buildMarkdown = (plan: Plan, settings: RecommendedSetting[]): string => {
  const profile = plan.profile
  const selected = settings.filter((item) => item.disposition !== "Not applicable")
  const profiles = buildDomainProfiles(settings)
  const signature = buildPlanSignature(plan.intent, settings)
  const lines = [
    "# GitHub Enterprise Settings Configurator",
    "",
    `Generated ${date()}. This is a desired-state plan, not observed tenant state or a compliance assessment.`,
    "",
    "## Target profile",
    `- Hosting: ${profile.platform}`,
    `- Identity: ${profile.identity}`,
    `- Entitlement: ${profile.entitlement}`,
    `- Current state: ${profile.currentState}`,
    `- Products: ${(Object.keys(profile.products) as (keyof typeof productLabels)[]).filter((product) => profile.products[product]).map((product) => productLabels[product]).join(", ") || "none"}`,
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
    ...selected.flatMap(({ setting, selected: choice, disposition }) => [
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
    "- Unknown and not applicable are not represented as divergence.",
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
