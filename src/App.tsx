import { useRef, useState } from "react"
import { catalog, priorityOptions, productLabels } from "./catalog"
import { Review } from "./components/Review"
import { SettingCard } from "./components/SettingCard"
import { buildMarkdown, download, exportObject } from "./logic/export"
import { getProfileWarnings, getRecommendedSettings, isProfileValid } from "./logic/recommendations"
import type { CurrentState, Entitlement, IdentityModel, Platform, PriorityId, ProductId, Profile } from "./types"
import "./App.css"

const initialProfile: Profile = {
  platform: "dotcom",
  identity: "personal",
  entitlement: "enterprise",
  currentState: "greenfield",
  products: { actions: true, security: true, copilot: true, audit: true },
}

const steps = ["Target profile", "Priorities / baseline", "Configure", "Review / export"]

function App() {
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<Profile>(initialProfile)
  const [priorities, setPriorities] = useState<PriorityId[]>(["secure-ghec"])
  const [selections, setSelections] = useState<Record<string, string>>({})
  const enterpriseProducts = useRef<Profile["products"]>({ ...initialProfile.products })
  const plan = { profile, priorities, selections }
  const settings = getRecommendedSettings(plan)
  const warnings = getProfileWarnings(profile)
  const canMoveNext = step !== 0 || isProfileValid(profile)

  const setProfileValue = <K extends keyof Omit<Profile, "products">>(key: K, value: Profile[K]) =>
    setProfile((current) => ({ ...current, [key]: value }))

  const setProduct = (product: ProductId, enabled: boolean) => {
    setProfile((current) => {
      const products = { ...current.products, [product]: enabled }
      if (current.entitlement === "enterprise") {
        enterpriseProducts.current = products
      }
      return { ...current, products }
    })
  }

  const setEntitlement = (entitlement: Entitlement) => {
    setProfile((current) => {
      if (current.entitlement === "enterprise" && entitlement === "copilot") {
        enterpriseProducts.current = { ...current.products }
      }
      return {
        ...current,
        entitlement,
        products: entitlement === "copilot"
          ? { actions: false, security: false, copilot: true, audit: false }
          : { ...enterpriseProducts.current },
      }
    })
  }

  const reset = () => {
    enterpriseProducts.current = { ...initialProfile.products }
    setStep(0)
    setProfile(initialProfile)
    setPriorities(["secure-ghec"])
    setSelections({})
  }

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">GitHub Enterprise · desired-state planner</span>
          <h1>Settings Configurator</h1>
        </div>
        <button className="text-button" onClick={reset} type="button">Reset plan</button>
      </header>

      <main>
        <section className="intro">
          <div>
            <span className="eyebrow">A smaller decision path</span>
            <h2>Turn fragmented guidance into an ordered enterprise baseline.</h2>
          </div>
          <p>Start with your target environment, shape a baseline, tailor recommended settings, then export a reviewable desired state.</p>
        </section>

        <nav aria-label="Configurator progress" className="progress">
          {steps.map((label, index) => (
            <button aria-current={step === index ? "step" : undefined} className={`progress__step ${step === index ? "progress__step--active" : ""} ${index < step ? "progress__step--complete" : ""}`} disabled={index > step && !isProfileValid(profile)} key={label} onClick={() => setStep(index)} type="button">
              <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {step === 0 && (
          <section className="form-section" aria-labelledby="profile-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Step 1 · Target profile</span>
                <h2 id="profile-heading">Name the target, not the current tenant.</h2>
              </div>
              <p>This static MVP does not inspect a tenant. Choose the future state you are planning for.</p>
            </div>
            <div className="form-grid">
              <SelectField label="Platform / hosting" onChange={(value) => setProfileValue("platform", value as Platform)} value={profile.platform} options={[["dotcom", "GitHub.com"], ["residency", "GHE.com data residency"], ["ghes", "GHES 3.21"]]} />
              <SelectField label="Identity model" onChange={(value) => setProfileValue("identity", value as IdentityModel)} value={profile.identity} options={[["personal", "Personal accounts"], ["emu", "Enterprise Managed Users (EMU)"]]} />
              <SelectField label="Entitlement" onChange={(value) => setEntitlement(value as Entitlement)} value={profile.entitlement} options={[["enterprise", "Full enterprise"], ["copilot", "Copilot-only"]]} />
              <SelectField label="Current state" onChange={(value) => setProfileValue("currentState", value as CurrentState)} value={profile.currentState} options={[["greenfield", "Greenfield"], ["existing", "Existing environment"], ["migration", "Migration"], ["unknown", "Unknown / discovery needed"]]} />
            </div>
            <fieldset className="product-fieldset">
              <legend>Enabled products</legend>
              <div className="product-grid">
                {(Object.keys(productLabels) as ProductId[]).map((product) => (
                  <label className="toggle-card" key={product}>
                    <input checked={profile.products[product]} disabled={profile.entitlement === "copilot" && product !== "copilot"} onChange={(event) => setProduct(product, event.target.checked)} type="checkbox" />
                    <span>{productLabels[product]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {warnings.length > 0 && <div className="notice" role="alert"><strong>Resolve profile combinations</strong><ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
          </section>
        )}

        {step === 1 && (
          <section className="form-section" aria-labelledby="priority-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Step 2 · Priorities / baseline</span>
                <h2 id="priority-heading">Choose the lenses that shape this review.</h2>
              </div>
              <p>These priorities refine the conversation; they do not create a security score or compliance claim.</p>
            </div>
            <div className="priority-grid">
              {priorityOptions.map((priority) => {
                const checked = priorities.includes(priority.id)
                return <label className={`priority-card ${checked ? "priority-card--selected" : ""}`} key={priority.id}>
                  <input checked={checked} onChange={() => setPriorities((current) => checked ? current.filter((id) => id !== priority.id) : [...current, priority.id])} type="checkbox" />
                  <span><strong>{priority.label}</strong><small>{priority.description}</small></span>
                </label>
              })}
            </div>
            <aside className="baseline-note"><strong>Baseline interpretation</strong><p>Recommendations are an adaptable starting point. “Not applicable” reflects your target profile; it is not a divergence finding. Unknown tenant state is intentionally outside this MVP.</p></aside>
          </section>
        )}

        {step === 2 && (
          <section className="form-section" aria-labelledby="configure-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Step 3 · Configure</span>
                <h2 id="configure-heading">Tailor recommended values with the tradeoffs in view.</h2>
              </div>
              <p>{catalog.length} typed decisions across enterprise governance, security, Actions, audit, and Copilot.</p>
            </div>
            <div className="config-note"><strong>Recommended</strong> means this plan’s preselected desired value. Selecting another value records a deliberate override; it does not diagnose a live tenant.</div>
            <div className="settings-list">
              {settings.map((item) => <SettingCard item={item} key={item.setting.id} onChange={(id, value) => setSelections((current) => ({ ...current, [id]: value }))} />)}
            </div>
          </section>
        )}

        {step === 3 && <Review currentState={profile.currentState} onDownloadJson={() => download("github-enterprise-desired-state.json", JSON.stringify(exportObject(plan, settings), null, 2), "application/json")} onDownloadMarkdown={() => download("github-enterprise-desired-state.md", buildMarkdown(plan, settings), "text/markdown")} settings={settings} />}

        <footer className="workflow-controls">
          <button className="button button--secondary" disabled={step === 0} onClick={() => setStep((current) => current - 1)} type="button">Back</button>
          {step < steps.length - 1 ? <button className="button" disabled={!canMoveNext} onClick={() => setStep((current) => current + 1)} type="button">Next: {steps[step + 1]}</button> : <button className="button" onClick={reset} type="button">Start a new plan</button>}
        </footer>
      </main>
      <footer className="site-footer">Public static MVP · desired state only · no sign-in, tenant connection, or direct apply</footer>
    </div>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return <label className="select-field"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>
}

export default App
