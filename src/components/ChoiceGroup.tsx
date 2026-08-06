import type { Choice } from "../types"

interface ChoiceGroupProps {
  choices: Choice[]
  value: string
  name: string
  label: string
  recommended?: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function ChoiceGroup({ choices, value, name, label, recommended, disabled = false, onChange }: ChoiceGroupProps) {
  return (
    <div className="choice-list" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <label className={`choice-row ${value === choice.id ? "choice-row--selected" : ""} ${disabled ? "choice-row--disabled" : ""}`} key={choice.id}>
          <input checked={value === choice.id} disabled={disabled} name={name} onChange={() => onChange(choice.id)} type="radio" value={choice.id} />
          <span className="choice-row__copy">
            <strong>{choice.label}</strong>
            <span>{choice.description}</span>
          </span>
          {recommended === choice.id && <span className="choice-row__recommended">Recommended</span>}
        </label>
      ))}
    </div>
  )
}
