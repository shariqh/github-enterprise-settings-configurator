export type Deployment = "dotcom" | "residency" | "ghes"
export type BasePlan = "team" | "enterprise" | "unknown"
export type AccountModel = "personal" | "managed" | "instance" | "unknown"
export type AuthenticationMethod =
  | "github"
  | "saml"
  | "oidc"
  | "built-in"
  | "ldap"
  | "cas"
  | "unknown"
export type ProvisioningMethod =
  | "none"
  | "scim-access"
  | "scim"
  | "jit"
  | "ldap"
  | "first-sign-in"
  | "manual"
  | "unknown"
export type RepositoryVisibility = "public" | "private-internal" | "mixed" | "unknown"
export type LicenseStatus = "unlicensed" | "licensed" | "unknown"
export type CopilotPlan = "none" | "business" | "enterprise" | "unknown"
export type CurrentState = "greenfield" | "existing" | "migration" | "unknown"
export type PriorityId =
  | "secure-ghec"
  | "emu-entra"
  | "regulated-overlay"
  | "copilot-cost"
  | "security-rollout"
  | "migration-ready"

export type LicensedProductId = "secretProtection" | "codeSecurity" | "codeQuality"
export type PlanningScopeId = "actions" | "audit"
export type IntentLevel = 0 | 1 | 2
export type IntentAxis = "guardrailStrength" | "rolloutPace" | "operationalCapacity"
export type Domain =
  | "Identity & administration"
  | "Organization & repository governance"
  | "Code security"
  | "Code quality"
  | "Actions & supply chain"
  | "Audit visibility"
  | "Copilot governance"
  | "Copilot cost controls"

export type CapabilityId =
  | "enterprise-account"
  | "internal-repositories"
  | "managed-users"
  | "personal-accounts"
  | "instance-accounts"
  | "enterprise-saml"
  | "oidc"
  | "scim"
  | "scim-access"
  | "jit-provisioning"
  | "ldap-lifecycle"
  | "ghes-scim-preview"
  | "actions"
  | "actions-planning"
  | "organization-audit"
  | "enterprise-audit"
  | "audit-planning"
  | "dependency-graph"
  | "dependabot-alerts"
  | "public-repository-security"
  | "secret-scanning"
  | "secret-protection"
  | "code-scanning"
  | "code-security"
  | "code-quality"
  | "copilot-business"
  | "copilot-enterprise"

export type SourceTier =
  | "GitHub Docs · mechanics"
  | "Well-Architected · principles"
  | "Worked example · adaptable"
  | "Automation adapter · execution"

export interface Source {
  label: string
  tier: SourceTier
  url: string
}

export interface CapabilityRequirement {
  allOf?: CapabilityId[]
  anyOf?: CapabilityId[]
  noneOf?: CapabilityId[]
}

export interface Choice {
  id: string
  label: string
  description: string
  availability?: CapabilityRequirement
}

export interface LicensedProducts {
  secretProtection: LicenseStatus
  codeSecurity: LicenseStatus
  codeQuality: LicenseStatus
  copilot: CopilotPlan
}

export interface PlanningScope {
  actions: boolean
  audit: boolean
}

export interface Profile {
  deployment: Deployment
  basePlan: BasePlan
  accountModel: AccountModel
  authentication: AuthenticationMethod
  provisioning: ProvisioningMethod
  repositoryVisibility: RepositoryVisibility
  currentState: CurrentState
  licensedProducts: LicensedProducts
  planningScope: PlanningScope
}

export interface PlanIntent {
  guardrailStrength: IntentLevel
  rolloutPace: IntentLevel
  operationalCapacity: IntentLevel
}

export interface Setting {
  id: string
  domain: Domain
  title: string
  prompt: string
  choices: Choice[]
  recommended: string
  editable?: boolean
  availability?: CapabilityRequirement
  rationale: string
  tradeoff: string
  prerequisites: string
  consequences: string
  scope: string
  role: string
  applyMethod: string
  influence: "Protective" | "Enabling" | "Guardrail"
  foundational?: boolean
  postureWeight?: 0 | 1 | 2 | 3
  effortByChoice?: Record<string, number>
  rolloutBand: "Low" | "Moderate" | "High"
  ongoingBand: "Low" | "Moderate" | "High"
  sources: Source[]
}

export interface Plan {
  profile: Profile
  intent: PlanIntent
  priorities: PriorityId[]
  selections: Record<string, string>
}

export interface RecommendedSetting {
  setting: Setting
  recommended: string
  selected: string
  disposition: "Recommended" | "Override"
}

export interface ProfileIssue {
  code: string
  message: string
  field?: keyof Profile | `licensedProducts.${keyof LicensedProducts}`
}

export interface ProfileOption<T extends string> {
  value: T
  available: boolean
  reason?: string
}

export interface ProfileOptions {
  basePlan: ProfileOption<BasePlan>[]
  accountModel: ProfileOption<AccountModel>[]
  authentication: ProfileOption<AuthenticationMethod>[]
  provisioning: ProfileOption<ProvisioningMethod>[]
  repositoryVisibility: ProfileOption<RepositoryVisibility>[]
  copilot: ProfileOption<CopilotPlan>[]
  licensedProducts: Record<LicensedProductId, ProfileOption<LicenseStatus>[]>
}

export interface ResolvedProfile {
  profile: Profile
  capabilities: ReadonlySet<CapabilityId>
  errors: ProfileIssue[]
  warnings: ProfileIssue[]
  options: ProfileOptions
}

export interface ResolvedPlan {
  plan: Plan
  profile: ResolvedProfile
  settings: RecommendedSetting[]
  reviewableSettingIds: string[]
  reviewedSettingIds: string[]
}

export interface PlanDraftState {
  profile: Profile
  intent: PlanIntent
  priorities: PriorityId[]
  selections: Record<string, string>
  dormantSelections: Record<string, string>
  reviewed: Record<string, boolean>
}

export interface MigrationNotice {
  code: string
  message: string
}
