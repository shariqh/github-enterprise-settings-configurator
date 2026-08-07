import { defaultIntent } from "./intent"
import { identityCompatibilityMatrix } from "./capabilities"
import type {
  MigrationNotice,
  PlanDraftState,
  PriorityId,
  Profile,
  Setting,
} from "../types"

export const defaultProfile: Profile = {
  deployment: "dotcom",
  basePlan: "enterprise",
  accountModel: "personal",
  authentication: "github",
  provisioning: "none",
  repositoryVisibility: "mixed",
  currentState: "greenfield",
  licensedProducts: {
    secretProtection: "unlicensed",
    codeSecurity: "unlicensed",
    codeQuality: "unlicensed",
    copilot: "none",
  },
  planningScope: {
    actions: true,
    audit: true,
  },
}

export const defaultPriorities: PriorityId[] = ["secure-ghec"]

export const createDefaultPlanDraft = (): PlanDraftState => ({
  profile: {
    ...defaultProfile,
    licensedProducts: { ...defaultProfile.licensedProducts },
    planningScope: { ...defaultProfile.planningScope },
  },
  intent: { ...defaultIntent },
  priorities: [...defaultPriorities],
  selections: {},
  dormantSelections: {},
  reviewed: {},
})

export interface ProfileTransition {
  profile: Profile
  notices: MigrationNotice[]
}

const identityKeys = [
  "deployment",
  "basePlan",
  "accountModel",
  "authentication",
  "provisioning",
] as const

type IdentityKey = typeof identityKeys[number]

const chooseIdentity = (
  current: Profile,
  requested: Profile,
  patch: Partial<Profile>,
): Pick<Profile, "deployment" | "basePlan" | "accountModel" | "authentication" | "provisioning"> => {
  const patchedIdentityKeys = new Set<IdentityKey>(
    identityKeys.filter((key) => Object.hasOwn(patch, key)),
  )
  let candidates = identityCompatibilityMatrix.filter((combination) =>
    [...patchedIdentityKeys].every((key) => combination[key] === requested[key]))

  if (candidates.length === 0) {
    candidates = identityCompatibilityMatrix.filter((combination) =>
      combination.deployment === requested.deployment
      && (
        requested.basePlan === "unknown"
        || combination.basePlan === requested.basePlan
      ))
  }
  if (candidates.length === 0) candidates = identityCompatibilityMatrix

  const selected = [...candidates].sort((left, right) => {
    const score = (candidate: typeof left): number =>
      identityKeys.reduce((total, key) => total + (candidate[key] === current[key] ? 1 : 0), 0)
    return score(right) - score(left)
  })[0]

  return {
    deployment: selected.deployment,
    basePlan: selected.basePlan,
    accountModel: selected.accountModel,
    authentication: selected.authentication,
    provisioning: selected.provisioning,
  }
}

export function transitionProfile(
  current: Profile,
  patch: Partial<Profile>,
): ProfileTransition {
  const requested: Profile = {
    ...current,
    ...patch,
    licensedProducts: {
      ...current.licensedProducts,
      ...patch.licensedProducts,
    },
    planningScope: {
      ...current.planningScope,
      ...patch.planningScope,
    },
  }
  const identity = chooseIdentity(current, requested, patch)
  const notices: MigrationNotice[] = []
  const profile: Profile = { ...requested, ...identity }

  if (
    profile.deployment === "residency"
    && profile.repositoryVisibility !== "private-internal"
  ) {
    profile.repositoryVisibility = "private-internal"
    notices.push({
      code: "residency-visibility-reset",
      message: "Repository visibility was changed to private/internal because GHE.com does not support public repositories.",
    })
  }

  if (profile.deployment === "ghes") {
    if (profile.licensedProducts.copilot !== "none") {
      profile.licensedProducts.copilot = "none"
      notices.push({
        code: "ghes-copilot-reset",
        message: "Copilot was removed because it is not available for GHES.",
      })
    }
    if (profile.licensedProducts.codeQuality !== "unlicensed") {
      profile.licensedProducts.codeQuality = "unlicensed"
      notices.push({
        code: "ghes-code-quality-reset",
        message: "Code Quality was removed because it is not available for GHES at launch.",
      })
    }
  }

  if (profile.deployment === "residency" && profile.licensedProducts.codeQuality === "licensed") {
    profile.licensedProducts.codeQuality = "unlicensed"
    notices.push({
      code: "residency-code-quality-reset",
      message: "Code Quality was removed because GitHub has not documented availability for GHE.com data residency.",
    })
  }

  if (profile.basePlan === "team" && profile.licensedProducts.copilot === "enterprise") {
    profile.licensedProducts.copilot = "none"
    notices.push({
      code: "team-copilot-reset",
      message: "Copilot Enterprise was removed because it requires GitHub Enterprise Cloud.",
    })
  }

  if (
    profile.licensedProducts.codeQuality === "licensed"
    && !profile.planningScope.actions
  ) {
    profile.planningScope.actions = true
    notices.push({
      code: "code-quality-actions-enabled",
      message: "GitHub Actions was included because Code Quality requires Actions for CodeQL analysis.",
    })
  }

  return { profile, notices }
}

export interface ReconciledDecisionState {
  selections: Record<string, string>
  dormantSelections: Record<string, string>
  reviewed: Record<string, boolean>
  notices: MigrationNotice[]
}

export function reconcileDecisionState(
  state: Pick<PlanDraftState, "selections" | "dormantSelections" | "reviewed">,
  applicableSettings: Setting[],
): ReconciledDecisionState {
  const selections = { ...state.selections }
  const dormantSelections = { ...state.dormantSelections }
  const reviewed = { ...state.reviewed }
  const notices: MigrationNotice[] = []
  const applicableById = new Map(applicableSettings.map((setting) => [setting.id, setting]))

  for (const [settingId, choiceId] of Object.entries(selections)) {
    const setting = applicableById.get(settingId)
    if (setting?.choices.some((choice) => choice.id === choiceId)) continue
    dormantSelections[settingId] = choiceId
    delete selections[settingId]
    delete reviewed[settingId]
    notices.push({
      code: `dormant-${settingId}`,
      message: `${settingId} was preserved as a dormant choice because it is not applicable to the current profile.`,
    })
  }

  for (const [settingId, choiceId] of Object.entries(dormantSelections)) {
    const setting = applicableById.get(settingId)
    if (!setting?.choices.some((choice) => choice.id === choiceId)) continue
    selections[settingId] = choiceId
    delete dormantSelections[settingId]
    delete reviewed[settingId]
    notices.push({
      code: `restored-${settingId}`,
      message: `${settingId} was restored from a dormant choice and must be reviewed again.`,
    })
  }

  for (const settingId of Object.keys(reviewed)) {
    if (!applicableById.has(settingId) || reviewed[settingId] !== true) {
      delete reviewed[settingId]
    }
  }

  return { selections, dormantSelections, reviewed, notices }
}
