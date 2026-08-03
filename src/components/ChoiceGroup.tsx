import type { Choice } from "../types"

interface ChoiceGroupProps {
  choices: Choice[]
  value: string
  name: string
  label: string
  disabled?: boolean
  onChange: (value: string) => void
}

export function ChoiceGroup({ choices, value, name, label, disabled = false, onChange }: ChoiceGroupProps) {
  return (
    <div className="choice-grid" role="radiogroup" aria-label={label}>
      {choices.map((choice) => (
        <label className={`choice ${value === choice.id ? "choice--selected" : ""} ${disabled ? "choice--disabled" : ""}`} key={choice.id}>
          <input checked={value === choice.id} disabled={disabled} name={name} onChange={() => onChange(choice.id)} type="radio" value={choice.id} />
          <span className="choice__label">{choice.label}</span>
          <span className="choice__description">{choice.description}</span>
        </label>
      ))}
    </div>
  )
}
