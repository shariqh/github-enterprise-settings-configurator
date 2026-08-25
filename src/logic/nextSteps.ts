import type { DomainProfile } from "./scoring"
import type { PlanReviewAnalysis } from "./readiness"

export type NextStepLaneStatus = "attention" | "clear"

export interface NextStepLane {
  id: string
  title: string
  detail: string
  status: NextStepLaneStatus
}

const plural = (count: number, singular: string, pluralForm: string): string =>
  count === 1 ? singular : pluralForm

const domainList = (profiles: DomainProfile[]): string =>
  profiles.map((profile) => profile.domain).join(", ")

/**
 * Derives read-only, ephemeral "what happens next" lanes from the existing
 * canonical review analysis and domain profiles. This introduces no new
 * readiness, scoring, or applicability logic and no persisted state — every
 * lane is recomputed on each render from `buildPlanReviewAnalysis` and
 * `buildDomainProfiles` output. Lanes never carry assignment, checkboxes, or
 * due dates; they only interpret existing derived facts into a next action.
 */
export const buildNextStepLanes = (
  analysis: PlanReviewAnalysis,
  profiles: DomainProfile[],
): NextStepLane[] => {
  const remaining = analysis.readiness.remainingDecisionCount
  const overrideCount = analysis.overrideCount
  const caveatCount = analysis.caveats.length
  const exclusionCount = analysis.excludedDecisions.length
  const foundationLimited = profiles.filter((profile) => profile.foundationLimited)
  const highEffort = profiles.filter(
    (profile) => profile.rolloutBand === "High" || profile.ongoingBand === "High",
  )

  return [
    {
      id: "finish-unreviewed",
      title: "Finish unreviewed decisions with the right stakeholder",
      detail: remaining > 0
        ? `${remaining} applicable editable ${plural(remaining, "decision", "decisions")} still ${plural(remaining, "needs", "need")} the accountable role's review before this plan is ready for handoff.`
        : "Every applicable editable decision has already been reviewed.",
      status: remaining > 0 ? "attention" : "clear",
    },
    {
      id: "confirm-overrides",
      title: "Confirm the rationale and owner for deliberate overrides",
      detail: overrideCount > 0
        ? `${overrideCount} ${plural(overrideCount, "value differs", "values differ")} from the profile recommendation. Confirm each is a deliberate, owned constraint before handoff.`
        : "No overrides were selected, so there is no override rationale to confirm.",
      status: overrideCount > 0 ? "attention" : "clear",
    },
    {
      id: "validate-caveats",
      title: "Validate caveats, exclusions, licensing, deployment, and current docs",
      detail: caveatCount > 0 || exclusionCount > 0
        ? `${caveatCount} open ${plural(caveatCount, "caveat", "caveats")} and ${exclusionCount} excluded catalog ${plural(exclusionCount, "decision", "decisions")} come from the profile and capability model, not observed tenant state. Validate licensing, deployment, and current product documentation with the customer before treating either as fact.`
        : "No open caveats or excluded decisions were recorded. Licensing, deployment, and current product documentation are still worth confirming with the customer.",
      status: caveatCount > 0 || exclusionCount > 0 ? "attention" : "clear",
    },
    {
      id: "foundational-limits",
      title: "Address foundational constraints before downstream enhancements",
      detail: foundationLimited.length > 0
        ? `${foundationLimited.length} ${plural(foundationLimited.length, "domain", "domains")} (${domainList(foundationLimited)}) ${plural(foundationLimited.length, "is", "are")} capped by a foundational decision. Resolve that decision first; downstream enhancements in the same domain will not raise its ceiling.`
        : "No domain is currently capped by a foundational decision.",
      status: foundationLimited.length > 0 ? "attention" : "clear",
    },
    {
      id: "phase-high-effort",
      title: "Phase or pilot high-effort work",
      detail: highEffort.length > 0
        ? `${highEffort.length} ${plural(highEffort.length, "domain", "domains")} (${domainList(highEffort)}) ${plural(highEffort.length, "carries", "carry")} High rollout or ongoing effort. High effort reflects operational load, not weak security — consider a phased rollout or pilot scope rather than one cutover.`
        : "No domain currently carries High rollout or ongoing effort.",
      status: highEffort.length > 0 ? "attention" : "clear",
    },
    {
      id: "export-and-follow-up",
      title: "Export the handoff and schedule an owner-based follow-up",
      detail: analysis.readiness.isReady
        ? "This plan is ready for a final handoff export. Schedule the follow-up with each decision's accountable role."
        : "A draft handoff export is available for workshop continuity. Schedule the follow-up once the remaining decisions above are reviewed.",
      status: analysis.readiness.isReady ? "clear" : "attention",
    },
  ]
}
