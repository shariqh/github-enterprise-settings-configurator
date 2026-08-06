import { buildPlanSignature, intentAxes, intentAxisDefinitions, intentLabel } from "../logic/intent"
import { buildDomainProfiles, getChoiceImpact, toBand, toPostureLabel } from "../logic/scoring"
import type {
  Domain,
  IntentAxis,
  IntentLevel,
  PlanIntent,
  RecommendedSetting,
} from "../types"

interface IntentControlsProps {
  intent: PlanIntent
  onChange: (axis: IntentAxis, value: IntentLevel) => void
}

const toIntentLevel = (value: string): IntentLevel => {
  if (value === "0") return 0
  if (value === "2") return 2
  return 1
}

export function IntentControls({ intent, onChange }: IntentControlsProps) {
  return (
    <fieldset className="intent-controls">
      <legend>Planning intent</legend>
      <p>These qualitative preferences tune recommendations. They are not tenant measurements or a security score.</p>
      <div className="intent-controls__grid">
        {intentAxes.map((axis) => {
          const definition = intentAxisDefinitions[axis]
          const value = intent[axis]
          return (
            <label className="intent-slider" key={axis}>
              <span className="intent-slider__heading">
                <span>
                  <strong>{definition.label}</strong>
                  <small>{definition.description}</small>
                </span>
                <output>{intentLabel(axis, value)}</output>
              </span>
              <input
                aria-label={definition.label}
                aria-valuetext={intentLabel(axis, value)}
                max={2}
                min={0}
                onChange={(event) => onChange(axis, toIntentLevel(event.currentTarget.value))}
                step={1}
                type="range"
                value={value}
              />
              <span aria-hidden="true" className="intent-slider__labels">
                {definition.values.map((label) => <span key={label}>{label}</span>)}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

interface PlanSignatureProps {
  intent: PlanIntent
  settings: RecommendedSetting[]
}

const signatureY = (level: IntentLevel): number => 78 - level * 28

export function PlanSignature({ intent, settings }: PlanSignatureProps) {
  const summary = buildPlanSignature(intent, settings)
  const values = intentAxes.map((axis, index) => ({
    axis,
    label: intentAxisDefinitions[axis].label,
    value: intentLabel(axis, intent[axis]),
    x: 32 + index * 88,
    y: signatureY(intent[axis]),
  }))

  return (
    <section className="plan-signature" aria-labelledby="plan-signature-heading">
      <div className="plan-signature__copy">
        <span className="section-kicker">Plan signature</span>
        <h2 id="plan-signature-heading">{summary.headline}</h2>
        <p>{summary.narrative}</p>
      </div>
      <div className="plan-signature__visual">
        <svg aria-hidden="true" viewBox="0 0 240 96">
          {[22, 50, 78].map((y) => <line className="plan-signature__guide" key={y} x1="20" x2="220" y1={y} y2={y} />)}
          {values.map((item) => <line className="plan-signature__axis" key={item.axis} x1={item.x} x2={item.x} y1="18" y2="82" />)}
          <polyline className="plan-signature__line" points={values.map((item) => `${item.x},${item.y}`).join(" ")} />
          {values.map((item) => <circle className="plan-signature__point" cx={item.x} cy={item.y} key={item.axis} r="5" />)}
        </svg>
        <div className="plan-signature__labels">
          {values.map((item) => (
            <span key={item.axis}>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

interface DomainLandscapeProps {
  settings: RecommendedSetting[]
  disabled?: boolean
  onSelectDomain: (domain: Domain) => void
}

export function DomainLandscape({ settings, disabled = false, onSelectDomain }: DomainLandscapeProps) {
  const profiles = buildDomainProfiles(settings)
  return (
    <section className="domain-landscape" aria-labelledby="domain-landscape-heading">
      <header>
        <div>
          <span className="section-kicker">Domain landscape</span>
          <h2 id="domain-landscape-heading">Where the plan asks for effort and ownership</h2>
        </div>
        <p>Position shows rollout effort. Bubble size shows ongoing effort. The inner dot shows control influence.</p>
      </header>
      <div aria-hidden="true" className="domain-landscape__axis">
        <span>Lower rollout effort</span>
        <span>Higher rollout effort</span>
      </div>
      <div className="domain-landscape__rows">
        {profiles.map((profile) => {
          const pointPosition = 6 + profile.rolloutLoad * 88
          const pointSize = 14 + profile.ongoingLoad * 12
          const controlSize = 5 + profile.posture * 8
          return (
            <button
              aria-label={`${profile.domain}: ${profile.postureLabel.toLowerCase()} control influence, ${profile.rolloutBand.toLowerCase()} rollout effort, ${profile.ongoingBand.toLowerCase()} ongoing effort`}
              className="domain-landscape__row"
              disabled={disabled}
              key={profile.domain}
              onClick={() => onSelectDomain(profile.domain)}
              type="button"
            >
              <strong>{profile.domain}</strong>
              <span aria-hidden="true" className="domain-landscape__plot">
                <span className="domain-landscape__track" />
                <span
                  className="domain-landscape__point"
                  style={{ height: `${pointSize}px`, left: `${pointPosition}%`, width: `${pointSize}px` }}
                >
                  <span style={{ height: `${controlSize}px`, width: `${controlSize}px` }} />
                </span>
              </span>
              <small>{profile.postureLabel} control · {profile.ongoingBand} ongoing</small>
            </button>
          )
        })}
      </div>
      <p className="domain-landscape__boundary">Relative within this catalog; not observed tenant posture.</p>
    </section>
  )
}

interface DecisionImpactProps {
  item: RecommendedSetting
}

interface ImpactDimension {
  key: "control" | "rollout" | "ongoing"
  label: string
}

const impactDimensions: ImpactDimension[] = [
  { key: "control", label: "Control influence" },
  { key: "rollout", label: "Rollout effort" },
  { key: "ongoing", label: "Ongoing effort" },
]

const differenceLabel = (key: ImpactDimension["key"], selected: number, recommended: number): string => {
  const difference = selected - recommended
  if (Math.abs(difference) < 0.05) return "At recommendation"
  if (key === "control") return difference > 0 ? "Stronger" : "Lighter"
  return difference > 0 ? "More effort" : "Less effort"
}

const impactLabel = (key: ImpactDimension["key"], value: number, contextOnly: boolean): string => {
  if (key === "control") return contextOnly ? "Context only" : toPostureLabel(value)
  return toBand(value)
}

export function DecisionImpact({ item }: DecisionImpactProps) {
  const selected = getChoiceImpact(item.setting, item.selected)
  const recommended = getChoiceImpact(item.setting, item.recommended)
  const selectedLabel = item.setting.choices.find((choice) => choice.id === item.selected)?.label ?? item.selected
  const contextOnly = item.setting.postureWeight === 0
  const announcement = impactDimensions
    .map(({ key, label }) => `${label}: ${impactLabel(key, selected[key], contextOnly)}`)
    .join(". ")

  return (
    <section className="decision-impact" aria-labelledby="decision-impact-heading">
      <header>
        <div>
          <span className="section-kicker">Live choice impact</span>
          <h3 id="decision-impact-heading">{selectedLabel}</h3>
        </div>
        <p>Relative effect inside this catalog. The marker shows the recommendation.</p>
      </header>
      <p aria-live="polite" className="sr-only">{announcement}</p>
      <div className="decision-impact__grid">
        {impactDimensions.map(({ key, label }) => (
          <div className="decision-impact__metric" key={key}>
            <div>
              <span>{label}</span>
              <strong>{impactLabel(key, selected[key], contextOnly)}</strong>
            </div>
            <div aria-hidden="true" className="decision-impact__track">
              <span className="decision-impact__fill" style={{ width: `${selected[key] * 100}%` }} />
              <span className="decision-impact__marker" style={{ left: `${recommended[key] * 100}%` }} />
            </div>
            <small>{differenceLabel(key, selected[key], recommended[key])}</small>
          </div>
        ))}
      </div>
    </section>
  )
}
