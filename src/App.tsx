import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { priorityOptions, productLabels } from "./catalog"
import { ChoiceGroup } from "./components/ChoiceGroup"
import { Review } from "./components/Review"
import {
  DecisionImpact,
  DomainLandscape,
  IntentControls,
  PlanSignature,
} from "./components/VisualPlanning"
import { buildMarkdown, download, exportObject } from "./logic/export"
import { defaultIntent } from "./logic/intent"
import {
  clearCachedPlan,
  parseImportedPlan,
  readCachedPlan,
  saveCachedPlan,
} from "./logic/persistence"
import { getProfileWarnings, getRecommendedSettings, isProfileValid } from "./logic/recommendations"
import type {
  CurrentState,
  Domain,
  Entitlement,
  IdentityModel,
  IntentAxis,
  IntentLevel,
  Plan,
  PlanIntent,
  Platform,
  PriorityId,
  ProductId,
  Profile,
  RecommendedSetting,
} from "./types"
import "./App.css"

const initialProfile: Profile = {
  platform: "dotcom",
  identity: "personal",
  entitlement: "enterprise",
  currentState: "greenfield",
  products: { actions: true, security: true, copilot: true, audit: true },
}

const domainOrder: Domain[] = [
  "Identity & administration",
  "Organization & repository governance",
  "Code security",
  "Actions & supply chain",
  "Audit visibility",
  "Copilot governance",
  "Copilot cost controls",
]

const platformLabels: Record<Platform, string> = {
  dotcom: "GitHub.com",
  residency: "GHE.com data residency",
  ghes: "GHES 3.21",
}

const identityLabels: Record<IdentityModel, string> = {
  personal: "Personal accounts",
  emu: "EMU",
}

const entitlementLabels: Record<Entitlement, string> = {
  enterprise: "Full enterprise",
  copilot: "Copilot-only",
}

type ActiveSection = "profile" | "review" | Domain
type DomainView = "guided" | "list"
type ProfileKey = keyof Omit<Profile, "products">
type PlanNotice = { kind: "error" | "info" | "success"; message: string }

const isDomain = (section: ActiveSection): section is Domain =>
  domainOrder.includes(section as Domain)

const isReviewed = (item: RecommendedSetting, reviewed: Record<string, boolean>): boolean =>
  item.setting.editable !== false && reviewed[item.setting.id] === true

const isComplete = (item: RecommendedSetting, reviewed: Record<string, boolean>): boolean =>
  item.setting.editable === false || isReviewed(item, reviewed)

const choiceLabel = (item: RecommendedSetting, choiceId = item.selected): string =>
  item.setting.choices.find((choice) => choice.id === choiceId)?.label ?? choiceId

function App() {
  const [cachedPlan] = useState(readCachedPlan)
  const restoredPlan = cachedPlan.ok ? cachedPlan.value : null
  const [profile, setProfile] = useState<Profile>(restoredPlan?.profile ?? initialProfile)
  const [intent, setIntent] = useState<PlanIntent>(restoredPlan?.intent ?? defaultIntent)
  const [priorities, setPriorities] = useState<PriorityId[]>(restoredPlan?.priorities ?? ["secure-ghec"])
  const [selections, setSelections] = useState<Record<string, string>>(restoredPlan?.selections ?? {})
  const [reviewed, setReviewed] = useState<Record<string, boolean>>(restoredPlan?.reviewed ?? {})
  const [activeSection, setActiveSection] = useState<ActiveSection>("profile")
  const [activeSettingId, setActiveSettingId] = useState<string | null>(null)
  const [domainView, setDomainView] = useState<DomainView>("guided")
  const [pathMenuOpen, setPathMenuOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(() => {
    if (!cachedPlan.ok) return { kind: "error", message: cachedPlan.error }
    if (cachedPlan.value) return { kind: "success", message: "Restored your local draft." }
    return null
  })
  const enterpriseProducts = useRef<Profile["products"]>({
    ...(restoredPlan?.profile.entitlement === "enterprise"
      ? restoredPlan.profile.products
      : initialProfile.products),
  })
  const importInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const pathMenuRef = useRef<HTMLDivElement>(null)
  const pathMenuToggleRef = useRef<HTMLButtonElement>(null)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const actionsMenuToggleRef = useRef<HTMLButtonElement>(null)
  const focusReady = useRef(false)

  const plan: Plan = { profile, intent, priorities, selections }
  const persistentState = useMemo(
    () => ({ profile, intent, priorities, selections, reviewed }),
    [profile, intent, priorities, selections, reviewed],
  )
  const persistenceFingerprint = JSON.stringify(persistentState)
  const lastPersistedFingerprint = useRef(persistenceFingerprint)
  const settings = getRecommendedSettings(plan)
  const applicableSettings = settings.filter((item) => item.disposition !== "Not applicable")
  const reviewableSettings = applicableSettings.filter((item) => item.setting.editable !== false)
  const settingsByDomain = domainOrder
    .map((domain) => ({
      domain,
      items: applicableSettings.filter((item) => item.setting.domain === domain),
    }))
    .filter((group) => group.items.length > 0)
  const warnings = getProfileWarnings(profile)
  const profileValid = isProfileValid(profile)
  const reviewedCount = applicableSettings.filter((item) => isReviewed(item, reviewed)).length
  const activeSectionLabel = activeSection === "profile"
    ? "Target profile"
    : activeSection === "review"
      ? "Review and export"
      : activeSection

  const activeDomainItems = isDomain(activeSection)
    ? settingsByDomain.find((group) => group.domain === activeSection)?.items ?? []
    : []
  const activeReviewableItems = activeDomainItems.filter((item) => item.setting.editable !== false)
  const activeItem = activeDomainItems.find((item) => item.setting.id === activeSettingId) ?? activeDomainItems[0]
  const activeIndex = activeItem
    ? activeDomainItems.findIndex((item) => item.setting.id === activeItem.setting.id)
    : -1
  const activeReviewIndex = activeItem
    ? activeReviewableItems.findIndex((item) => item.setting.id === activeItem.setting.id)
    : -1
  const remainingRecommendations = activeDomainItems.filter(
    (item) => item.disposition === "Recommended" && !isComplete(item, reviewed),
  )

  useEffect(() => {
    if (!focusReady.current) {
      focusReady.current = true
      return
    }

    const focusTarget = isDomain(activeSection) && domainView === "guided"
      ? workspaceRef.current?.querySelector<HTMLElement>('[data-workspace-focus="decision"]')
      : workspaceRef.current?.querySelector<HTMLElement>('[data-workspace-focus="section"]')
    focusTarget?.focus()
  }, [activeSection, activeSettingId, domainView])

  useEffect(() => {
    if (persistenceFingerprint === lastPersistedFingerprint.current) return

    const saved = saveCachedPlan(persistentState)
    if (saved.ok) lastPersistedFingerprint.current = persistenceFingerprint
    setPlanNotice(saved.ok
      ? { kind: "info", message: "Saved locally in this browser." }
      : { kind: "error", message: saved.error })
  }, [persistenceFingerprint, persistentState])

  useEffect(() => {
    if (!pathMenuOpen && !actionsMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (actionsMenuOpen) actionsMenuToggleRef.current?.focus()
      if (pathMenuOpen) pathMenuToggleRef.current?.focus()
      setPathMenuOpen(false)
      setActionsMenuOpen(false)
    }
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (actionsMenuOpen && !actionsMenuRef.current?.contains(event.target)) setActionsMenuOpen(false)
      if (pathMenuOpen && !pathMenuRef.current?.contains(event.target)) setPathMenuOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    window.addEventListener("pointerdown", closeOnPointerDown)
    return () => {
      window.removeEventListener("keydown", closeOnEscape)
      window.removeEventListener("pointerdown", closeOnPointerDown)
    }
  }, [actionsMenuOpen, pathMenuOpen])

  const clearReviews = () => setReviewed({})

  const setProfileValue = <K extends ProfileKey>(key: K, value: Profile[K]) => {
    clearReviews()
    setProfile((current) => ({ ...current, [key]: value }))
  }

  const setProduct = (product: ProductId, enabled: boolean) => {
    clearReviews()
    setProfile((current) => {
      const products = { ...current.products, [product]: enabled }
      if (current.entitlement === "enterprise") {
        enterpriseProducts.current = products
      }
      return { ...current, products }
    })
  }

  const setEntitlement = (entitlement: Entitlement) => {
    clearReviews()
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

  const togglePriority = (priority: PriorityId) => {
    clearReviews()
    setPriorities((current) =>
      current.includes(priority)
        ? current.filter((id) => id !== priority)
        : [...current, priority],
    )
  }

  const setIntentValue = (axis: IntentAxis, value: IntentLevel) => {
    clearReviews()
    setIntent((current) => ({ ...current, [axis]: value }))
  }

  const openDomain = (domain: Domain, settingId?: string) => {
    const items = settingsByDomain.find((group) => group.domain === domain)?.items ?? []
    const target = items.find((item) => item.setting.id === settingId)
      ?? items.find((item) => !isComplete(item, reviewed))
      ?? items[0]
    setActiveSection(domain)
    setActiveSettingId(target?.setting.id ?? null)
    setDomainView("guided")
    setPathMenuOpen(false)
    setActionsMenuOpen(false)
  }

  const buildPlan = () => {
    if (!profileValid) return
    const firstGroup = settingsByDomain[0]
    if (firstGroup) openDomain(firstGroup.domain)
  }

  const navigateTo = (section: ActiveSection) => {
    setPathMenuOpen(false)
    setActionsMenuOpen(false)
    if (section !== "profile" && !profileValid) {
      setActiveSection("profile")
      return
    }
    if (isDomain(section)) {
      openDomain(section)
      return
    }
    setActiveSection(section)
  }

  const selectDecisionValue = (settingId: string, value: string) => {
    setSelections((current) => ({ ...current, [settingId]: value }))
    setReviewed((current) => {
      const next = { ...current }
      delete next[settingId]
      return next
    })
  }

  const acceptRemainingRecommendations = () => {
    setReviewed((current) => {
      const next = { ...current }
      remainingRecommendations.forEach((item) => {
        next[item.setting.id] = true
      })
      return next
    })
  }

  const saveAndContinue = () => {
    if (!activeItem || !isDomain(activeSection)) return

    const nextReviewed = activeItem.setting.editable === false
      ? reviewed
      : { ...reviewed, [activeItem.setting.id]: true }
    if (activeItem.setting.editable !== false) setReviewed(nextReviewed)

    const nextItem = activeDomainItems
      .slice(activeIndex + 1)
      .find((item) => !isComplete(item, nextReviewed))
    if (nextItem) {
      setActiveSettingId(nextItem.setting.id)
      return
    }

    const wrappedItem = activeDomainItems
      .slice(0, activeIndex)
      .find((item) => !isComplete(item, nextReviewed))
    if (wrappedItem) {
      setActiveSettingId(wrappedItem.setting.id)
      return
    }

    const currentGroupIndex = settingsByDomain.findIndex((group) => group.domain === activeSection)
    const remainingGroups = [
      ...settingsByDomain.slice(currentGroupIndex + 1),
      ...settingsByDomain.slice(0, currentGroupIndex),
    ]
    const nextGroup = remainingGroups
      .find((group) => group.items.some((item) => !isComplete(item, nextReviewed)))
    if (nextGroup) {
      const firstUnreviewed = nextGroup.items.find((item) => !isComplete(item, nextReviewed))
      setActiveSection(nextGroup.domain)
      setActiveSettingId(firstUnreviewed?.setting.id ?? nextGroup.items[0]?.setting.id ?? null)
      return
    }

    setActiveSection("review")
  }

  const goToPreviousDecision = () => {
    if (activeIndex <= 0) return
    setActiveSettingId(activeDomainItems[activeIndex - 1].setting.id)
  }

  const reset = () => {
    const cleared = clearCachedPlan()
    const defaultState = {
      profile: initialProfile,
      intent: defaultIntent,
      priorities: ["secure-ghec"] as PriorityId[],
      selections: {},
      reviewed: {},
    }
    lastPersistedFingerprint.current = cleared.ok ? JSON.stringify(defaultState) : ""
    enterpriseProducts.current = { ...initialProfile.products }
    setProfile(initialProfile)
    setIntent({ ...defaultIntent })
    setPriorities(["secure-ghec"])
    setSelections({})
    setReviewed({})
    setActiveSection("profile")
    setActiveSettingId(null)
    setDomainView("guided")
    setPathMenuOpen(false)
    setActionsMenuOpen(false)
    if (importInputRef.current) importInputRef.current.value = ""
    setPlanNotice(cleared.ok
      ? { kind: "success", message: "Plan reset to defaults and the local draft was cleared." }
      : { kind: "error", message: cleared.error })
  }

  const importPlan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ""
    if (!file) return

    let contents: string
    try {
      contents = await file.text()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setPlanNotice({ kind: "error", message: `The selected file could not be read. ${message}` })
      return
    }

    const imported = parseImportedPlan(contents)
    if (!imported.ok) {
      setPlanNotice({ kind: "error", message: imported.error })
      return
    }

    const { state, importedSettingCount, usedDefaultIntent, restoredReviewState } = imported.value
    const saved = saveCachedPlan(state)
    if (saved.ok) lastPersistedFingerprint.current = JSON.stringify(state)
    enterpriseProducts.current = {
      ...(state.profile.entitlement === "enterprise" ? state.profile.products : initialProfile.products),
    }
    setProfile(state.profile)
    setIntent(state.intent)
    setPriorities(state.priorities)
    setSelections(state.selections)
    setReviewed(state.reviewed)
    setActiveSection("profile")
    setActiveSettingId(null)
    setDomainView("guided")

    const compatibilityNotes = [
      usedDefaultIntent ? "Balanced planning intent was applied because this is an older export." : null,
      restoredReviewState ? null : "Review completion restarted because the export did not contain review state.",
    ].filter((note): note is string => note !== null)
    const importMessage = `Imported ${importedSettingCount} setting${importedSettingCount === 1 ? "" : "s"}. ${compatibilityNotes.join(" ")}`
    setPlanNotice(saved.ok
      ? { kind: "success", message: importMessage.trim() }
      : { kind: "error", message: `${importMessage} ${saved.error}`.trim() })
  }

  const downloadJson = () =>
    download(
      "github-enterprise-desired-state.json",
      JSON.stringify(
        exportObject(
          plan,
          settings,
          applicableSettings
            .filter((item) => isReviewed(item, reviewed))
            .map((item) => item.setting.id),
        ),
        null,
        2,
      ),
      "application/json",
    )
  const downloadMarkdown = () =>
    download(
      "github-enterprise-desired-state.md",
      buildMarkdown(plan, settings),
      "text/markdown",
    )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>Enterprise settings plan</strong>
          <span>{platformLabels[profile.platform]} / {identityLabels[profile.identity]} / {entitlementLabels[profile.entitlement]}</span>
        </div>
        <div className="topbar__actions">
          <button className="link-button topbar__utility-action" onClick={() => navigateTo("profile")} type="button">Edit profile</button>
          <input
            accept=".json,application/json"
            aria-label="Import plan JSON"
            className="sr-only"
            onChange={importPlan}
            ref={importInputRef}
            type="file"
          />
          <button className="link-button topbar__utility-action" onClick={() => importInputRef.current?.click()} type="button">Import JSON</button>
          <button className="link-button topbar__utility-action" onClick={reset} type="button">Reset plan</button>
          <div className="topbar-menu" ref={actionsMenuRef}>
            <button
              aria-controls="mobile-plan-actions"
              aria-expanded={actionsMenuOpen}
              aria-label="More plan actions"
              className="topbar-menu__toggle"
              onClick={() => {
                setActionsMenuOpen((current) => !current)
                setPathMenuOpen(false)
              }}
              ref={actionsMenuToggleRef}
              type="button"
            >
              <span aria-hidden="true">•••</span>
              <span className="sr-only">More plan actions</span>
            </button>
            {actionsMenuOpen && (
              <div aria-label="Plan actions" className="topbar-menu__panel" id="mobile-plan-actions" role="group">
                <button onClick={() => navigateTo("profile")} type="button">Edit profile</button>
                <button
                  onClick={() => {
                    setActionsMenuOpen(false)
                    importInputRef.current?.click()
                  }}
                  type="button"
                >
                  Import JSON
                </button>
                <button
                  className="topbar-menu__danger"
                  onClick={reset}
                  type="button"
                >
                  Reset plan
                </button>
              </div>
            )}
          </div>
          <button className="button button--secondary" disabled={!profileValid} onClick={() => navigateTo("review")} type="button">Review and export</button>
        </div>
      </header>

      {planNotice && (
        <div
          className={`plan-notice plan-notice--${planNotice.kind}`}
          role={planNotice.kind === "error" ? "alert" : "status"}
        >
          <span>{planNotice.message}</span>
          <button aria-label="Dismiss plan message" onClick={() => setPlanNotice(null)} type="button">×</button>
        </div>
      )}

      <div className="workbench">
        <div className={`path-navigation ${pathMenuOpen ? "path-navigation--open" : ""}`} ref={pathMenuRef}>
          <button
            aria-controls="plan-path"
            aria-expanded={pathMenuOpen}
            className="mobile-path-toggle"
            onClick={() => {
              setPathMenuOpen((current) => !current)
              setActionsMenuOpen(false)
            }}
            ref={pathMenuToggleRef}
            type="button"
          >
            <span className="mobile-path-toggle__copy">
              <small>Your path</small>
              <strong>{activeSectionLabel}</strong>
            </span>
            <span className="mobile-path-toggle__progress">{reviewedCount} / {reviewableSettings.length} reviewed</span>
            <span aria-hidden="true" className="mobile-path-toggle__chevron" />
          </button>
          <nav className="path-nav" id="plan-path" aria-label="Plan path">
            <h2>Your path</h2>
            <button
              aria-current={activeSection === "profile" ? "step" : undefined}
              className={`path-item ${activeSection === "profile" ? "path-item--active" : ""}`}
              onClick={() => navigateTo("profile")}
              type="button"
            >
              <span>Target profile</span>
              <small>{warnings.length ? "Needs attention" : "Ready"}</small>
            </button>
            {settingsByDomain.map(({ domain, items }) => {
              const reviewableItems = items.filter((item) => item.setting.editable !== false)
              const complete = reviewableItems.filter((item) => isReviewed(item, reviewed)).length
              const domainComplete = complete === reviewableItems.length
              return (
                <button
                  aria-current={activeSection === domain ? "step" : undefined}
                  className={`path-item ${activeSection === domain ? "path-item--active" : ""} ${domainComplete ? "path-item--complete" : ""}`}
                  disabled={!profileValid}
                  key={domain}
                  onClick={() => navigateTo(domain)}
                  type="button"
                >
                  <span>{domain}</span>
                  <small>{domainComplete ? `✓ ${complete} reviewed` : `${complete} of ${reviewableItems.length} reviewed`}</small>
                </button>
              )
            })}
            <button
              aria-current={activeSection === "review" ? "step" : undefined}
              className={`path-item path-item--review ${activeSection === "review" ? "path-item--active" : ""}`}
              disabled={!profileValid}
              onClick={() => navigateTo("review")}
              type="button"
            >
              <span>Review and export</span>
              <small>{reviewedCount} of {reviewableSettings.length} reviewed</small>
            </button>
          </nav>
        </div>

        <main className="workspace-main" ref={workspaceRef}>
          {activeSection === "profile" && (
            <ProfileEditor
              applicableCount={applicableSettings.length}
              intent={intent}
              onBuild={buildPlan}
              onEntitlementChange={setEntitlement}
              onIntentChange={setIntentValue}
              onOpenDomain={openDomain}
              onPriorityToggle={togglePriority}
              onProductChange={setProduct}
              onProfileValueChange={setProfileValue}
              priorities={priorities}
              profile={profile}
              profileValid={profileValid}
              settings={settings}
              warnings={warnings}
            />
          )}

          {isDomain(activeSection) && (
            <section className="domain-workspace" aria-labelledby="domain-heading">
              <header className="content-heading">
                <div>
                  <span className="section-kicker">Current domain</span>
                  <h1 data-workspace-focus="section" id="domain-heading" tabIndex={-1}>{activeSection}</h1>
                </div>
                <div className="heading-actions">
                  <button className="link-button" onClick={() => setDomainView((current) => current === "guided" ? "list" : "guided")} type="button">
                    {domainView === "guided" ? "View all decisions" : "Guide me through decisions"}
                  </button>
                  <button
                    className="button button--secondary"
                    disabled={remainingRecommendations.length === 0}
                    onClick={acceptRemainingRecommendations}
                    type="button"
                  >
                    Accept remaining recommendations ({remainingRecommendations.length})
                  </button>
                </div>
              </header>

              {domainView === "guided" && activeItem && (
                <GuidedDecision
                  canGoPrevious={activeIndex > 0}
                  index={activeReviewIndex}
                  item={activeItem}
                  onChange={(value) => selectDecisionValue(activeItem.setting.id, value)}
                  onNext={saveAndContinue}
                  onPrevious={goToPreviousDecision}
                  reviewed={isReviewed(activeItem, reviewed)}
                  total={activeReviewableItems.length}
                />
              )}

              {domainView === "list" && (
                <DecisionList
                  items={activeDomainItems}
                  onOpen={(settingId) => {
                    setActiveSettingId(settingId)
                    setDomainView("guided")
                  }}
                  reviewed={reviewed}
                />
              )}
            </section>
          )}

          {activeSection === "review" && (
            <Review
              currentState={profile.currentState}
              intent={intent}
              onDownloadJson={downloadJson}
              onDownloadMarkdown={downloadMarkdown}
              onOpenDomain={openDomain}
              reviewedCount={reviewedCount}
              settings={settings}
            />
          )}
        </main>

        <aside className="context-panel">
          {activeSection === "profile" && <ProfileContext />}
          {isDomain(activeSection) && activeItem && <DecisionContext item={activeItem} />}
          {activeSection === "review" && <ReviewContext />}
        </aside>
      </div>

      <footer className="site-footer">
        <span>Public static MVP · desired state only</span>
        <span>Drafts save locally in this browser.</span>
      </footer>
    </div>
  )
}

interface ProfileEditorProps {
  profile: Profile
  intent: PlanIntent
  priorities: PriorityId[]
  warnings: string[]
  applicableCount: number
  profileValid: boolean
  settings: RecommendedSetting[]
  onProfileValueChange: <K extends ProfileKey>(key: K, value: Profile[K]) => void
  onEntitlementChange: (entitlement: Entitlement) => void
  onIntentChange: (axis: IntentAxis, value: IntentLevel) => void
  onOpenDomain: (domain: Domain) => void
  onProductChange: (product: ProductId, enabled: boolean) => void
  onPriorityToggle: (priority: PriorityId) => void
  onBuild: () => void
}

function ProfileEditor({
  profile,
  intent,
  priorities,
  warnings,
  applicableCount,
  profileValid,
  settings,
  onProfileValueChange,
  onEntitlementChange,
  onIntentChange,
  onOpenDomain,
  onProductChange,
  onPriorityToggle,
  onBuild,
}: ProfileEditorProps) {
  return (
    <section className="profile-editor" aria-labelledby="profile-heading">
      <header className="content-heading content-heading--intro">
        <div>
          <span className="section-kicker">Target profile</span>
          <h1 data-workspace-focus="section" id="profile-heading" tabIndex={-1}>Name the environment you are planning for.</h1>
          <p>The configurator builds a recommended path from this desired target. It does not inspect a live tenant.</p>
        </div>
      </header>

      <div className="profile-fields">
        <SelectField
          label="Platform and hosting"
          onChange={(value) => onProfileValueChange("platform", value as Platform)}
          options={[["dotcom", "GitHub.com"], ["residency", "GHE.com data residency"], ["ghes", "GHES 3.21"]]}
          value={profile.platform}
        />
        <SelectField
          label="Identity model"
          onChange={(value) => onProfileValueChange("identity", value as IdentityModel)}
          options={[["personal", "Personal accounts"], ["emu", "Enterprise Managed Users (EMU)"]]}
          value={profile.identity}
        />
        <SelectField
          label="Entitlement"
          onChange={(value) => onEntitlementChange(value as Entitlement)}
          options={[["enterprise", "Full enterprise"], ["copilot", "Copilot-only"]]}
          value={profile.entitlement}
        />
        <SelectField
          label="Current state"
          onChange={(value) => onProfileValueChange("currentState", value as CurrentState)}
          options={[["greenfield", "Greenfield"], ["existing", "Existing environment"], ["migration", "Migration"], ["unknown", "Unknown / discovery needed"]]}
          value={profile.currentState}
        />
      </div>

      <div className="profile-intent">
        <IntentControls intent={intent} onChange={onIntentChange} />
        <PlanSignature intent={intent} settings={settings} />
      </div>

      <fieldset className="flat-fieldset">
        <legend>Enabled products</legend>
        <p>Only relevant domains and decisions will appear in your path.</p>
        <div className="check-list check-list--products">
          {(Object.keys(productLabels) as ProductId[]).map((product) => (
            <label key={product}>
              <input
                checked={profile.products[product]}
                disabled={profile.entitlement === "copilot" && product !== "copilot"}
                onChange={(event) => onProductChange(product, event.target.checked)}
                type="checkbox"
              />
              <span>{productLabels[product]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flat-fieldset">
        <legend>Planning priorities</legend>
        <p>Priorities adjust a small number of recommendations; they do not create a score or compliance claim.</p>
        <div className="check-list">
          {priorityOptions.map((priority) => (
            <label key={priority.id}>
              <input
                checked={priorities.includes(priority.id)}
                onChange={() => onPriorityToggle(priority.id)}
                type="checkbox"
              />
              <span>
                <strong>{priority.label}</strong>
                <small>{priority.description}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <DomainLandscape
        disabled={!profileValid}
        onSelectDomain={onOpenDomain}
        settings={settings}
      />

      {warnings.length > 0 && (
        <div className="validation-notice" role="alert">
          <strong>Resolve this profile before continuing</strong>
          <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        </div>
      )}

      <footer className="profile-actions">
        <span>{applicableCount} settings will be included in this path.</span>
        <button className="button button--primary" disabled={warnings.length > 0} onClick={onBuild} type="button">
          Build recommended plan
        </button>
      </footer>
    </section>
  )
}

interface GuidedDecisionProps {
  item: RecommendedSetting
  index: number
  total: number
  reviewed: boolean
  canGoPrevious: boolean
  onChange: (value: string) => void
  onPrevious: () => void
  onNext: () => void
}

function GuidedDecision({ item, index, total, reviewed, canGoPrevious, onChange, onPrevious, onNext }: GuidedDecisionProps) {
  const { setting, selected, recommended, disposition } = item
  const derived = setting.editable === false
  return (
    <div className="guided-decision">
      <div className="decision-progress">
        <span>{derived ? "Profile-derived setting" : `Decision ${index + 1} of ${total}`}</span>
        <span>{derived ? "Derived" : reviewed ? "Reviewed" : "Not reviewed"}</span>
        {!derived && (
          <div className="progress-track" role="progressbar" aria-label={`${index + 1} of ${total} decisions`} aria-valuemin={0} aria-valuemax={total} aria-valuenow={index + 1}>
            <span style={{ width: `${(index + 1) / total * 100}%` }} />
          </div>
        )}
      </div>

      <article className="decision-document">
        <span className="section-kicker">{setting.title}</span>
        <h2 data-workspace-focus="decision" tabIndex={-1}>{setting.prompt}</h2>
        <p className="decision-lede">Choose the desired value for this plan. The current recommendation reflects your target profile, planning intent, and selected priorities.</p>
        {setting.editable === false && <p className="derived-note">This value is derived from the target profile.</p>}
        <ChoiceGroup
          choices={setting.choices}
          disabled={setting.editable === false}
          label={setting.title}
          name={setting.id}
          onChange={onChange}
          recommended={recommended}
          value={selected}
        />
        <DecisionImpact item={item} />
        <div className="selection-summary">
          <span>Current disposition</span>
          <strong>{disposition}</strong>
        </div>
        <footer className="decision-actions">
          <button className="link-button" disabled={!canGoPrevious} onClick={onPrevious} type="button">← Previous</button>
          <button
            className="button button--primary"
            onClick={(event) => {
              if (event.detail > 1) return
              onNext()
            }}
            type="button"
          >
            {setting.editable === false ? "Continue" : "Save and continue"}
          </button>
        </footer>
      </article>
    </div>
  )
}

interface DecisionListProps {
  items: RecommendedSetting[]
  reviewed: Record<string, boolean>
  onOpen: (settingId: string) => void
}

function DecisionList({ items, reviewed, onOpen }: DecisionListProps) {
  return (
    <div className="decision-list">
      <div className="decision-list__header">
        <span>Decision</span>
        <span>Desired value</span>
        <span>Status</span>
      </div>
      {items.map((item) => (
        <button className="decision-list__row" key={item.setting.id} onClick={() => onOpen(item.setting.id)} type="button">
          <span>
            <strong>{item.setting.title}</strong>
            <small>{item.setting.prompt}</small>
          </span>
          <span>{choiceLabel(item)}</span>
          <span className={isComplete(item, reviewed) ? "review-state review-state--complete" : "review-state"}>
            {item.setting.editable === false ? "Derived" : isReviewed(item, reviewed) ? "Reviewed" : "Review"}
          </span>
        </button>
      ))}
    </div>
  )
}

function ProfileContext() {
  return (
    <>
      <section>
        <h2>How your path is built</h2>
        <p>The path is deterministic: profile rules filter the catalog, planning intent tunes recommendation strength and high-effort choices, and applicable decisions stay in a fixed domain order.</p>
      </section>
      <section>
        <h2>How to read the visuals</h2>
        <p>Sliders express preference. Charts compare relative control influence and effort inside this catalog; they do not inspect or grade a tenant.</p>
      </section>
      <section>
        <h2>What “reviewed” means</h2>
        <p>A recommendation is not treated as accepted until you save it or explicitly accept the remaining recommendations in that domain.</p>
      </section>
      <section>
        <h2>Boundary</h2>
        <p>Unknown tenant state is not converted into a gap. This remains a desired-state planning tool.</p>
      </section>
    </>
  )
}

function DecisionContext({ item }: { item: RecommendedSetting }) {
  const { setting, recommended } = item
  return (
    <>
      <section>
        <h2>Why this matters</h2>
        <p>{setting.rationale}</p>
      </section>
      <section>
        <h2>Tradeoff</h2>
        <p>{setting.tradeoff}</p>
      </section>
      <section>
        <h2>What this changes</h2>
        <p>{setting.consequences}</p>
      </section>
      <section>
        <h2>Before applying</h2>
        <p>{setting.prerequisites}</p>
      </section>
      <section>
        <h2>Plan impact</h2>
        <dl>
          <div><dt>Recommended value</dt><dd>{choiceLabel(item, recommended)}</dd></div>
          <div><dt>Control influence</dt><dd>{setting.influence}</dd></div>
          <div><dt>Rollout effort</dt><dd>{setting.rolloutBand}</dd></div>
          <div><dt>Ongoing effort</dt><dd>{setting.ongoingBand}</dd></div>
          <div><dt>Scope</dt><dd>{setting.scope}</dd></div>
          <div><dt>Responsible role</dt><dd>{setting.role}</dd></div>
          <div><dt>Apply method</dt><dd>{setting.applyMethod}</dd></div>
        </dl>
      </section>
      <section>
        <h2>Sources</h2>
        <ul className="context-sources">
          {setting.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} rel="noreferrer" target="_blank">{source.label}</a>
              <span>{source.tier}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function ReviewContext() {
  return (
    <>
      <section>
        <h2>Relative, not a grade</h2>
        <p>Domain profiles compare control influence and effort inside this catalog. They do not measure tenant adherence or predict security outcomes.</p>
      </section>
      <section>
        <h2>Export boundary</h2>
        <p>JSON is a desired-state contract for future adapters. Markdown is intended for review and decision records. Neither applies settings.</p>
      </section>
    </>
  )
}

interface SelectFieldProps {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

export default App
