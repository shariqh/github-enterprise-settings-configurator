import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CopilotPlan,
  CurrentState,
  Deployment,
  LicenseStatus,
  LicensedProductId,
  PlanningScopeId,
  ProvisioningMethod,
  RepositoryVisibility,
} from "./types"

export const deploymentLabels = {
  dotcom: "GitHub Enterprise Cloud",
  residency: "GitHub Enterprise Cloud with data residency",
  ghes: "GitHub Enterprise Server 3.21",
} satisfies Record<Deployment, string>

export const basePlanLabels = {
  team: "GitHub Team",
  enterprise: "GitHub Enterprise",
  unknown: "Unknown — needs discovery",
} satisfies Record<BasePlan, string>

export const accountModelLabels = {
  personal: "Personal accounts",
  managed: "Enterprise Managed Users (EMU)",
  instance: "Instance accounts (GitHub Enterprise Server)",
  unknown: "Unknown — needs discovery",
} satisfies Record<AccountModel, string>

export const authenticationLabels = {
  github: "GitHub.com credentials",
  saml: "SAML SSO",
  oidc: "OIDC SSO",
  "built-in": "Built-in authentication",
  ldap: "LDAP",
  cas: "CAS",
  unknown: "Unknown — needs discovery",
} satisfies Record<AuthenticationMethod, string>

export const provisioningLabels = {
  none: "None",
  "scim-access": "SCIM for organization access",
  scim: "SCIM provisioning",
  jit: "Just-in-time provisioning",
  ldap: "LDAP sync",
  "first-sign-in": "First sign-in provisioning",
  manual: "Manual account creation",
  unknown: "Unknown — needs discovery",
} satisfies Record<ProvisioningMethod, string>

export const repositoryVisibilityLabels = {
  public: "Public",
  "private-internal": "Private and internal only",
  mixed: "Public, private, and internal",
  unknown: "Unknown — needs discovery",
} satisfies Record<RepositoryVisibility, string>

export const currentStateLabels = {
  greenfield: "Greenfield",
  existing: "Existing environment",
  migration: "Migration in progress",
  unknown: "Unknown — needs discovery",
} satisfies Record<CurrentState, string>

export const licenseStatusLabels = {
  unlicensed: "Not licensed",
  licensed: "Licensed",
  unknown: "Unknown — needs discovery",
} satisfies Record<LicenseStatus, string>

export const copilotPlanLabels = {
  none: "None",
  business: "Copilot Business",
  enterprise: "Copilot Enterprise",
  unknown: "Unknown — needs discovery",
} satisfies Record<CopilotPlan, string>

export const licensedProductLabels = {
  secretProtection: "Secret Protection",
  codeSecurity: "Code Security",
  codeQuality: "Code Quality",
} satisfies Record<LicensedProductId, string>

export const planningScopeLabels = {
  actions: "GitHub Actions",
  audit: "Audit log visibility",
} satisfies Record<PlanningScopeId, string>

export const licensedProductOrder: LicensedProductId[] = [
  "secretProtection",
  "codeSecurity",
  "codeQuality",
]

export const planningScopeOrder: PlanningScopeId[] = ["actions", "audit"]
