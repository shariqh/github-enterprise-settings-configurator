import type {
  AccountModel,
  AuthenticationMethod,
  BasePlan,
  CapabilityId,
  CapabilityRequirement,
  CopilotPlan,
  Deployment,
  LicenseStatus,
  LicensedProductId,
  Profile,
  ProfileIssue,
  ProfileOption,
  ProfileOptions,
  ProvisioningMethod,
  RepositoryVisibility,
  ResolvedProfile,
} from "../types"

export const deployments: Deployment[] = ["dotcom", "residency", "ghes"]
export const basePlans: BasePlan[] = ["team", "enterprise", "unknown"]
export const accountModels: AccountModel[] = ["personal", "managed", "instance", "unknown"]
export const authenticationMethods: AuthenticationMethod[] = [
  "github",
  "saml",
  "oidc",
  "built-in",
  "ldap",
  "cas",
  "unknown",
]
export const provisioningMethods: ProvisioningMethod[] = [
  "none",
  "scim-access",
  "scim",
  "jit",
  "ldap",
  "first-sign-in",
  "manual",
  "unknown",
]
export const repositoryVisibilities: RepositoryVisibility[] = [
  "public",
  "private-internal",
  "mixed",
  "unknown",
]
export const licenseStatuses: LicenseStatus[] = ["unlicensed", "licensed", "unknown"]
export const copilotPlans: CopilotPlan[] = ["none", "business", "enterprise", "unknown"]

interface IdentityCompatibility {
  deployment: Deployment
  basePlan: Exclude<BasePlan, "unknown">
  accountModel: Exclude<AccountModel, "unknown">
  authentication: Exclude<AuthenticationMethod, "unknown">
  provisioning: Exclude<ProvisioningMethod, "unknown">
}

export const identityCompatibilityMatrix: IdentityCompatibility[] = [
  {
    deployment: "dotcom",
    basePlan: "team",
    accountModel: "personal",
    authentication: "github",
    provisioning: "none",
  },
  {
    deployment: "dotcom",
    basePlan: "enterprise",
    accountModel: "personal",
    authentication: "github",
    provisioning: "none",
  },
  {
    deployment: "dotcom",
    basePlan: "enterprise",
    accountModel: "personal",
    authentication: "saml",
    provisioning: "none",
  },
  {
    deployment: "dotcom",
    basePlan: "enterprise",
    accountModel: "personal",
    authentication: "saml",
    provisioning: "scim-access",
  },
  {
    deployment: "dotcom",
    basePlan: "enterprise",
    accountModel: "managed",
    authentication: "saml",
    provisioning: "scim",
  },
  {
    deployment: "dotcom",
    basePlan: "enterprise",
    accountModel: "managed",
    authentication: "oidc",
    provisioning: "scim",
  },
  {
    deployment: "residency",
    basePlan: "enterprise",
    accountModel: "managed",
    authentication: "saml",
    provisioning: "scim",
  },
  {
    deployment: "residency",
    basePlan: "enterprise",
    accountModel: "managed",
    authentication: "oidc",
    provisioning: "scim",
  },
  {
    deployment: "ghes",
    basePlan: "enterprise",
    accountModel: "instance",
    authentication: "built-in",
    provisioning: "manual",
  },
  {
    deployment: "ghes",
    basePlan: "enterprise",
    accountModel: "instance",
    authentication: "saml",
    provisioning: "jit",
  },
  {
    deployment: "ghes",
    basePlan: "enterprise",
    accountModel: "instance",
    authentication: "saml",
    provisioning: "scim",
  },
  {
    deployment: "ghes",
    basePlan: "enterprise",
    accountModel: "instance",
    authentication: "ldap",
    provisioning: "ldap",
  },
  {
    deployment: "ghes",
    basePlan: "enterprise",
    accountModel: "instance",
    authentication: "cas",
    provisioning: "first-sign-in",
  },
]

const unknownIssue = (
  field: ProfileIssue["field"],
  label: string,
): ProfileIssue => ({
  code: `unknown-${String(field).replace(".", "-")}`,
  field,
  message: `${label} is unresolved. Choose a supported value before building or exporting the plan.`,
})

const identityMatches = (profile: Profile): boolean =>
  identityCompatibilityMatrix.some((combination) =>
    combination.deployment === profile.deployment
    && combination.basePlan === profile.basePlan
    && combination.accountModel === profile.accountModel
    && combination.authentication === profile.authentication
    && combination.provisioning === profile.provisioning)

const licenseSupported = (
  product: LicensedProductId,
  profile: Profile,
): boolean => {
  if (profile.basePlan === "unknown") return false
  if (product === "codeQuality") {
    return profile.deployment === "dotcom" && profile.planningScope.actions
  }
  return profile.basePlan === "team" || profile.basePlan === "enterprise"
}

const copilotSupported = (plan: CopilotPlan, profile: Profile): boolean => {
  if (plan === "none") return true
  if (plan === "unknown" || profile.deployment === "ghes" || profile.basePlan === "unknown") {
    return false
  }
  if (plan === "enterprise") {
    return profile.basePlan === "enterprise"
      && (profile.deployment === "dotcom" || profile.deployment === "residency")
  }
  return profile.deployment === "dotcom" || profile.deployment === "residency"
}

export function getProfileErrors(profile: Profile): ProfileIssue[] {
  const errors: ProfileIssue[] = []
  if (profile.basePlan === "unknown") errors.push(unknownIssue("basePlan", "Base plan"))
  if (profile.accountModel === "unknown") errors.push(unknownIssue("accountModel", "Account model"))
  if (profile.authentication === "unknown") {
    errors.push(unknownIssue("authentication", "Authentication method"))
  }
  if (profile.provisioning === "unknown") {
    errors.push(unknownIssue("provisioning", "Provisioning method"))
  }
  if (profile.repositoryVisibility === "unknown") {
    errors.push(unknownIssue("repositoryVisibility", "Repository visibility"))
  }

  if (
    profile.basePlan !== "unknown"
    && profile.accountModel !== "unknown"
    && profile.authentication !== "unknown"
    && profile.provisioning !== "unknown"
    && !identityMatches(profile)
  ) {
    errors.push({
      code: "incompatible-identity",
      field: "accountModel",
      message: "The selected account, authentication, and provisioning methods are not supported for this deployment and base plan.",
    })
  }

  if (
    profile.repositoryVisibility !== "unknown"
    && profile.deployment === "residency"
    && profile.repositoryVisibility !== "private-internal"
  ) {
    errors.push({
      code: "residency-public-repositories",
      field: "repositoryVisibility",
      message: "GHE.com data residency uses managed users and does not support public repositories.",
    })
  }

  for (const product of ["secretProtection", "codeSecurity", "codeQuality"] as LicensedProductId[]) {
    const status = profile.licensedProducts[product]
    if (status === "unknown") {
      errors.push(unknownIssue(`licensedProducts.${product}`, `${product} license status`))
    } else if (status === "licensed" && !licenseSupported(product, profile)) {
      errors.push({
        code: `unsupported-${product}`,
        field: `licensedProducts.${product}`,
        message: product === "codeQuality"
          ? "GitHub Code Quality is supported for GitHub.com Team or Enterprise Cloud plans and requires GitHub Actions; GHE.com availability is not yet documented and GHES is unsupported at launch."
          : `${product} requires a GitHub Team or Enterprise base plan.`,
      })
    }
  }

  if (profile.licensedProducts.copilot === "unknown") {
    errors.push(unknownIssue("licensedProducts.copilot", "Copilot plan"))
  } else if (!copilotSupported(profile.licensedProducts.copilot, profile)) {
    errors.push({
      code: "unsupported-copilot",
      field: "licensedProducts.copilot",
      message: profile.deployment === "ghes"
        ? "GitHub Copilot is not available for GitHub Enterprise Server."
        : "The selected Copilot plan is not supported by this deployment and base plan.",
    })
  }

  return errors
}

export function getProfileWarnings(profile: Profile): ProfileIssue[] {
  const warnings: ProfileIssue[] = []
  if (profile.deployment === "ghes" && profile.authentication === "saml" && profile.provisioning === "scim") {
    warnings.push({
      code: "ghes-scim-preview",
      field: "provisioning",
      message: "SCIM provisioning for GHES 3.21 is a public preview and requires SAML authentication.",
    })
  }
  if (profile.basePlan === "team" && profile.licensedProducts.copilot === "business") {
    warnings.push({
      code: "team-copilot-signup",
      field: "licensedProducts.copilot",
      message: "New self-service Copilot Business sign-ups for Team organizations are paused; confirm an existing or sales-assisted subscription.",
    })
  }
  return warnings
}

export function resolveCapabilities(profile: Profile): ReadonlySet<CapabilityId> {
  const capabilities = new Set<CapabilityId>([
    "actions",
    "organization-audit",
    "dependency-graph",
    "dependabot-alerts",
  ])

  if (profile.basePlan === "enterprise") {
    capabilities.add("enterprise-account")
    capabilities.add("internal-repositories")
    capabilities.add("enterprise-audit")
  }
  if (profile.accountModel === "personal") capabilities.add("personal-accounts")
  if (profile.accountModel === "managed") capabilities.add("managed-users")
  if (profile.accountModel === "instance") capabilities.add("instance-accounts")
  if (profile.authentication === "saml") capabilities.add("enterprise-saml")
  if (profile.authentication === "oidc") capabilities.add("oidc")
  if (profile.provisioning === "scim") capabilities.add("scim")
  if (profile.provisioning === "scim-access") capabilities.add("scim-access")
  if (profile.provisioning === "jit") capabilities.add("jit-provisioning")
  if (profile.provisioning === "ldap") capabilities.add("ldap-lifecycle")
  if (profile.deployment === "ghes" && profile.provisioning === "scim") {
    capabilities.add("ghes-scim-preview")
  }
  if (profile.planningScope.actions) capabilities.add("actions-planning")
  if (profile.planningScope.audit) capabilities.add("audit-planning")

  const hasPublicRepositories = profile.deployment === "dotcom"
    && (profile.repositoryVisibility === "public" || profile.repositoryVisibility === "mixed")
  if (hasPublicRepositories) capabilities.add("public-repository-security")

  if (hasPublicRepositories || profile.licensedProducts.secretProtection === "licensed") {
    capabilities.add("secret-scanning")
  }
  if (profile.licensedProducts.secretProtection === "licensed") {
    capabilities.add("secret-protection")
  }
  if (hasPublicRepositories || profile.licensedProducts.codeSecurity === "licensed") {
    capabilities.add("code-scanning")
  }
  if (profile.licensedProducts.codeSecurity === "licensed") {
    capabilities.add("code-security")
  }
  if (
    profile.licensedProducts.codeQuality === "licensed"
    && licenseSupported("codeQuality", profile)
  ) {
    capabilities.add("code-quality")
  }
  if (profile.licensedProducts.copilot === "business") capabilities.add("copilot-business")
  if (profile.licensedProducts.copilot === "enterprise") {
    capabilities.add("copilot-business")
    capabilities.add("copilot-enterprise")
  }

  return capabilities
}

export function meetsCapabilityRequirement(
  capabilities: ReadonlySet<CapabilityId>,
  requirement?: CapabilityRequirement,
): boolean {
  if (!requirement) return true
  if (requirement.allOf?.some((capability) => !capabilities.has(capability))) return false
  if (requirement.anyOf && !requirement.anyOf.some((capability) => capabilities.has(capability))) {
    return false
  }
  return !requirement.noneOf?.some((capability) => capabilities.has(capability))
}

const reasonForUnavailable = (label: string): string =>
  `${label} is not compatible with the current deployment, base plan, or identity selections.`

const optionsFor = <T extends string>(
  values: T[],
  current: T,
  isAvailable: (value: T) => boolean,
  label: string,
): ProfileOption<T>[] =>
  values.map((value) => ({
    value,
    available: value === "unknown" ? current === value : isAvailable(value),
    reason: value === "unknown"
      ? "This migration placeholder must be resolved before export."
      : isAvailable(value) ? undefined : reasonForUnavailable(label),
  }))

function getProfileOptions(profile: Profile): ProfileOptions {
  const matching = (patch: Partial<IdentityCompatibility>): boolean =>
    identityCompatibilityMatrix.some((combination) =>
      combination.deployment === (patch.deployment ?? profile.deployment)
      && combination.basePlan === (patch.basePlan ?? profile.basePlan)
      && combination.accountModel === (patch.accountModel ?? profile.accountModel)
      && combination.authentication === (patch.authentication ?? profile.authentication)
      && combination.provisioning === (patch.provisioning ?? profile.provisioning))

  const statusOptions = (product: LicensedProductId): ProfileOption<LicenseStatus>[] =>
    optionsFor(licenseStatuses, profile.licensedProducts[product], (status) =>
      status === "unlicensed" || licenseSupported(product, profile), product)

  return {
    basePlan: optionsFor(basePlans, profile.basePlan, (basePlan) =>
      identityCompatibilityMatrix.some((combination) =>
        combination.deployment === profile.deployment && combination.basePlan === basePlan), "base plan"),
    accountModel: optionsFor(accountModels, profile.accountModel, (accountModel) =>
      matching({ accountModel: accountModel as Exclude<AccountModel, "unknown"> }), "account model"),
    authentication: optionsFor(authenticationMethods, profile.authentication, (authentication) =>
      matching({ authentication: authentication as Exclude<AuthenticationMethod, "unknown"> }), "authentication method"),
    provisioning: optionsFor(provisioningMethods, profile.provisioning, (provisioning) =>
      matching({ provisioning: provisioning as Exclude<ProvisioningMethod, "unknown"> }), "provisioning method"),
    repositoryVisibility: optionsFor(
      repositoryVisibilities,
      profile.repositoryVisibility,
      (visibility) => profile.deployment !== "residency" || visibility === "private-internal",
      "repository visibility",
    ),
    copilot: optionsFor(
      copilotPlans,
      profile.licensedProducts.copilot,
      (plan) => copilotSupported(plan, profile),
      "Copilot plan",
    ),
    licensedProducts: {
      secretProtection: statusOptions("secretProtection"),
      codeSecurity: statusOptions("codeSecurity"),
      codeQuality: statusOptions("codeQuality"),
    },
  }
}

export function resolveProfile(profile: Profile): ResolvedProfile {
  return {
    profile,
    capabilities: resolveCapabilities(profile),
    errors: getProfileErrors(profile),
    warnings: getProfileWarnings(profile),
    options: getProfileOptions(profile),
  }
}

export const isProfileValid = (profile: Profile): boolean => getProfileErrors(profile).length === 0
