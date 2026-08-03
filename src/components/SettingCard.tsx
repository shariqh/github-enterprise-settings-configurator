import { ChoiceGroup } from "./ChoiceGroup"
import type { RecommendedSetting } from "../types"

interface SettingCardProps {
  item: RecommendedSetting
  onChange: (id: string, value: string) => void
}

export function SettingCard({ item, onChange }: SettingCardProps) {
  const { setting, selected, disposition } = item
  if (disposition === "Not applicable") {
    return (
      <article className="setting-card setting-card--muted">
        <div>
          <span className="eyebrow">{setting.domain}</span>
          <h3>{setting.title}</h3>
        </div>
        <span className="status status--na">Not applicable</span>
        <p>{setting.prompt}</p>
      </article>
    )
  }

  return (
    <article className="setting-card">
      <div className="setting-card__heading">
        <div>
          <span className="eyebrow">{setting.domain}</span>
          <h3>{setting.title}</h3>
        </div>
        <span className={`status ${disposition === "Recommended" ? "status--recommended" : "status--override"}`}>
          {disposition}
        </span>
      </div>
      <p>{setting.prompt}</p>
      {setting.editable === false && <p className="derived-note">Derived from the target profile.</p>}
      <ChoiceGroup choices={setting.choices} disabled={setting.editable === false} label={setting.title} name={setting.id} onChange={(value) => onChange(setting.id, value)} value={selected} />
      <details>
        <summary>Decision details and sources</summary>
        <dl className="details-grid">
          <div><dt>Why this is recommended</dt><dd>{setting.rationale}</dd></div>
          <div><dt>Tradeoff</dt><dd>{setting.tradeoff}</dd></div>
          <div><dt>Prerequisites</dt><dd>{setting.prerequisites}</dd></div>
          <div><dt>Consequence</dt><dd>{setting.consequences}</dd></div>
          <div><dt>Scope</dt><dd>{setting.scope}</dd></div>
          <div><dt>Responsible role</dt><dd>{setting.role}</dd></div>
          <div><dt>Apply method</dt><dd>{setting.applyMethod}</dd></div>
          <div><dt>Influence profile</dt><dd>{setting.influence}; rollout {setting.rolloutBand}; ongoing {setting.ongoingBand}</dd></div>
        </dl>
        <ul className="source-list">
          {setting.sources.map((source) => <li key={source.url}><a href={source.url} rel="noreferrer" target="_blank">{source.label}</a><span>{source.tier}</span></li>)}
        </ul>
      </details>
    </article>
  )
}
