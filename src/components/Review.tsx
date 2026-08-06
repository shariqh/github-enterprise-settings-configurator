import { buildDomainProfiles } from "../logic/scoring"
import { DomainLandscape, PlanSignature } from "./VisualPlanning"
import type { CurrentState, Domain, PlanIntent, RecommendedSetting } from "../types"

interface ReviewProps {
  settings: RecommendedSetting[]
  intent: PlanIntent
  currentState: CurrentState
  reviewedCount: number
  onDownloadJson: () => void
  onDownloadMarkdown: () => void
  onOpenDomain: (domain: Domain) => void
}

const choiceLabel = (item: RecommendedSetting): string =>
  item.setting.choices.find((choice) => choice.id === item.selected)?.label ?? item.selected

export function Review({
  settings,
  intent,
  currentState,
  reviewedCount,
  onDownloadJson,
  onDownloadMarkdown,
  onOpenDomain,
}: ReviewProps) {
  const applicable = settings.filter((item) => item.disposition !== "Not applicable")
  const reviewable = applicable.filter((item) => item.setting.editable !== false)
  const recommended = applicable.filter((item) => item.disposition === "Recommended")
  const overrides = applicable.filter((item) => item.disposition === "Override")
  const notApplicable = settings.filter((item) => item.disposition === "Not applicable")
  const profiles = buildDomainProfiles(settings)

  return (
    <section className="review-page" aria-labelledby="review-heading">
      <header className="content-heading content-heading--intro">
        <div>
          <span className="section-kicker">Review and export</span>
          <h1 data-workspace-focus="section" id="review-heading" tabIndex={-1}>A decision-ready desired state.</h1>
          <p>Review completion and selected values remain separate from the relative domain profile. Neither represents observed tenant state.</p>
        </div>
      </header>

      {currentState === "unknown" && (
        <div className="review-note">
          <strong>Unknown stays unknown.</strong>
          <span>The current tenant was not assessed, so missing evidence is not treated as a gap.</span>
        </div>
      )}

      <div className="review-summary">
        <div><strong>{reviewedCount} / {reviewable.length}</strong><span>decisions reviewed</span></div>
        <div><strong>{recommended.length}</strong><span>recommended values</span></div>
        <div><strong>{overrides.length}</strong><span>deliberate overrides</span></div>
        <div><strong>{notApplicable.length}</strong><span>not applicable</span></div>
      </div>

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
                <span>{choiceLabel(item)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">No overrides have been selected.</p>
        )}
      </section>

      <section className="export-section">
        <div>
          <h2>Export the desired state</h2>
          <p>JSON supports future adapters. Markdown supports review and decision records. No direct tenant changes are made.</p>
        </div>
        <div>
          <button className="button button--secondary" onClick={onDownloadMarkdown} type="button">Download Markdown</button>
          <button className="button button--primary" onClick={onDownloadJson} type="button">Download JSON</button>
        </div>
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
