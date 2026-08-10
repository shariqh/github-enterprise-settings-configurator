import { buildDomainProfiles } from "../logic/scoring"
import type { ExportFormat } from "../logic/export"
import type { PlanReviewAnalysis } from "../logic/readiness"
import { DomainLandscape, PlanSignature } from "./VisualPlanning"
import type { Domain, PlanIntent, RecommendedSetting } from "../types"

interface ReviewProps {
  settings: RecommendedSetting[]
  intent: PlanIntent
  analysis: PlanReviewAnalysis
  pendingDraftExport: ExportFormat | null
  onCancelDraftExport: () => void
  onConfirmDraftExport: () => void
  onRequestExport: (format: ExportFormat) => void
  onOpenDomain: (domain: Domain) => void
}

const choiceLabel = (item: RecommendedSetting): string =>
  item.setting.choices.find((choice) => choice.id === item.selected)?.label ?? item.selected

export function Review({
  settings,
  intent,
  analysis,
  pendingDraftExport,
  onCancelDraftExport,
  onConfirmDraftExport,
  onRequestExport,
  onOpenDomain,
}: ReviewProps) {
  const { readiness } = analysis
  const ready = readiness.isReady
  const recommended = settings.filter((item) => item.disposition === "Recommended")
  const overrides = settings.filter((item) => item.disposition === "Override")
  const unreviewed = analysis.decisions.filter((item) => item.reviewStatus === "not-reviewed")
  const derived = analysis.decisions.filter((item) => item.reviewStatus === "derived")
  const profiles = buildDomainProfiles(settings)
  const excludedByDomain = analysis.excludedDecisions.reduce<Map<Domain, typeof analysis.excludedDecisions>>(
    (groups, item) => {
      const current = groups.get(item.domain) ?? []
      current.push(item)
      groups.set(item.domain, current)
      return groups
    },
    new Map(),
  )
  const pendingDraftLabel = pendingDraftExport === "json"
    ? "desired-state contract"
    : "review handoff"

  return (
    <section className="review-page" aria-labelledby="review-heading">
      <header className="content-heading content-heading--intro">
        <div>
          <span className="section-kicker">Review and export</span>
          <h1 data-workspace-focus="section" id="review-heading" tabIndex={-1}>
            {ready ? "Ready for handoff." : "Draft desired state."}
          </h1>
          <p>
            {ready
              ? "Every applicable editable decision has been reviewed. Derived values remain identified separately."
              : "Generated recommendations and explicit values are not accepted until each applicable editable decision is reviewed."}
          </p>
        </div>
      </header>

      <div className={`readiness-banner ${ready ? "readiness-banner--ready" : ""}`} role="status">
        <strong>{ready ? "Ready for handoff" : "Draft"}</strong>
        <span>
          {ready
            ? `${readiness.reviewedDecisionCount} of ${readiness.applicableEditableDecisionCount} applicable editable decisions reviewed.`
            : `${readiness.reviewedDecisionCount} of ${readiness.applicableEditableDecisionCount} applicable editable decisions reviewed; ${readiness.remainingDecisionCount} remaining.`}
        </span>
      </div>

      <div className="review-summary">
        <div><strong>{settings.length}</strong><span>applicable decisions</span></div>
        <div><strong>{readiness.reviewedDecisionCount} / {readiness.applicableEditableDecisionCount}</strong><span>editable decisions reviewed</span></div>
        <div><strong>{readiness.remainingDecisionCount}</strong><span>editable decisions remaining</span></div>
        <div><strong>{derived.length}</strong><span>derived decisions</span></div>
        <div><strong>{recommended.length}</strong><span>values matching recommendations</span></div>
        <div><strong>{overrides.length}</strong><span>deliberate overrides</span></div>
      </div>

      <section className="review-section">
        <header>
          <div>
            <h2>Decision review state</h2>
            <p>Recommendations, explicit selections, derived values, and overrides retain distinct status.</p>
          </div>
        </header>
        {unreviewed.length > 0 ? (
          <details className="review-disclosure" open>
            <summary>{unreviewed.length} unreviewed editable decision{unreviewed.length === 1 ? "" : "s"}</summary>
            <ul className="review-result-list">
              {unreviewed.map((decision) => (
                <li key={decision.id}>
                  <span>
                    <strong>{decision.title}</strong>
                    <small>{decision.domain} · <code>{decision.id}</code></small>
                  </span>
                  <span>
                    {decision.selectionSource === "explicit-selection" ? "Explicit value" : "Generated recommendation"}
                    {" · "}
                    {decision.disposition === "Override" ? "Override" : "Matches recommendation"}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="empty-state">All applicable editable decisions have been reviewed.</p>
        )}
        {derived.length > 0 && (
          <details className="review-disclosure">
            <summary>{derived.length} profile-derived decision{derived.length === 1 ? "" : "s"} (do not require review)</summary>
            <ul className="review-result-list">
              {derived.map((decision) => (
                <li key={decision.id}>
                  <span>
                    <strong>{decision.title}</strong>
                    <small>{decision.domain} · <code>{decision.id}</code></small>
                  </span>
                  <span>Derived from the target profile</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="review-visuals">
        <PlanSignature intent={intent} settings={settings} />
        <DomainLandscape onSelectDomain={onOpenDomain} settings={settings} />
      </div>

      <section className="review-section">
        <header>
          <h2>Relative domain profile</h2>
          <p>Control influence, rollout effort, and ongoing effort are shown independently.</p>
        </header>
        <div className="domain-profile-list">
          {profiles.map((profile) => (
            <article className="domain-profile-row" key={profile.domain}>
              <div>
                <strong>{profile.domain}</strong>
                {profile.foundationLimited && <span>Foundational choice limits this domain</span>}
              </div>
              <Metric ariaLabel={`${profile.domain} control influence`} label="Control influence" value={profile.posture} valueLabel={profile.postureLabel} />
              <Metric ariaLabel={`${profile.domain} rollout effort`} label="Rollout effort" value={profile.rolloutLoad} valueLabel={profile.rolloutBand} />
              <Metric ariaLabel={`${profile.domain} ongoing effort`} label="Ongoing effort" value={profile.ongoingLoad} valueLabel={profile.ongoingBand} />
            </article>
          ))}
        </div>
      </section>

      <section className="review-section">
        <header>
          <h2>Deliberate overrides</h2>
          <p>These values differ from the profile-specific recommendation.</p>
        </header>
        {overrides.length > 0 ? (
          <ul className="override-list">
            {overrides.map((item) => (
              <li key={item.setting.id}>
                <span><strong>{item.setting.title}</strong><small>{item.setting.domain}</small></span>
                <span>{choiceLabel(item)} · {analysis.decisions.find((decision) => decision.id === item.setting.id)?.reviewStatus === "reviewed" ? "Reviewed" : "Not reviewed"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No overrides have been selected.</p>
        )}
      </section>

      <section className="review-section">
        <header>
          <div>
            <h2>Unresolved caveats and excluded decisions</h2>
            <p>These planning results come from the documented profile and capability filters, not live tenant or product validation.</p>
          </div>
        </header>
        {analysis.caveats.length > 0 ? (
          <ul className="caveat-list">
            {analysis.caveats.map((caveat) => (
              <li key={caveat.code}>
                <strong>{caveat.code}</strong>
                <span>{caveat.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No unresolved profile warnings or review caveats were recorded.</p>
        )}
        <details className="review-disclosure">
          <summary>
            {analysis.excludedDecisions.length} excluded / default-no catalog decision{analysis.excludedDecisions.length === 1 ? "" : "s"}
          </summary>
          <p className="review-disclosure__note">
            Exclusion means the resolved profile did not satisfy catalog capability requirements. It does not confirm live availability or tenant configuration.
          </p>
          {[...excludedByDomain.entries()].map(([domain, items]) => (
            <section className="excluded-domain" key={domain}>
              <h3>{domain} · {items.length}</h3>
              <ul className="review-result-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.title}</strong>
                      <small><code>{item.id}</code></small>
                    </span>
                    <span>{item.applicability.reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      </section>

      <section className="export-section">
        <header>
          <h2>{ready ? "Export the final handoff" : "Export this draft"}</h2>
          <p>
            {ready
              ? "The final artifacts record complete review state. Neither validates or applies tenant settings."
              : "Draft exports preserve workshop continuity, but they remain incomplete and are not final implementation handoffs."}
          </p>
        </header>
        <div className="export-options">
          <article className="export-option">
            <div>
              <strong>{ready ? "Final review handoff" : "Draft review handoff"}</strong>
              <span>Markdown · for people</span>
            </div>
            <p>An ordered checklist with desired values, owners, prerequisites, caveats, exclusions, and evidence links.</p>
            <button className="button button--secondary" onClick={() => onRequestExport("markdown")} type="button">
              Download {ready ? "final" : "draft"} review handoff (.md)
            </button>
          </article>
          <article className="export-option">
            <div>
              <strong>{ready ? "Final desired-state contract" : "Draft desired-state contract"}</strong>
              <span>JSON · for tools and re-entry</span>
            </div>
            <p>A versioned contract with stable IDs, planning context, review state, and exclusions. Import it back here or adapt it downstream.</p>
            <button className="button button--primary" onClick={() => onRequestExport("json")} type="button">
              Download {ready ? "final" : "draft"} desired-state contract (.json)
            </button>
          </article>
        </div>
        {pendingDraftExport && !ready && (
          <div
            aria-labelledby="draft-export-confirmation-title"
            aria-live="assertive"
            className="draft-export-confirmation"
            role="alert"
          >
            <strong id="draft-export-confirmation-title">Confirm incomplete draft download</strong>
            <p>
              This {pendingDraftLabel} will be labeled draft because {readiness.remainingDecisionCount} applicable editable
              decision{readiness.remainingDecisionCount === 1 ? " remains" : "s remain"} unreviewed.
            </p>
            <div>
              <button className="button button--primary" onClick={onConfirmDraftExport} type="button">
                Download draft {pendingDraftLabel}
              </button>
              <button className="link-button" onClick={onCancelDraftExport} type="button">Cancel</button>
            </div>
          </div>
        )}
      </section>
    </section>
  )
}

interface MetricProps {
  ariaLabel: string
  label: string
  value: number
  valueLabel: string
}

function Metric({ ariaLabel, label, value, valueLabel }: MetricProps) {
  return (
    <div className="metric">
      <div><span>{label}</span><strong>{valueLabel}</strong></div>
      <div className="metric__track" role="progressbar" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <span style={{ width: `${value * 100}%` }} />
      </div>
    </div>
  )
}
