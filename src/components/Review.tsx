import { buildDomainProfiles } from "../logic/scoring"
import type { CurrentState, RecommendedSetting } from "../types"

interface ReviewProps {
  settings: RecommendedSetting[]
  currentState: CurrentState
  onDownloadJson: () => void
  onDownloadMarkdown: () => void
}

export function Review({ settings, currentState, onDownloadJson, onDownloadMarkdown }: ReviewProps) {
  const applicable = settings.filter((item) => item.disposition !== "Not applicable")
  const recommended = applicable.filter((item) => item.disposition === "Recommended")
  const overrides = applicable.filter((item) => item.disposition === "Override")
  const notApplicable = settings.filter((item) => item.disposition === "Not applicable")
  const profiles = buildDomainProfiles(settings)
  const total = settings.length

  return (
    <section className="review-stack" aria-labelledby="review-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Step 4 · Review / export</span>
          <h2 id="review-heading">A decision-ready desired state</h2>
        </div>
        <p>Bars respond to your selected values. They compare influence and effort inside this catalog, not tenant adherence or a universal security score.</p>
      </div>
      <aside className="scale-explainer">
        <strong>Relative scales, not grades</strong>
        <p>Control influence weights protective, guardrail, and enabling decisions by domain. Foundational choices cap a domain until strengthened. Complexity adds the rollout and ongoing effort of the selected choices.</p>
      </aside>
      {currentState === "unknown" && <aside className="unknown-note"><strong>Unknown stays unknown</strong><p>The current tenant was not assessed. These bars describe the selected desired state and do not treat missing evidence as a gap.</p></aside>}
      <div className="profile-grid">
        {profiles.map((profile) => (
          <article className="profile-card" key={profile.domain}>
            <h3>{profile.domain}</h3>
            <div className="metric-heading"><span>Control influence</span><strong>{profile.postureLabel}</strong></div>
            <div className="metric-track" role="progressbar" aria-label={`${profile.domain} control influence`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profile.posture * 100)}>
              <span className="metric-fill metric-fill--posture" style={{ width: `${profile.posture * 100}%` }} />
            </div>
            <div className="metric-scale"><span>Lower</span><span>Higher</span></div>
            {profile.foundationLimited && <p className="foundation-note">A foundational choice limits this domain until it is strengthened.</p>}
            <div className="complexity-grid">
              <div>
                <div className="metric-heading"><span>Rollout effort</span><strong>{profile.rolloutBand}</strong></div>
                <div className="metric-track metric-track--compact" role="progressbar" aria-label={`${profile.domain} rollout effort`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profile.rolloutLoad * 100)}>
                  <span className="metric-fill metric-fill--complexity" style={{ width: `${profile.rolloutLoad * 100}%` }} />
                </div>
              </div>
              <div>
                <div className="metric-heading"><span>Ongoing effort</span><strong>{profile.ongoingBand}</strong></div>
                <div className="metric-track metric-track--compact" role="progressbar" aria-label={`${profile.domain} ongoing effort`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profile.ongoingLoad * 100)}>
                  <span className="metric-fill metric-fill--complexity" style={{ width: `${profile.ongoingLoad * 100}%` }} />
                </div>
              </div>
            </div>
          </article>
        ))}
      </div>
      <div className="review-grid">
        <article className="summary-card">
          <span className="eyebrow">Segmented baseline disposition</span>
          <h3>{applicable.length} applicable decisions</h3>
          <p>{recommended.length} recommended · {overrides.length} tailored overrides · {notApplicable.length} not applicable</p>
          <div className="disposition-bar" aria-label={`${recommended.length} recommended, ${overrides.length} overrides, ${notApplicable.length} not applicable`}>
            <span className="disposition-bar__recommended" style={{ width: `${total ? recommended.length / total * 100 : 0}%` }} />
            <span className="disposition-bar__override" style={{ width: `${total ? overrides.length / total * 100 : 0}%` }} />
            <span className="disposition-bar__na" style={{ width: `${total ? notApplicable.length / total * 100 : 0}%` }} />
          </div>
          <div className="disposition-legend"><span>Recommended</span><span>Override</span><span>Not applicable</span></div>
        </article>
        <article className="summary-card">
          <span className="eyebrow">Change list</span>
          <h3>{overrides.length ? `${overrides.length} deliberate override${overrides.length === 1 ? "" : "s"}` : "No overrides yet"}</h3>
          <ul className="compact-list">
            {overrides.length ? overrides.map(({ setting }) => <li key={setting.id}>{setting.title}</li>) : <li>Use Configure to tailor any recommendation.</li>}
          </ul>
        </article>
      </div>
      <div className="export-panel">
        <div>
          <span className="eyebrow">Portable plan</span>
          <h3>Export the desired state</h3>
          <p>JSON supports adapters; Markdown supports review and decision records. No direct tenant changes are made.</p>
        </div>
        <div className="button-row">
          <button className="button button--secondary" onClick={onDownloadMarkdown} type="button">Download Markdown</button>
          <button className="button" onClick={onDownloadJson} type="button">Download JSON</button>
        </div>
      </div>
    </section>
  )
}
