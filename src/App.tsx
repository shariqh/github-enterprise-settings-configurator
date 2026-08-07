import { useEffect, useMemo, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { priorityOptions } from "./catalog"
import { ChoiceGroup } from "./components/ChoiceGroup"
import { Review } from "./components/Review"
import {
  DecisionImpact,
  DomainLandscape,
  IntentControls,
  PlanSignature,
} from "./components/VisualPlanning"
import { deployments, resolveProfile } from "./logic/capabilities"
import { buildMarkdown, download, exportObject } from "./logic/export"
import {
  clearCachedPlan,
  parseImportedPlan,
  readCachedPlan,
  saveCachedPlan,
} from "./logic/persistence"
import {
  acceptDecisionValues,
  createDefaultPlanDraft,
  reconcilePlanDraftState,
  transitionProfile,
} from "./logic/profile"
import { getRecommendedSettings } from "./logic/recommendations"
import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CopilotPlan,
  CurrentState,
  Deployment,
  Domain,
  IntentAxis,
  IntentLevel,
  LicenseStatus,
  LicensedProductId,
  MigrationNotice,
  Plan,
  PlanDraftState,
  PlanIntent,
  PlanningScopeId,
  PriorityId,
  Profile,
  ProvisioningMethod,
  RecommendedSetting,
  RepositoryVisibility,
  ResolvedProfile,
} from "./types"
import "./App.css"

const domainOrder: Domain[] = [
  "Identity & administration",
  "Organization & repository governance",
  "Code security",
  "Code quality",
  "Actions & supply chain",
  "Audit visibility",
  "Copilot governance",
  "Copilot cost controls",
]

const currentStates: CurrentState[] = ["greenfield", "existing", "migration", "unknown"]

const deploymentLabels: Record<Deployment, string> = {
  dotcom: "GitHub.com",
  residency: "GHE.com data residency",
  ghes: "GHES 3.21",
}

const basePlanLabels: Record<BasePlan, string> = {
  team: "GitHub Team",
  enterprise: "GitHub Enterprise",
  unknown: "Unknown — needs discovery",
}

const accountModelLabels: Record<AccountModel, string> = {
  personal: "Personal accounts",
  managed: "Managed users (EMU)",
  instance: "Instance accounts (GHES)",
  unknown: "Unknown — needs discovery",
}

const authenticationLabels: Record<AuthenticationMethod, string> = {
  github: "GitHub.com credentials",
  saml: "SAML SSO",
  oidc: "OIDC SSO",
  "built-in": "Built-in authentication",
  ldap: "LDAP",
  cas: "CAS",
  unknown: "Unknown — needs discovery",
}

const provisioningLabels: Record<ProvisioningMethod, string> = {
  none: "None",
  "scim-access": "SAML SSO only (no SCIM provisioning)",
  scim: "SCIM provisioning",
  jit: "Just-in-time provisioning",
  ldap: "LDAP sync",
  "first-sign-in": "First sign-in provisioning",
  manual: "Manual account creation",
  unknown: "Unknown — needs discovery",
}

const repositoryVisibilityLabels: Record<RepositoryVisibility, string> = {
  public: "Public",
  "private-internal": "Private/internal only",
  mixed: "Public and private/internal",
  unknown: "Unknown — needs discovery",
}

const currentStateLabels: Record<CurrentState, string> = {
  greenfield: "Greenfield",
  existing: "Existing environment",
  migration: "Migration",
  unknown: "Unknown / discovery needed",
}

const licenseStatusLabels: Record<LicenseStatus, string> = {
  unlicensed: "Not licensed",
  licensed: "Licensed",
  unknown: "Unknown — needs discovery",
}

const copilotPlanLabels: Record<CopilotPlan, string> = {
  none: "None",
  business: "Copilot Business",
  enterprise: "Copilot Enterprise",
  unknown: "Unknown — needs discovery",
}

const licensedProductLabels: Record<LicensedProductId, string> = {
  secretProtection: "Secret Protection",
  codeSecurity: "Code Security",
  codeQuality: "Code Quality",
}

const planningScopeLabels: Record<PlanningScopeId, string> = {
  actions: "GitHub Actions",
  audit: "Audit log visibility",
}

const licensedProductOrder: LicensedProductId[] = ["secretProtection", "codeSecurity", "codeQuality"]
const planningScopeOrder: PlanningScopeId[] = ["actions", "audit"]

type ActiveSection = "profile" | "review" | Domain
type DomainView = "guided" | "list"
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
  const restoredDraft = cachedPlan.ok ? cachedPlan.value : null
  const [initialRestoration] = useState(() =>
    reconcilePlanDraftState(restoredDraft?.state ?? createDefaultPlanDraft()))
  const initialDraft = initialRestoration.state
  const [profile, setProfile] = useState<Profile>(initialDraft.profile)
  const [intent, setIntent] = useState<PlanIntent>(initialDraft.intent)
  const [priorities, setPriorities] = useState<PriorityId[]>(initialDraft.priorities)
  const [selections, setSelections] = useState<Record<string, string>>(initialDraft.selections)
  const [dormantSelections, setDormantSelections] = useState<Record<string, string>>(initialDraft.dormantSelections)
  const [reviewed, setReviewed] = useState<Record<string, boolean>>(initialDraft.reviewed)
  const [activeSection, setActiveSection] = useState<ActiveSection>("profile")
  const [activeSettingId, setActiveSettingId] = useState<string | null>(null)
  const [domainView, setDomainView] = useState<DomainView>("guided")
  const [pathMenuOpen, setPathMenuOpen] = useState(false)
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false)
  const [planNotice, setPlanNotice] = useState<PlanNotice | null>(() => {
    if (!cachedPlan.ok) return { kind: "error", message: cachedPlan.error }
    if (cachedPlan.value) {
      const migrationSummary = [...cachedPlan.value.notices, ...initialRestoration.notices]
        .map((notice) => notice.message)
        .join(" ")
      return {
        kind: "success",
        message: `Restored your local draft.${migrationSummary ? ` ${migrationSummary}` : ""}`,
      }
    }
    return null
  })
  const importInputRef = useRef<HTMLInputElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const pathMenuRef = useRef<HTMLDivElement>(null)
  const pathMenuToggleRef = useRef<HTMLButtonElement>(null)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const actionsMenuToggleRef = useRef<HTMLButtonElement>(null)
  const focusReady = useRef(false)

  const plan: Plan = { profile, intent, priorities, selections }
  const resolvedProfile: ResolvedProfile = resolveProfile(profile)
  const profileValid = resolvedProfile.errors.length === 0
  const persistentState: PlanDraftState = useMemo(
    () => ({ profile, intent, priorities, selections, dormantSelections, reviewed }),
    [profile, intent, priorities, selections, dormantSelections, reviewed],
  )
  const persistenceFingerprint = JSON.stringify(persistentState)
  const restoredStateChanged = restoredDraft !== null
    && JSON.stringify(restoredDraft.state) !== persistenceFingerprint
  const shouldPersistRestoration = restoredDraft !== null
    && (restoredDraft.migratedFromVersion !== null || restoredStateChanged)
  const lastPersistedFingerprint = useRef(shouldPersistRestoration ? "" : persistenceFingerprint)
  const suppressNextSaveNotice = useRef(shouldPersistRestoration)
  const settings = getRecommendedSettings(plan)
  const reviewableSettings = settings.filter((item) => item.setting.editable !== false)
  const settingsByDomain = domainOrder
    .map((domain) => ({
      domain,
      items: settings.filter((item) => item.setting.domain === domain),
    }))
    .filter((group) => group.items.length > 0)
  const reviewedCount = settings.filter((item) => isReviewed(item, reviewed)).length
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
    const suppressNotice = suppressNextSaveNotice.current
    suppressNextSaveNotice.current = false
    if (suppressNotice && saved.ok) return

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

  const applyProfilePatch = (patch: Partial<Profile>) => {
    const { profile: nextProfile, notices: transitionNotices } = transitionProfile(profile, patch)
    const reconciled = reconcilePlanDraftState({
      profile: nextProfile,
      intent,
      priorities,
      selections,
      dormantSelections,
      reviewed,
    })
    const allNotices: MigrationNotice[] = [...transitionNotices, ...reconciled.notices]
    if (
      allNotices.length > 0
      && JSON.stringify(reconciled.state) !== persistenceFingerprint
    ) {
      suppressNextSaveNotice.current = true
    }

    setProfile(nextProfile)
    setSelections(reconciled.state.selections)
    setDormantSelections(reconciled.state.dormantSelections)
    setReviewed(reconciled.state.reviewed)
    if (allNotices.length > 0) {
      setPlanNotice({ kind: "info", message: allNotices.map((notice) => notice.message).join(" ") })
    }
  }

  const setDeployment = (value: Deployment) => applyProfilePatch({ deployment: value })
  const setBasePlan = (value: BasePlan) => applyProfilePatch({ basePlan: value })
  const setAccountModel = (value: AccountModel) => applyProfilePatch({ accountModel: value })
  const setAuthentication = (value: AuthenticationMethod) => applyProfilePatch({ authentication: value })
  const setProvisioning = (value: ProvisioningMethod) => applyProfilePatch({ provisioning: value })
  const setRepositoryVisibility = (value: RepositoryVisibility) => applyProfilePatch({ repositoryVisibility: value })
  const setCurrentState = (value: CurrentState) => applyProfilePatch({ currentState: value })
  const setLicenseStatus = (product: LicensedProductId, status: LicenseStatus) =>
    applyProfilePatch({ licensedProducts: { ...profile.licensedProducts, [product]: status } })
  const setCopilotPlan = (value: CopilotPlan) =>
    applyProfilePatch({ licensedProducts: { ...profile.licensedProducts, copilot: value } })
  const setPlanningScope = (scope: PlanningScopeId, enabled: boolean) =>
    applyProfilePatch({ planningScope: { ...profile.planningScope, [scope]: enabled } })

  const togglePriority = (priority: PriorityId) => {
    setPriorities((current) =>
      current.includes(priority)
        ? current.filter((id) => id !== priority)
        : [...current, priority],
    )
  }

  const setIntentValue = (axis: IntentAxis, value: IntentLevel) => {
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
    const accepted = acceptDecisionValues(
      { selections, reviewed },
      remainingRecommendations,
    )
    setSelections(accepted.selections)
    setReviewed(accepted.reviewed)
  }

  const saveAndContinue = () => {
    if (!activeItem || !isDomain(activeSection)) return

    const accepted = acceptDecisionValues({ selections, reviewed }, [activeItem])
    const nextReviewed = accepted.reviewed
    if (activeItem.setting.editable !== false) {
      setSelections(accepted.selections)
      setReviewed(nextReviewed)
    }

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
    const defaultDraft = createDefaultPlanDraft()
    lastPersistedFingerprint.current = cleared.ok ? JSON.stringify(defaultDraft) : ""
    setProfile(defaultDraft.profile)
    setIntent(defaultDraft.intent)
    setPriorities(defaultDraft.priorities)
    setSelections(defaultDraft.selections)
    setDormantSelections(defaultDraft.dormantSelections)
    setReviewed(defaultDraft.reviewed)
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

    const { state, notices } = imported.value
    const reconciled = reconcilePlanDraftState(state)
    const importedState = reconciled.state
    const saved = saveCachedPlan(importedState)
    if (saved.ok) lastPersistedFingerprint.current = JSON.stringify(importedState)
    setProfile(importedState.profile)
    setIntent(importedState.intent)
    setPriorities(importedState.priorities)
    setSelections(importedState.selections)
    setDormantSelections(importedState.dormantSelections)
    setReviewed(importedState.reviewed)
    setActiveSection("profile")
    setActiveSettingId(null)
    setDomainView("guided")

    const importedSettingCount = Object.keys(importedState.selections).length
    const migrationSummary = [...notices, ...reconciled.notices]
      .map((notice) => notice.message)
      .join(" ")
    const importMessage = `Imported ${importedSettingCount} active setting${importedSettingCount === 1 ? "" : "s"}.${migrationSummary ? ` ${migrationSummary}` : ""}`
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
          settings
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
          <span>{deploymentLabels[profile.deployment]} · {basePlanLabels[profile.basePlan]} · {accountModelLabels[profile.accountModel]}</span>
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
              <small>{resolvedProfile.errors.length > 0 ? "Needs attention" : "Ready"}</small>
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
              applicableCount={settings.length}
              intent={intent}
              onAccountModelChange={setAccountModel}
              onAuthenticationChange={setAuthentication}
              onBasePlanChange={setBasePlan}
              onBuild={buildPlan}
              onCopilotPlanChange={setCopilotPlan}
              onCurrentStateChange={setCurrentState}
              onDeploymentChange={setDeployment}
              onIntentChange={setIntentValue}
              onLicenseStatusChange={setLicenseStatus}
              onOpenDomain={openDomain}
              onPlanningScopeChange={setPlanningScope}
              onPriorityToggle={togglePriority}
              onProvisioningChange={setProvisioning}
              onRepositoryVisibilityChange={setRepositoryVisibility}
              priorities={priorities}
              profile={profile}
              profileValid={profileValid}
              resolvedProfile={resolvedProfile}
              settings={settings}
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

interface OptionSpec<T extends string> {
  value: T
  label: string
  available: boolean
  reason?: string
}

const mapOptions = <T extends string>(
  options: { value: T; available: boolean; reason?: string }[],
  labels: Record<T, string>,
): OptionSpec<T>[] =>
  options.map((option) => ({
    value: option.value,
    label: labels[option.value],
    available: option.available,
    reason: option.reason,
  }))

interface ProfileEditorProps {
  profile: Profile
  resolvedProfile: ResolvedProfile
  intent: PlanIntent
  priorities: PriorityId[]
  applicableCount: number
  profileValid: boolean
  settings: RecommendedSetting[]
  onDeploymentChange: (value: Deployment) => void
  onBasePlanChange: (value: BasePlan) => void
  onAccountModelChange: (value: AccountModel) => void
  onAuthenticationChange: (value: AuthenticationMethod) => void
  onProvisioningChange: (value: ProvisioningMethod) => void
  onRepositoryVisibilityChange: (value: RepositoryVisibility) => void
  onCurrentStateChange: (value: CurrentState) => void
  onLicenseStatusChange: (product: LicensedProductId, status: LicenseStatus) => void
  onCopilotPlanChange: (value: CopilotPlan) => void
  onPlanningScopeChange: (scope: PlanningScopeId, enabled: boolean) => void
  onIntentChange: (axis: IntentAxis, value: IntentLevel) => void
  onOpenDomain: (domain: Domain) => void
  onPriorityToggle: (priority: PriorityId) => void
  onBuild: () => void
}

function ProfileEditor({
  profile,
  resolvedProfile,
  intent,
  priorities,
  applicableCount,
  profileValid,
  settings,
  onDeploymentChange,
  onBasePlanChange,
  onAccountModelChange,
  onAuthenticationChange,
  onProvisioningChange,
  onRepositoryVisibilityChange,
  onCurrentStateChange,
  onLicenseStatusChange,
  onCopilotPlanChange,
  onPlanningScopeChange,
  onIntentChange,
  onOpenDomain,
  onPriorityToggle,
  onBuild,
}: ProfileEditorProps) {
  const { errors, warnings, options } = resolvedProfile
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
        <ProfileSelect
          id="deployment"
          label="Deployment"
          onChange={onDeploymentChange}
          options={deployments.map((value) => ({ value, label: deploymentLabels[value], available: true }))}
          value={profile.deployment}
        />
        <ProfileSelect
          id="base-plan"
          label="Base plan"
          onChange={onBasePlanChange}
          options={mapOptions(options.basePlan, basePlanLabels)}
          value={profile.basePlan}
        />
        <ProfileSelect
          id="account-model"
          label="Account model"
          onChange={onAccountModelChange}
          options={mapOptions(options.accountModel, accountModelLabels)}
          value={profile.accountModel}
        />
        <ProfileSelect
          id="authentication"
          label="Authentication"
          onChange={onAuthenticationChange}
          options={mapOptions(options.authentication, authenticationLabels)}
          value={profile.authentication}
        />
        <ProfileSelect
          id="provisioning"
          label="Provisioning"
          onChange={onProvisioningChange}
          options={mapOptions(options.provisioning, provisioningLabels)}
          value={profile.provisioning}
        />
        <ProfileSelect
          id="repository-visibility"
          label="Repository visibility"
          onChange={onRepositoryVisibilityChange}
          options={mapOptions(options.repositoryVisibility, repositoryVisibilityLabels)}
          value={profile.repositoryVisibility}
        />
        <ProfileSelect
          id="current-state"
          label="Current state"
          onChange={onCurrentStateChange}
          options={currentStates.map((value) => ({ value, label: currentStateLabels[value], available: true }))}
          value={profile.currentState}
        />
      </div>

      <div className="profile-intent">
        <IntentControls intent={intent} onChange={onIntentChange} />
        <PlanSignature intent={intent} settings={settings} />
      </div>

      <fieldset className="flat-fieldset">
        <legend>Security &amp; Copilot licensing</legend>
        <p>License status gates which security and Copilot decisions are applicable to this plan.</p>
        <div className="profile-fields">
          {licensedProductOrder.map((product) => (
            <ProfileSelect
              id={`license-${product}`}
              key={product}
              label={licensedProductLabels[product]}
              onChange={(value) => onLicenseStatusChange(product, value)}
              options={mapOptions(options.licensedProducts[product], licenseStatusLabels)}
              value={profile.licensedProducts[product]}
            />
          ))}
          <ProfileSelect
            id="copilot-plan"
            label="Copilot plan"
            onChange={onCopilotPlanChange}
            options={mapOptions(options.copilot, copilotPlanLabels)}
            value={profile.licensedProducts.copilot}
          />
        </div>
      </fieldset>

      <fieldset className="flat-fieldset">
        <legend>Planning scope</legend>
        <p>Only relevant domains and decisions will appear in your path.</p>
        <div className="check-list">
          {planningScopeOrder.map((scope) => (
            <label key={scope}>
              <input
                checked={profile.planningScope[scope]}
                onChange={(event) => onPlanningScopeChange(scope, event.target.checked)}
                type="checkbox"
              />
              <span>{planningScopeLabels[scope]}</span>
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

      {errors.length > 0 && (
        <div className="validation-notice" role="alert">
          <strong>Resolve this profile before continuing</strong>
          <ul>{errors.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="validation-notice" role="status">
          <strong>Worth noting</strong>
          <ul>{warnings.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul>
        </div>
      )}

      <footer className="profile-actions">
        <span>{applicableCount} settings will be included in this path.</span>
        <button className="button button--primary" disabled={!profileValid} onClick={onBuild} type="button">
          Build recommended plan
        </button>
      </footer>
    </section>
  )
}

interface ProfileSelectProps<T extends string> {
  id: string
  label: string
  value: T
  options: OptionSpec<T>[]
  onChange: (value: T) => void
}

function ProfileSelect<T extends string>({ id, label, value, options, onChange }: ProfileSelectProps<T>) {
  const current = options.find((option) => option.value === value)
  const showReason = Boolean(current && !current.available && current.reason)
  const reasonId = `${id}-reason`
  return (
    <label className="select-field">
      <span>{label}</span>
      <span className="select-field__control">
        <select
          aria-describedby={showReason ? reasonId : undefined}
          onChange={(event) => onChange(event.target.value as T)}
          value={value}
        >
          {options.map((option) => (
            <option disabled={!option.available} key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {showReason && <small className="select-field__reason" id={reasonId}>{current?.reason}</small>}
      </span>
    </label>
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

export default App
