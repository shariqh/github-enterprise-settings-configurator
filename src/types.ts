export type Platform = "dotcom" | "residency" | "ghes"
export type IdentityModel = "personal" | "emu"
export type Entitlement = "enterprise" | "copilot"
export type CurrentState = "greenfield" | "existing" | "migration" | "unknown"
export type PriorityId =
  | "secure-ghec"
  | "emu-entra"
  | "regulated-overlay"
  | "copilot-cost"
  | "security-rollout"
  | "migration-ready"

export type ProductId = "actions" | "security" | "copilot" | "audit"
export type Domain =
  | "Identity & administration"
  | "Organization & repository governance"
  | "Code security"
  | "Actions & supply chain"
  | "Audit visibility"
  | "Copilot governance"
  | "Copilot cost controls"

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

export interface Choice {
  id: string
  label: string
  description: string
}

export interface Profile {
  platform: Platform
  identity: IdentityModel
  entitlement: Entitlement
  currentState: CurrentState
  products: Record<ProductId, boolean>
}

export interface Setting {
  id: string
  domain: Domain
  title: string
  prompt: string
  choices: Choice[]
  recommended: string
  editable?: boolean
  applies: (profile: Profile) => boolean
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
  priorities: PriorityId[]
  selections: Record<string, string>
}

export interface RecommendedSetting {
  setting: Setting
  selected: string
  disposition: "Recommended" | "Override" | "Not applicable"
}
