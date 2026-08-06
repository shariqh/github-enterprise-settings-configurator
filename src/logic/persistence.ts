import { catalog, priorityOptions } from "../catalog"
import { defaultIntent } from "./intent"
import type {
  CurrentState,
  Entitlement,
  IdentityModel,
  IntentLevel,
  PlanIntent,
  Platform,
  PriorityId,
  ProductId,
  Profile,
} from "../types"

const STORAGE_KEY = "github-enterprise-settings-configurator.plan.v1"
const STORAGE_VERSION = 1

export interface PersistentPlanState {
  profile: Profile
  intent: PlanIntent
  priorities: PriorityId[]
  selections: Record<string, string>
  reviewed: Record<string, boolean>
}

interface CachedPlanEnvelope {
  version: number
  savedAt: string
  state: PersistentPlanState
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

export interface ImportedPlan {
  state: PersistentPlanState
  importedSettingCount: number
  usedDefaultIntent: boolean
  restoredReviewState: boolean
}

const platforms = new Set<Platform>(["dotcom", "residency", "ghes"])
const identityModels = new Set<IdentityModel>(["personal", "emu"])
const entitlements = new Set<Entitlement>(["enterprise", "copilot"])
const currentStates = new Set<CurrentState>(["greenfield", "existing", "migration", "unknown"])
const products: ProductId[] = ["actions", "security", "copilot", "audit"]
const priorityIds = new Set<PriorityId>(priorityOptions.map((priority) => priority.id))
const catalogById = new Map(catalog.map((setting) => [setting.id, setting]))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const parseProfile = (value: unknown): StorageResult<Profile> => {
  if (!isRecord(value)) return { ok: false, error: "The plan profile is missing or malformed." }

  const { platform, identity, entitlement, currentState, products: productValues } = value
  if (typeof platform !== "string" || !platforms.has(platform as Platform)) {
    return { ok: false, error: "The plan has an unsupported platform value." }
  }
  if (typeof identity !== "string" || !identityModels.has(identity as IdentityModel)) {
    return { ok: false, error: "The plan has an unsupported identity value." }
  }
  if (typeof entitlement !== "string" || !entitlements.has(entitlement as Entitlement)) {
    return { ok: false, error: "The plan has an unsupported entitlement value." }
  }
  if (typeof currentState !== "string" || !currentStates.has(currentState as CurrentState)) {
    return { ok: false, error: "The plan has an unsupported current-state value." }
  }
  if (!isRecord(productValues)) {
    return { ok: false, error: "The plan product selection is missing or malformed." }
  }

  const parsedProducts = {} as Record<ProductId, boolean>
  for (const product of products) {
    if (typeof productValues[product] !== "boolean") {
      return { ok: false, error: `The plan is missing a valid ${product} product selection.` }
    }
    parsedProducts[product] = productValues[product]
  }

  return {
    ok: true,
    value: {
      platform: platform as Platform,
      identity: identity as IdentityModel,
      entitlement: entitlement as Entitlement,
      currentState: currentState as CurrentState,
      products: parsedProducts,
    },
  }
}

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

const parsePersistentState = (value: unknown): StorageResult<PersistentPlanState> => {
  if (!isRecord(value)) return { ok: false, error: "The saved plan is malformed." }

  const profile = parseProfile(value.profile)
  if (!profile.ok) return profile
  const intent = parseIntent(value.intent)
  if (!intent.ok) return intent
  const priorities = parsePriorities(value.priorities)
  if (!priorities.ok) return priorities
  const selections = parseSelectionRecord(value.selections)
  if (!selections.ok) return selections
  const reviewed = parseReviewedRecord(value.reviewed)
  if (!reviewed.ok) return reviewed

  return {
    ok: true,
    value: {
      profile: profile.value,
      intent: intent.value,
      priorities: priorities.value,
      selections: selections.value,
      reviewed: reviewed.value,
    },
  }
}

export const readCachedPlan = (): StorageResult<PersistentPlanState | null> => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { ok: true, value: null }

    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      return { ok: false, error: "The local draft uses an unsupported cache version." }
    }
    const state = parsePersistentState(parsed.state)
    if (!state.ok) return { ok: false, error: `The local draft could not be restored. ${state.error}` }
    return state
  } catch (error) {
    return { ok: false, error: `The local draft could not be read. ${errorMessage(error)}` }
  }
}

export const saveCachedPlan = (state: PersistentPlanState): StorageResult<null> => {
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
    return { ok: true, value: null }
  } catch (error) {
    return { ok: false, error: `The local draft could not be cleared. ${errorMessage(error)}` }
  }
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
    if (parsed.version !== STORAGE_VERSION) {
      return { ok: false, error: "The selected cached plan uses an unsupported version." }
    }
    const state = parsePersistentState(parsed.state)
    if (!state.ok) return state
    return {
      ok: true,
      value: {
        state: state.value,
        importedSettingCount: Object.keys(state.value.selections).length,
        usedDefaultIntent: false,
        restoredReviewState: true,
      },
    }
  }

  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== STORAGE_VERSION) {
    return { ok: false, error: "The selected plan uses an unsupported schema version." }
  }

  const profile = parseProfile(parsed.profile)
  if (!profile.ok) return profile
  const usedDefaultIntent = parsed.intent === undefined
  const intent = usedDefaultIntent
    ? { ok: true as const, value: { ...defaultIntent } }
    : parseIntent(parsed.intent)
  if (!intent.ok) return intent
  const priorities = parsePriorities(parsed.priorities ?? [])
  if (!priorities.ok) return priorities
  const selections = "selections" in parsed
    ? parseSelectionRecord(parsed.selections)
    : parseExportedSettings(parsed.settings)
  if (!selections.ok) return selections
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
        reviewed: reviewed.value,
      },
      importedSettingCount: Object.keys(selections.value).length,
      usedDefaultIntent,
      restoredReviewState,
    },
  }
}
