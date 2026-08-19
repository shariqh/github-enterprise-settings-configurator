import { catalog, priorityOptions } from "../catalog"
import { deploymentLabels } from "../profileLabels"
import {
  accountModels,
  authenticationMethods,
  basePlans,
  copilotPlans,
  deployments,
  licenseStatuses,
  provisioningMethods,
  repositoryVisibilities,
} from "./capabilities"
import { defaultIntent } from "./intent"
import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CopilotPlan,
  CurrentState,
  Deployment,
  IntentLevel,
  LicenseStatus,
  LicensedProducts,
  MigrationNotice,
  PlanDraftState,
  PlanIntent,
  PlanningScope,
  PriorityId,
  Profile,
  ProvisioningMethod,
  RepositoryVisibility,
  Setting,
} from "../types"

// Cache/export schema history:
//   v1 — legacy flat profile (platform/identity/entitlement/products).
//   v2 — current PlanDraftState profile (deployment/basePlan/accountModel/
//        authentication/provisioning/repositoryVisibility/licensedProducts/
//        planningScope) plus dormantSelections.
// v1 data is detected and conservatively migrated; v2 is the only schema
// version considered current and is validated strictly.
const STORAGE_KEY = "github-enterprise-settings-configurator.plan.v2"
const LEGACY_STORAGE_KEY = "github-enterprise-settings-configurator.plan.v1"
const STORAGE_VERSION = 2
const LEGACY_STORAGE_VERSION = 1

/**
 * The persisted/exported plan shape is identical to the in-memory draft.
 * Exported for callers that previously depended on this name.
 */
export type PersistentPlanState = PlanDraftState

interface CachedPlanEnvelope {
  version: number
  savedAt: string
  state: PlanDraftState
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface ImportedPlan {
  state: PlanDraftState
  importedSettingCount: number
  usedDefaultIntent: boolean
  restoredReviewState: boolean
  /** Non-null when the imported file used an older schema and was migrated. */
  migratedFromVersion: number | null
  /** Human-readable notices describing any migration decisions that were made. */
  notices: MigrationNotice[]
}

export interface CachedPlanRead {
  state: PlanDraftState
  /** Non-null when the cached draft used an older schema and was migrated. */
  migratedFromVersion: number | null
  /** Human-readable notices describing any migration decisions that were made. */
  notices: MigrationNotice[]
}

const currentStates = new Set<CurrentState>(["greenfield", "existing", "migration", "unknown"])
const priorityIds = new Set<PriorityId>(priorityOptions.map((priority) => priority.id))
const catalogById = new Map(catalog.map((setting) => [setting.id, setting]))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// ---------------------------------------------------------------------------
// v2 (current) parsing — strict. Unknown settings/choices are always errors.
// ---------------------------------------------------------------------------

const parseIntentLevel = (value: unknown): value is IntentLevel =>
  value === 0 || value === 1 || value === 2

const parseIntent = (value: unknown): StorageResult<PlanIntent> => {
  if (!isRecord(value)) return { ok: false, error: "The plan intent is malformed." }
  const { guardrailStrength, rolloutPace, operationalCapacity } = value
  if (!parseIntentLevel(guardrailStrength) || !parseIntentLevel(rolloutPace) || !parseIntentLevel(operationalCapacity)) {
    return { ok: false, error: "Planning intent values must be 0, 1, or 2." }
  }
  return {
    ok: true,
    value: { guardrailStrength, rolloutPace, operationalCapacity },
  }
}

const parsePriorities = (value: unknown): StorageResult<PriorityId[]> => {
  if (!Array.isArray(value)) return { ok: false, error: "The plan priority list is malformed." }
  const parsed: PriorityId[] = []
  for (const priority of value) {
    if (typeof priority !== "string" || !priorityIds.has(priority as PriorityId)) {
      return { ok: false, error: `The plan contains an unsupported priority: ${String(priority)}.` }
    }
    if (!parsed.includes(priority as PriorityId)) parsed.push(priority as PriorityId)
  }
  return { ok: true, value: parsed }
}

const parseLicensedProducts = (value: unknown): StorageResult<LicensedProducts> => {
  if (!isRecord(value)) return { ok: false, error: "The plan licensed-products selection is missing or malformed." }
  const { secretProtection, codeSecurity, codeQuality, copilot } = value
  if (typeof secretProtection !== "string" || !licenseStatuses.includes(secretProtection as LicenseStatus)) {
    return { ok: false, error: "The plan has an unsupported Secret Protection license status." }
  }
  if (typeof codeSecurity !== "string" || !licenseStatuses.includes(codeSecurity as LicenseStatus)) {
    return { ok: false, error: "The plan has an unsupported Code Security license status." }
  }
  if (typeof codeQuality !== "string" || !licenseStatuses.includes(codeQuality as LicenseStatus)) {
    return { ok: false, error: "The plan has an unsupported Code Quality license status." }
  }
  if (typeof copilot !== "string" || !copilotPlans.includes(copilot as CopilotPlan)) {
    return { ok: false, error: "The plan has an unsupported Copilot plan value." }
  }
  return {
    ok: true,
    value: {
      secretProtection: secretProtection as LicenseStatus,
      codeSecurity: codeSecurity as LicenseStatus,
      codeQuality: codeQuality as LicenseStatus,
      copilot: copilot as CopilotPlan,
    },
  }
}

const parsePlanningScope = (value: unknown): StorageResult<PlanningScope> => {
  if (!isRecord(value)) return { ok: false, error: "The plan planning-scope selection is missing or malformed." }
  const { actions, audit } = value
  if (typeof actions !== "boolean") return { ok: false, error: "The plan is missing a valid Actions planning-scope selection." }
  if (typeof audit !== "boolean") return { ok: false, error: "The plan is missing a valid Audit planning-scope selection." }
  return { ok: true, value: { actions, audit } }
}

const parseProfile = (value: unknown): StorageResult<Profile> => {
  if (!isRecord(value)) return { ok: false, error: "The plan profile is missing or malformed." }
  const {
    deployment,
    basePlan,
    accountModel,
    authentication,
    provisioning,
    repositoryVisibility,
    currentState,
    licensedProducts,
    planningScope,
  } = value

  if (typeof deployment !== "string" || !deployments.includes(deployment as Deployment)) {
    return { ok: false, error: "The plan has an unsupported deployment value." }
  }
  if (typeof basePlan !== "string" || !basePlans.includes(basePlan as BasePlan)) {
    return { ok: false, error: "The plan has an unsupported base-plan value." }
  }
  if (typeof accountModel !== "string" || !accountModels.includes(accountModel as AccountModel)) {
    return { ok: false, error: "The plan has an unsupported account-model value." }
  }
  if (typeof authentication !== "string" || !authenticationMethods.includes(authentication as AuthenticationMethod)) {
    return { ok: false, error: "The plan has an unsupported authentication value." }
  }
  if (typeof provisioning !== "string" || !provisioningMethods.includes(provisioning as ProvisioningMethod)) {
    return { ok: false, error: "The plan has an unsupported provisioning value." }
  }
  if (
    typeof repositoryVisibility !== "string"
    || !repositoryVisibilities.includes(repositoryVisibility as RepositoryVisibility)
  ) {
    return { ok: false, error: "The plan has an unsupported repository-visibility value." }
  }
  if (typeof currentState !== "string" || !currentStates.has(currentState as CurrentState)) {
    return { ok: false, error: "The plan has an unsupported current-state value." }
  }
  const licensed = parseLicensedProducts(licensedProducts)
  if (!licensed.ok) return licensed
  const scope = parsePlanningScope(planningScope)
  if (!scope.ok) return scope

  return {
    ok: true,
    value: {
      deployment: deployment as Deployment,
      basePlan: basePlan as BasePlan,
      accountModel: accountModel as AccountModel,
      authentication: authentication as AuthenticationMethod,
      provisioning: provisioning as ProvisioningMethod,
      repositoryVisibility: repositoryVisibility as RepositoryVisibility,
      currentState: currentState as CurrentState,
      licensedProducts: licensed.value,
      planningScope: scope.value,
    },
  }
}

const validateSelection = (settingId: string, choiceId: unknown): StorageResult<string> => {
  const setting = catalogById.get(settingId)
  if (!setting) return { ok: false, error: `The plan contains an unknown setting: ${settingId}.` }
  if (typeof choiceId !== "string" || !setting.choices.some((choice) => choice.id === choiceId)) {
    return { ok: false, error: `The plan contains an unsupported choice for ${setting.title}.` }
  }
  return { ok: true, value: choiceId }
}

const parseSelectionRecord = (value: unknown): StorageResult<Record<string, string>> => {
  if (!isRecord(value)) return { ok: false, error: "The plan selection list is malformed." }
  const selections: Record<string, string> = {}
  for (const [settingId, choiceId] of Object.entries(value)) {
    const validated = validateSelection(settingId, choiceId)
    if (!validated.ok) return validated
    selections[settingId] = validated.value
  }
  return { ok: true, value: selections }
}

const parseExportedSettings = (value: unknown): StorageResult<Record<string, string>> => {
  if (!Array.isArray(value)) return { ok: false, error: "The imported file has no valid settings list." }
  const selections: Record<string, string> = {}
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") {
      return { ok: false, error: "The imported settings list contains a malformed entry." }
    }
    const validated = validateSelection(item.id, item.selected)
    if (!validated.ok) return validated
    selections[item.id] = validated.value
  }
  return { ok: true, value: selections }
}

// Dormant selections deliberately reference settings that are no longer part
// of the current catalog (they were stale in the source data, or intentionally
// retired). They must therefore be shape-validated only — checking them
// against `catalogById` would defeat the entire point of a dormant bucket.
const parseDormantSelectionRecord = (value: unknown): StorageResult<Record<string, string>> => {
  if (!isRecord(value)) return { ok: false, error: "The dormant selection list is malformed." }
  const selections: Record<string, string> = {}
  for (const [settingId, choiceId] of Object.entries(value)) {
    if (typeof choiceId !== "string") {
      return { ok: false, error: `The dormant selection for ${settingId} is malformed.` }
    }
    selections[settingId] = choiceId
  }
  return { ok: true, value: selections }
}

const parseDormantExportedSettings = (value: unknown): StorageResult<Record<string, string>> => {
  if (!Array.isArray(value)) return { ok: false, error: "The imported file has no valid dormant settings list." }
  const selections: Record<string, string> = {}
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.selected !== "string") {
      return { ok: false, error: "The imported dormant settings list contains a malformed entry." }
    }
    selections[item.id] = item.selected
  }
  return { ok: true, value: selections }
}

const parseReviewedRecord = (value: unknown): StorageResult<Record<string, boolean>> => {
  if (!isRecord(value)) return { ok: false, error: "The saved review state is malformed." }
  const reviewed: Record<string, boolean> = {}
  for (const [settingId, isReviewed] of Object.entries(value)) {
    if (!catalogById.has(settingId)) {
      return { ok: false, error: `The saved review state contains an unknown setting: ${settingId}.` }
    }
    if (typeof isReviewed !== "boolean") {
      return { ok: false, error: `The saved review state for ${settingId} is malformed.` }
    }
    if (isReviewed) reviewed[settingId] = true
  }
  return { ok: true, value: reviewed }
}

const parseReviewedIds = (value: unknown): StorageResult<Record<string, boolean>> => {
  if (!Array.isArray(value)) return { ok: false, error: "The imported review state is malformed." }
  const reviewed: Record<string, boolean> = {}
  for (const settingId of value) {
    if (typeof settingId !== "string" || !catalogById.has(settingId)) {
      return { ok: false, error: `The imported review state contains an unknown setting: ${String(settingId)}.` }
    }
    reviewed[settingId] = true
  }
  return { ok: true, value: reviewed }
}

const parsePersistentState = (value: unknown): StorageResult<PlanDraftState> => {
  if (!isRecord(value)) return { ok: false, error: "The saved plan is malformed." }

  const profile = parseProfile(value.profile)
  if (!profile.ok) return profile
  const intent = parseIntent(value.intent)
  if (!intent.ok) return intent
  const priorities = parsePriorities(value.priorities)
  if (!priorities.ok) return priorities
  const selections = parseSelectionRecord(value.selections)
  if (!selections.ok) return selections
  const dormantSelections = parseDormantSelectionRecord(value.dormantSelections ?? {})
  if (!dormantSelections.ok) return dormantSelections
  const reviewed = parseReviewedRecord(value.reviewed)
  if (!reviewed.ok) return reviewed

  return {
    ok: true,
    value: {
      profile: profile.value,
      intent: intent.value,
      priorities: priorities.value,
      selections: selections.value,
      dormantSelections: dormantSelections.value,
      reviewed: reviewed.value,
    },
  }
}

// ---------------------------------------------------------------------------
// v1 (legacy) migration — conservative and lenient. Unknown/removed settings
// are preserved as dormant rather than failing the whole migration; only a
// structurally invalid legacy profile causes an error.
// ---------------------------------------------------------------------------

const legacyPlatforms = new Set(["dotcom", "residency", "ghes"])
const legacyIdentities = new Set(["personal", "emu"])
const legacyEntitlements = new Set(["enterprise", "copilot"])
const legacyProductKeys = ["actions", "security", "copilot", "audit"] as const

type LegacyProductKey = (typeof legacyProductKeys)[number]

interface LegacyProfileRaw {
  platform: "dotcom" | "residency" | "ghes"
  identity: "personal" | "emu"
  entitlement: "enterprise" | "copilot"
  currentState: CurrentState
  products: Record<LegacyProductKey, boolean>
}

const parseLegacyProfile = (value: unknown): StorageResult<LegacyProfileRaw> => {
  if (!isRecord(value)) return { ok: false, error: "The legacy plan profile is missing or malformed." }
  const { platform, identity, entitlement, currentState, products } = value

  if (typeof platform !== "string" || !legacyPlatforms.has(platform)) {
    return { ok: false, error: "The legacy plan has an unsupported platform value." }
  }
  if (typeof identity !== "string" || !legacyIdentities.has(identity)) {
    return { ok: false, error: "The legacy plan has an unsupported identity value." }
  }
  if (typeof entitlement !== "string" || !legacyEntitlements.has(entitlement)) {
    return { ok: false, error: "The legacy plan has an unsupported entitlement value." }
  }
  if (typeof currentState !== "string" || !currentStates.has(currentState as CurrentState)) {
    return { ok: false, error: "The legacy plan has an unsupported current-state value." }
  }
  if (!isRecord(products)) {
    return { ok: false, error: "The legacy plan product selection is missing or malformed." }
  }
  const parsedProducts = {} as Record<LegacyProductKey, boolean>
  for (const key of legacyProductKeys) {
    if (typeof products[key] !== "boolean") {
      return { ok: false, error: `The legacy plan is missing a valid ${key} product selection.` }
    }
    parsedProducts[key] = products[key] as boolean
  }

  return {
    ok: true,
    value: {
      platform: platform as LegacyProfileRaw["platform"],
      identity: identity as LegacyProfileRaw["identity"],
      entitlement: entitlement as LegacyProfileRaw["entitlement"],
      currentState: currentState as CurrentState,
      products: parsedProducts,
    },
  }
}

/**
 * Conservatively maps a legacy (v1) profile onto the current Profile shape.
 * Fields with no reliable legacy signal are set to "unknown" rather than
 * guessed, so the profile editor surfaces them for the user to resolve.
 */
export function migrateLegacyProfile(
  legacy: LegacyProfileRaw,
): { profile: Profile; notices: MigrationNotice[] } {
  const notices: MigrationNotice[] = []
  const deployment: Deployment = legacy.platform

  const basePlan: BasePlan = legacy.entitlement === "enterprise" ? "enterprise" : "unknown"
  if (legacy.entitlement === "copilot") {
    notices.push({
      code: "legacy-base-plan-unknown",
      message: "The legacy plan used a Copilot-only entitlement, which does not map to a specific base plan; base plan was set to unknown.",
    })
  }

  let accountModel: AccountModel
  let authentication: AuthenticationMethod
  let provisioning: ProvisioningMethod
  if (deployment === "ghes") {
    accountModel = "instance"
    authentication = "unknown"
    provisioning = "unknown"
    notices.push({
      code: "legacy-ghes-identity-unknown",
      message: `${deploymentLabels.ghes} authentication and provisioning could not be inferred from the legacy plan and were set to unknown.`,
    })
  } else if (deployment === "residency") {
    accountModel = "managed"
    authentication = "unknown"
    provisioning = "scim"
    notices.push({
      code: "legacy-residency-emu-required",
      message: `${deploymentLabels.residency} requires Enterprise Managed Users; the account model was set to managed users, authentication to unknown, and provisioning to SCIM.`,
    })
  } else if (legacy.identity === "emu") {
    accountModel = "managed"
    authentication = "unknown"
    provisioning = "scim"
    notices.push({
      code: "legacy-emu-authentication-unknown",
      message: "The legacy plan tracked EMU without an authentication method; authentication was set to unknown and provisioning to SCIM.",
    })
  } else {
    accountModel = "personal"
    authentication = "unknown"
    provisioning = "none"
    notices.push({
      code: "legacy-authentication-unknown",
      message: "The legacy plan did not track an authentication method; it was set to unknown.",
    })
  }

  const repositoryVisibility: RepositoryVisibility = "unknown"
  notices.push({
    code: "legacy-repository-visibility-unknown",
    message: "Repository visibility was not tracked in the legacy plan and was set to unknown.",
  })

  const legacySecurityStatus: LicenseStatus = legacy.products.security ? "unknown" : "unlicensed"
  if (legacy.products.security) {
    notices.push({
      code: "legacy-security-license-unknown",
      message: "The legacy plan enabled security products without distinguishing Secret Protection from Code Security; both were set to unknown licensing.",
    })
  }

  const copilot: CopilotPlan = legacy.products.copilot ? "unknown" : "none"
  if (legacy.products.copilot) {
    notices.push({
      code: "legacy-copilot-plan-unknown",
      message: "The legacy plan enabled Copilot without recording a specific plan; Copilot licensing was set to unknown.",
    })
  }

  const licensedProducts: LicensedProducts = {
    secretProtection: legacySecurityStatus,
    codeSecurity: legacySecurityStatus,
    codeQuality: "unlicensed",
    copilot,
  }

  const planningScope: PlanningScope = {
    actions: legacy.products.actions,
    audit: legacy.products.audit,
  }

  const profile: Profile = {
    deployment,
    basePlan,
    accountModel,
    authentication,
    provisioning,
    repositoryVisibility,
    currentState: legacy.currentState,
    licensedProducts,
    planningScope,
  }

  return { profile, notices }
}

// The single security-configuration setting is expected to eventually split
// into separate Secret Protection and Code Security configuration settings.
// When the legacy setting id is gone from the catalog but both split ids are
// present, the old choice is carried across to whichever split setting still
// recognizes it, and its review state is cleared because it is effectively a
// new decision. Until the catalog is split, the legacy id still exists and
// is preserved unchanged by the generic "preserve" path below.
const SECURITY_SPLIT_SOURCE_ID = "security-configuration"
const SECURITY_SPLIT_TARGET_IDS = ["secret-protection-configuration", "code-security-configuration"] as const

export interface LegacyDecisionMigration {
  selections: Record<string, string>
  dormantSelections: Record<string, string>
  reviewed: Record<string, boolean>
  notices: MigrationNotice[]
}

/**
 * Migrates a flat legacy (setting id -> choice id) selection list against a
 * catalog map. Exported (and parameterized by catalog map) so the security
 * split behavior can be exercised directly in tests without depending on the
 * catalog having already been split.
 */
export function migrateLegacyDecisions(
  entries: readonly (readonly [string, string])[],
  reviewedIds: ReadonlySet<string>,
  catalogMap: ReadonlyMap<string, Setting> = catalogById,
): LegacyDecisionMigration {
  const selections: Record<string, string> = {}
  const dormantSelections: Record<string, string> = {}
  const reviewed: Record<string, boolean> = {}
  const notices: MigrationNotice[] = []

  for (const [settingId, choiceId] of entries) {
    const setting = catalogMap.get(settingId)
    if (setting?.choices.some((choice) => choice.id === choiceId)) {
      selections[settingId] = choiceId
      if (reviewedIds.has(settingId)) reviewed[settingId] = true
      continue
    }

    if (
      settingId === SECURITY_SPLIT_SOURCE_ID
      && SECURITY_SPLIT_TARGET_IDS.every((targetId) => catalogMap.has(targetId))
    ) {
      let mappedAny = false
      for (const targetId of SECURITY_SPLIT_TARGET_IDS) {
        const targetSetting = catalogMap.get(targetId)
        if (targetSetting?.choices.some((choice) => choice.id === choiceId)) {
          selections[targetId] = choiceId
          mappedAny = true
          // Deliberately not carrying `reviewed` forward: a split setting is
          // a new decision and must be reviewed again.
        }
      }
      if (mappedAny) {
        notices.push({
          code: "security-configuration-split",
          message: "The legacy Security configuration setting was split into Secret Protection and Code Security configurations; review the migrated choices.",
        })
      } else {
        dormantSelections[settingId] = choiceId
        notices.push({
          code: `dormant-legacy-${settingId}`,
          message: `${settingId} could not be mapped to the new Secret Protection and Code Security configurations and was preserved as a dormant legacy choice.`,
        })
      }
      continue
    }

    dormantSelections[settingId] = choiceId
    notices.push({
      code: `dormant-legacy-${settingId}`,
      message: `${settingId} is no longer part of the current catalog and was preserved as a dormant legacy choice.`,
    })
  }

  return { selections, dormantSelections, reviewed, notices }
}

const recordEntries = (value: unknown): [string, string][] => {
  if (!isRecord(value)) return []
  const entries: [string, string][] = []
  for (const [settingId, choiceId] of Object.entries(value)) {
    if (typeof choiceId === "string") entries.push([settingId, choiceId])
  }
  return entries
}

const legacyReviewedRecordIds = (value: unknown): Set<string> => {
  if (!isRecord(value)) return new Set()
  return new Set(
    Object.entries(value)
      .filter(([, isReviewed]) => isReviewed === true)
      .map(([settingId]) => settingId),
  )
}

/** Migrates a legacy (v1) cache/import envelope's `state` object. */
function migrateLegacyEnvelopeState(
  value: unknown,
): StorageResult<{ state: PlanDraftState; notices: MigrationNotice[] }> {
  if (!isRecord(value)) return { ok: false, error: "The legacy plan is malformed." }

  const legacyProfile = parseLegacyProfile(value.profile)
  if (!legacyProfile.ok) return legacyProfile
  const intent = isRecord(value.intent)
    ? parseIntent(value.intent)
    : { ok: true as const, value: { ...defaultIntent } }
  if (!intent.ok) return intent
  const priorities = parsePriorities(value.priorities ?? [])
  if (!priorities.ok) return priorities

  const entries = recordEntries(value.selections)
  const reviewedIds = legacyReviewedRecordIds(value.reviewed)

  const { profile, notices: profileNotices } = migrateLegacyProfile(legacyProfile.value)
  const decisions = migrateLegacyDecisions(entries, reviewedIds)

  return {
    ok: true,
    value: {
      state: {
        profile,
        intent: intent.value,
        priorities: priorities.value,
        selections: decisions.selections,
        dormantSelections: decisions.dormantSelections,
        reviewed: decisions.reviewed,
      },
      notices: [...profileNotices, ...decisions.notices],
    },
  }
}

/** Migrates a legacy (schemaVersion 1, or version-less) exported plan file. */
function migrateLegacyExport(parsed: Record<string, unknown>): StorageResult<ImportedPlan> {
  const legacyProfile = parseLegacyProfile(parsed.profile)
  if (!legacyProfile.ok) return legacyProfile

  const usedDefaultIntent = parsed.intent === undefined
  const intent = usedDefaultIntent
    ? { ok: true as const, value: { ...defaultIntent } }
    : parseIntent(parsed.intent)
  if (!intent.ok) return intent

  const priorities = parsePriorities(parsed.priorities ?? [])
  if (!priorities.ok) return priorities

  let entries: [string, string][]
  if ("selections" in parsed) {
    entries = recordEntries(parsed.selections)
  } else if (Array.isArray(parsed.settings)) {
    entries = []
    for (const item of parsed.settings) {
      if (isRecord(item) && typeof item.id === "string" && typeof item.selected === "string") {
        entries.push([item.id, item.selected])
      }
    }
  } else {
    return { ok: false, error: "The imported file has no valid settings list." }
  }

  const restoredReviewState = parsed.reviewedSettingIds !== undefined
  const reviewedIds = new Set(
    restoredReviewState && Array.isArray(parsed.reviewedSettingIds)
      ? parsed.reviewedSettingIds.filter((id): id is string => typeof id === "string")
      : [],
  )

  const { profile, notices: profileNotices } = migrateLegacyProfile(legacyProfile.value)
  const decisions = migrateLegacyDecisions(entries, reviewedIds)

  return {
    ok: true,
    value: {
      state: {
        profile,
        intent: intent.value,
        priorities: priorities.value,
        selections: decisions.selections,
        dormantSelections: decisions.dormantSelections,
        reviewed: decisions.reviewed,
      },
      importedSettingCount: Object.keys(decisions.selections).length,
      usedDefaultIntent,
      restoredReviewState,
      migratedFromVersion: LEGACY_STORAGE_VERSION,
      notices: [...profileNotices, ...decisions.notices],
    },
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const readCachedPlan = (): StorageResult<CachedPlanRead | null> => {
  try {
    const rawV2 = window.localStorage.getItem(STORAGE_KEY)
    if (rawV2 !== null) {
      const parsed: unknown = JSON.parse(rawV2)
      if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
        return { ok: false, error: "The local draft uses an unsupported cache version." }
      }
      const state = parsePersistentState(parsed.state)
      if (!state.ok) return { ok: false, error: `The local draft could not be restored. ${state.error}` }
      return { ok: true, value: { state: state.value, migratedFromVersion: null, notices: [] } }
    }

    const rawV1 = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    if (rawV1 !== null) {
      const parsed: unknown = JSON.parse(rawV1)
      if (!isRecord(parsed) || parsed.version !== LEGACY_STORAGE_VERSION) {
        return { ok: false, error: "The local draft uses an unsupported cache version." }
      }
      const migrated = migrateLegacyEnvelopeState(parsed.state)
      if (!migrated.ok) {
        return { ok: false, error: `The local draft could not be restored. ${migrated.error}` }
      }
      return {
        ok: true,
        value: {
          state: migrated.value.state,
          migratedFromVersion: LEGACY_STORAGE_VERSION,
          notices: migrated.value.notices,
        },
      }
    }

    return { ok: true, value: null }
  } catch (error) {
    return { ok: false, error: `The local draft could not be read. ${errorMessage(error)}` }
  }
}

export const saveCachedPlan = (state: PlanDraftState): StorageResult<null> => {
  const envelope: CachedPlanEnvelope = {
    version: STORAGE_VERSION,
    savedAt: new Date().toISOString(),
    state,
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
    return { ok: true, value: null }
  } catch (error) {
    return { ok: false, error: `The plan could not be saved locally. ${errorMessage(error)}` }
  }
}

export const clearCachedPlan = (): StorageResult<null> => {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
    window.localStorage.removeItem(LEGACY_STORAGE_KEY)
    return { ok: true, value: null }
  } catch (error) {
    return { ok: false, error: `The local draft could not be cleared. ${errorMessage(error)}` }
  }
}

const parseV2ExportSelections = (parsed: Record<string, unknown>): StorageResult<Record<string, string>> =>
  "selections" in parsed
    ? parseSelectionRecord(parsed.selections)
    : parseExportedSettings(parsed.settings)

const parseV2ExportDormantSelections = (parsed: Record<string, unknown>): StorageResult<Record<string, string>> => {
  if ("dormantSelections" in parsed) return parseDormantSelectionRecord(parsed.dormantSelections)
  if (Array.isArray(parsed.dormantSettings)) return parseDormantExportedSettings(parsed.dormantSettings)
  return { ok: true, value: {} }
}

export const parseImportedPlan = (contents: string): StorageResult<ImportedPlan> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch (error) {
    return { ok: false, error: `The selected file is not valid JSON. ${errorMessage(error)}` }
  }
  if (!isRecord(parsed)) return { ok: false, error: "The selected file does not contain a plan object." }

  if ("state" in parsed && "version" in parsed) {
    const version = parsed.version
    if (version === STORAGE_VERSION) {
      const state = parsePersistentState(parsed.state)
      if (!state.ok) return state
      return {
        ok: true,
        value: {
          state: state.value,
          importedSettingCount: Object.keys(state.value.selections).length,
          usedDefaultIntent: false,
          restoredReviewState: true,
          migratedFromVersion: null,
          notices: [],
        },
      }
    }
    if (version === LEGACY_STORAGE_VERSION) {
      const migrated = migrateLegacyEnvelopeState(parsed.state)
      if (!migrated.ok) return migrated
      return {
        ok: true,
        value: {
          state: migrated.value.state,
          importedSettingCount: Object.keys(migrated.value.state.selections).length,
          usedDefaultIntent: false,
          restoredReviewState: true,
          migratedFromVersion: LEGACY_STORAGE_VERSION,
          notices: migrated.value.notices,
        },
      }
    }
    return { ok: false, error: "The selected cached plan uses an unsupported version." }
  }

  const schemaVersion = parsed.schemaVersion

  if (schemaVersion === STORAGE_VERSION) {
    const profile = parseProfile(parsed.profile)
    if (!profile.ok) return profile
    const usedDefaultIntent = parsed.intent === undefined
    const intent = usedDefaultIntent
      ? { ok: true as const, value: { ...defaultIntent } }
      : parseIntent(parsed.intent)
    if (!intent.ok) return intent
    const priorities = parsePriorities(parsed.priorities ?? [])
    if (!priorities.ok) return priorities
    const selections = parseV2ExportSelections(parsed)
    if (!selections.ok) return selections
    const dormantSelections = parseV2ExportDormantSelections(parsed)
    if (!dormantSelections.ok) return dormantSelections
    const restoredReviewState = parsed.reviewedSettingIds !== undefined
    const reviewed = restoredReviewState
      ? parseReviewedIds(parsed.reviewedSettingIds)
      : { ok: true as const, value: {} }
    if (!reviewed.ok) return reviewed

    return {
      ok: true,
      value: {
        state: {
          profile: profile.value,
          intent: intent.value,
          priorities: priorities.value,
          selections: selections.value,
          dormantSelections: dormantSelections.value,
          reviewed: reviewed.value,
        },
        importedSettingCount: Object.keys(selections.value).length,
        usedDefaultIntent,
        restoredReviewState,
        migratedFromVersion: null,
        notices: [],
      },
    }
  }

  if (schemaVersion === undefined || schemaVersion === LEGACY_STORAGE_VERSION) {
    return migrateLegacyExport(parsed)
  }

  return { ok: false, error: "The selected plan uses an unsupported schema version." }
}
