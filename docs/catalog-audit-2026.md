# 2026 GitHub product and catalog audit

Verified: **2026-08-07**

This ledger records the evidence behind issue #10. It distinguishes product
facts from catalog recommendations and does not infer support from a feature's
absence on an exceptions list.

## Evidence rules

- **Supported** means an authoritative source explicitly names the deployment
  or plan as supported.
- **Unsupported** means an authoritative source explicitly names the deployment
  or plan as unavailable.
- **Not documented** means the reviewed authoritative sources do not make a
  feature-specific support or exclusion statement.
- GitHub Docs describe mechanics. GitHub Well-Architected guidance informs
  recommendations. Changelog entries establish release and deprecation timing.
- API mappings are automation evidence only. They do not make this static
  configurator a direct-apply tool.

## Code Quality on GHE.com Data Residency

**Disposition: not documented as of 2026-08-07.**

The evidence supports three explicit classifications:

| Deployment or plan | Status | Exact evidence |
| --- | --- | --- |
| GitHub Enterprise Cloud | Supported | The [GA announcement](https://github.blog/changelog/2026-07-20-github-code-quality-is-now-generally-available) says Code Quality is generally available on GitHub Enterprise Cloud. |
| GitHub Team | Supported | The same GA announcement explicitly names GitHub Team. |
| GitHub Enterprise Server, including 3.21 | Unsupported at launch | The same GA announcement says Code Quality "isn't available on GitHub Enterprise Server at launch." |
| GHE.com Data Residency | Not documented | The GA announcement does not name GHE.com or Data Residency. The [GHE.com feature overview](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/feature-overview-for-github-enterprise-cloud-with-data-residency) does not list Code Quality as unavailable, but absence from that list is not a feature-specific support statement. |

Two general data-residency statements provide context but do not change the
classification:

- [About GHE.com Data Residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/about-github-enterprise-cloud-with-data-residency)
  says GitHub Enterprise Cloud can be hosted on GHE.com and that, in general,
  the Enterprise Cloud documentation reflects GHE.com.
- The [feature overview](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/feature-overview-for-github-enterprise-cloud-with-data-residency)
  says GHE.com is similar to managed-user enterprises on GitHub.com with listed
  additions and exceptions.

Neither page explicitly names Code Quality. The catalog must therefore keep
GHE.com Code Quality availability in an `unknown` or `not_documented` state
until GitHub publishes feature-specific confirmation or an authorized tenant
check establishes availability. It must not treat this as either supported or
unsupported.

## Existing catalog settings

### Identity and administration

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `enterprise-type` | GitHub Enterprise supports GHEC on GitHub.com, GHE.com Data Residency, and GHES. GHE.com requires managed users and has documented feature differences. | No public mutation for changing an existing enterprise's hosting model; this is an enterprise setup and migration decision. | **Update.** Add the GHE.com EMU dependency, current regions, feature exceptions, and GHES 3.21 lifecycle. | [About GHEC](https://docs.github.com/en/enterprise-cloud@latest/admin/overview/about-github-enterprise-cloud), [About GHE.com](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/about-github-enterprise-cloud-with-data-residency), [GHES releases](https://docs.github.com/en/enterprise-server@3.21/admin/all-releases) |
| `sso-scim` | GitHub.com personal-account enterprises use enterprise or organization SAML; organization SCIM provisions access. EMU uses SAML or OIDC plus SCIM. GHE.com requires EMU. GHES 3.21 supports instance authentication and has different provisioning behavior. | EMU SCIM: `https://api.github.com/scim/v2/enterprises/{enterprise}/`; setup user; classic PAT `scim:enterprise`, with `admin:enterprise` for read operations. GHE.com uses `https://api.SUBDOMAIN.ghe.com`. | **Split in #14.** Separate account model, authentication, and provisioning. Add EMU OIDC and Conditional Access support. | [Getting started with EMU](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/understanding-iam-for-enterprises/getting-started-with-enterprise-managed-users), [Configure EMU OIDC](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/configuring-authentication-for-enterprise-managed-users/configuring-oidc-for-enterprise-managed-users), [SCIM REST API](https://docs.github.com/en/enterprise-cloud@latest/rest/enterprise-admin/scim?apiVersion=2026-03-10), [GHES SAML](https://docs.github.com/en/enterprise-server@3.21/admin/managing-iam/understanding-iam-for-enterprises/about-saml-for-enterprise-iam) |
| `admin-redundancy` | Enterprise owners exist on GHEC and GHES. EMU enterprise owners and billing managers are added or removed through the identity provider. | No documented REST mutation for assigning enterprise owners; GraphQL can read enterprise membership and owner information. | **Update.** Keep the resilience decision, replace redirected sources, and make the apply method identity-aware. | [Invite enterprise administrators](https://docs.github.com/en/enterprise-cloud@latest/admin/managing-accounts-and-repositories/managing-users-in-your-enterprise/inviting-people-to-manage-your-enterprise) |
| `verified-domains` | Available at enterprise scope on GHEC and GHES 3.21. Domain approval is distinct from DNS-backed verification and is in public preview. | No documented REST or GraphQL mutation; configure in enterprise settings and DNS. | **Update.** Distinguish verification from approval and use deployment-specific sources. | [Verify or approve a domain on GHEC](https://docs.github.com/en/enterprise-cloud@latest/admin/configuring-settings/configuring-user-applications-for-your-enterprise/verifying-or-approving-a-domain-for-your-enterprise), [Verify or approve a domain on GHES 3.21](https://docs.github.com/en/enterprise-server@3.21/admin/configuring-settings/configuring-user-applications-for-your-enterprise/verifying-or-approving-a-domain-for-your-enterprise) |

### Organization and repository governance

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `default-repo-permission` | Organization base permissions are available across organization plans. Enterprise policy can enforce the allowed posture across organizations. | `PATCH /orgs/{org}` with `default_repository_permission`; organization owner; classic PAT/OAuth `admin:org` or `repo`, or corresponding fine-grained organization administration permission. | **Clarify scope.** Separate organization default from enterprise policy enforcement. | [Set organization base permissions](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/setting-base-permissions-for-an-organization), [Enterprise repository policies](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-repository-management-policies-in-your-enterprise), [Organizations REST API](https://docs.github.com/en/rest/orgs/orgs?apiVersion=2026-03-10#update-an-organization) |
| `member-repo-creation` | Organization-level control is available; enterprise policy can restrict organization choices. | `PATCH /orgs/{org}` using granular `members_can_create_public_repositories`, `members_can_create_private_repositories`, and `members_can_create_internal_repositories`; organization owner. `members_allowed_repository_creation_type` is closing down. | **Update.** Remove the deprecated aggregate API field from all apply guidance. | [Restrict repository creation](https://docs.github.com/en/organizations/managing-organization-settings/restricting-repository-creation-in-your-organization), [Organizations REST API](https://docs.github.com/en/rest/orgs/orgs?apiVersion=2026-03-10#update-an-organization) |
| `default-branch-ruleset` | Repository rulesets are available on Team and Enterprise; organization-wide multi-repository rulesets require Enterprise. GHES 3.21 supports organization rulesets. | `/repos/{owner}/{repo}/rulesets`, `/orgs/{org}/rulesets`, and effective branch rules endpoints; repository administration or organization administration permissions. | **Update.** Keep merge controls here; represent Code Quality and coverage rules in #12. Add delegated bypass and evaluate-mode evidence. | [About rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets), [Rules REST API](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10), [GHES 3.21 organization rulesets](https://docs.github.com/en/enterprise-server@3.21/organizations/managing-organization-settings/managing-rulesets-for-repositories-in-your-organization) |
| `outside-collaborators` | Available on organization plans. In EMU enterprises the role is named repository collaborator. Enterprise invitation policy can constrain organization behavior. | `GET/PUT/DELETE /orgs/{org}/outside_collaborators`; organization administration permission. | **Update.** Add EMU terminology and separate collaborator access from private-fork policy. | [Manage outside collaborators](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-outside-collaborators), [Outside collaborators REST API](https://docs.github.com/en/rest/orgs/outside-collaborators?apiVersion=2026-03-10) |

### Security and quality

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `security-configuration` | Security configurations are the current rollout mechanism. Enabled features have separate Secret Protection and Code Security license requirements for private/internal repositories. | Enterprise and organization `/code-security/configurations`, `/{id}/attach`, and `/{id}/defaults`; repository `GET /repos/{owner}/{repo}/code-security-configuration`; enterprise owner, organization owner, or security manager; organization Administration write permission. | **Update after #12.** Replace deprecated organization booleans, model `enforced` separately, and map rollout choices to attach scopes. | [Code security configurations REST API](https://docs.github.com/en/rest/code-security/configurations), [Security organization API deprecation](https://github.blog/changelog/2026-04-21-deprecation-of-security-related-organization-api-fields) |
| `secret-scanning` | Secret scanning and push protection for private/internal repositories belong to GitHub Secret Protection; public-repository availability differs. | Security configuration fields cover scanning, push protection, delegated bypass, validity checks, non-provider patterns, generic secrets, and dismissal. Organization owner or security manager. | **Update after #12.** Bind to Secret Protection and add delegated and AI-detected-secret controls without restoring a combined GHAS flag. | [Advanced Security products](https://docs.github.com/en/get-started/learning-about-github/about-github-advanced-security), [Code security configurations REST API](https://docs.github.com/en/rest/code-security/configurations) |
| `dependency-coverage` | Dependency graph and basic Dependabot capabilities are included independently of Code Security. Dependency review for private repositories and premium Dependabot capabilities require Code Security. GHE.com lacks dependency insights and dependency-graph license/package metadata. Dependabot malware alerts require GHES 3.22+, so they are unavailable on 3.21. | Configuration fields cover dependency graph, Dependabot alerts, updates, and delegated dismissal. Dependency review: `GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}` with repository read access. | **Split after #12/#15.** Keep included dependency visibility available without a paid security add-on. | [Dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review), [Dependency review REST API](https://docs.github.com/en/rest/dependency-graph/dependency-review?apiVersion=2026-03-10), [GHE.com feature overview](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/feature-overview-for-github-enterprise-cloud-with-data-residency), [Dependabot malware alerts](https://docs.github.com/en/code-security/concepts/supply-chain-security/malware-alerts) |

### Actions and supply chain

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `allowed-actions` | GHEC and GHES support enterprise/organization action policies. GHES access to GitHub.com actions and verified creators depends on GitHub Connect behavior. | `GET/PUT /orgs/{org}/actions/permissions` for `allowed_actions` and independent `sha_pinning_required`; selected-actions endpoint for GitHub-owned, verified, and patterns. Organization Actions policies write permission or `admin:org`. | **Split.** Keep allowed sources and full-SHA pinning as independent settings. | [Enterprise Actions policy on GHEC](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-github-actions-in-your-enterprise), [Enterprise Actions policy on GHES 3.21](https://docs.github.com/en/enterprise-server@3.21/admin/enforcing-policies/enforcing-policies-for-your-enterprise/enforcing-policies-for-github-actions-in-your-enterprise), [Actions permissions REST API](https://docs.github.com/en/rest/actions/permissions?apiVersion=2026-03-10) |
| `workflow-token` | GHEC and GHES expose read or write default workflow permissions. "Migration exceptions" are an operating strategy, not a native third state. | `GET/PUT /orgs/{org}/actions/permissions/workflow` with `default_workflow_permissions` and independent `can_approve_pull_request_reviews`; organization Actions policies write permission. | **Update and split.** Keep token default; add workflow PR approval as a separate control. | [Authenticate with GITHUB_TOKEN](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [Actions permissions REST API](https://docs.github.com/en/rest/actions/permissions?apiVersion=2026-03-10) |
| `runner-network` | GitHub-hosted runners are supported on GHEC. GHES 3.21 explicitly requires self-hosted runners. GHE.com lacks macOS hosted runners and has deployment-specific network endpoints. | Runner-group endpoints at organization and enterprise scope; `admin:org` or `manage_runners:enterprise`. | **Update after #11/#15.** Make GHES recommendation valid, split runner-group access from hosting, and record private networking separately. | [GitHub-hosted runners on GHES 3.21](https://docs.github.com/en/enterprise-server@3.21/actions/concepts/runners/github-hosted-runners), [Self-hosted runner groups REST API](https://docs.github.com/en/rest/actions/self-hosted-runner-groups?apiVersion=2026-03-10), [Private networking](https://docs.github.com/en/actions/concepts/runners/private-networking), [GHE.com network details](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/network-details-for-ghecom) |

### Audit visibility

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `audit-streaming` | GHEC supports audit streaming, pause/data continuity, multiple endpoints in preview, and S3 OIDC. GHES 3.21 supports streaming but documents performance impact and does not document the same pause or S3 OIDC behavior. GHE.com explicitly lacks S3 OIDC streaming. | Configure at enterprise scope. Destination credentials and permissions vary by provider; enterprise owner required. | **Update.** Record deployment-specific behavior and Copilot agent session/Purview preview without asserting parity. | [GHEC audit streaming](https://docs.github.com/en/enterprise-cloud@latest/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise), [GHES 3.21 audit streaming](https://docs.github.com/en/enterprise-server@3.21/admin/monitoring-activity-in-your-enterprise/reviewing-audit-logs-for-your-enterprise/streaming-the-audit-log-for-your-enterprise), [GHE.com feature overview](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/feature-overview-for-github-enterprise-cloud-with-data-residency) |

### Copilot governance

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `copilot-license-topology` | Copilot Business and Enterprise are cloud subscriptions. Copilot is not available on GHES. Direct enterprise assignment behavior differs by plan; EMU can use identity-provider-backed groups. | Copilot user-management REST APIs; enterprise owner or billing manager and Copilot user management permission. | **Update after #15.** Bind to explicit plan and deployment capabilities. | [Copilot plans](https://docs.github.com/en/copilot/get-started/plans), [Grant Copilot access](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/manage-access/grant-access) |
| `copilot-public-code` | Enterprise and organization policy uses the exact name "Suggestions matching public code." Policy conflict resolution can select the most restrictive value. | Enterprise or organization AI controls; no separate GraphQL mapping documented in this review. | **Keep and update terminology.** | [Manage enterprise Copilot policies](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/manage-enterprise-policies), [Policy conflicts](https://docs.github.com/en/copilot/reference/enterprise-administrators/policy-conflicts) |
| `copilot-content-exclusion` | Available for supported Copilot cloud deployments. Copilot CLI and agent mode in IDEs do not support content exclusion. | Configure exclusion at repository, organization, or enterprise scope as documented; role varies by scope. | **Keep, add limitation.** Do not present exclusion as a universal content boundary. | [Exclude content from Copilot](https://docs.github.com/en/copilot/how-tos/configure-content-exclusion/exclude-content-from-copilot) |
| `copilot-model-policy` | Enterprise AI controls cover Copilot, agents, and MCP. GHE.com offers a data-residency-compliant-model restriction with billing consequences. Copilot is unavailable on GHES. | Enterprise AI controls; enterprise owner. | **Update after #15.** Add GHE.com-specific model restriction and keep preview/new-model choices out of universal defaults. | [Manage enterprise Copilot policies](https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/manage-enterprise-policies), [Copilot with data residency](https://docs.github.com/en/enterprise-cloud@latest/admin/data-residency/github-copilot-with-data-residency) |
| `copilot-usage-metrics` | Metrics require a supported Copilot enterprise context and the usage-metrics policy. Metrics do not replace license/seat data. | `/enterprises/{enterprise}/copilot/metrics/reports/...`; enterprise owner, billing manager, or fine-grained "View Enterprise Copilot Metrics"; OAuth/PAT `manage_billing:copilot` or `read:enterprise` where documented. | **Keep and add exact permission mapping.** | [Copilot usage metrics](https://docs.github.com/en/copilot/concepts/copilot-usage-metrics/copilot-metrics), [Copilot metrics REST API](https://docs.github.com/en/rest/copilot/copilot-usage-metrics) |

### Copilot cost controls

| Setting | Deployment and plan evidence | API and permission mapping | Disposition | Authoritative sources |
| --- | --- | --- | --- | --- |
| `cost-center-mapping` | Cost centers are available on the current enterprise billing platform. An enterprise can create up to 1,000. Copilot attribution precedence is direct user, enterprise team, organization, then enterprise fallback. | Billing and cost-center APIs/settings; enterprise billing manager or enterprise owner. | **Terminology corrected.** User-facing copy now consistently names cost centers and the supported mapping subjects. | [Use cost centers](https://docs.github.com/en/billing/how-tos/products/use-cost-centers), [Cost-center allocation](https://docs.github.com/en/billing/reference/cost-center-allocation), [1,000 cost centers](https://github.blog/changelog/2026-06-26-cost-center-limit-increased-to-1000-per-enterprise) |
| `cculb` | The user-facing setting models a **cost center budget**, which caps metered charges after the shared pool is exhausted. CCULB instead means **cost center user-level budget** and remains a distinct control. | Enterprise budget endpoints with cost-center scope; enterprise billing manager or owner. | **Terminology corrected.** Preserve the stable internal ID for compatibility; model cost center user-level budgets separately if added later. | [Budgets for usage-based billing](https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing), [Budgets REST API](https://docs.github.com/en/rest/billing/budgets?apiVersion=2026-03-10) |
| `included-usage-cap` | The current feature is **included usage controls for cost centers**, shown as an AI credit pool. It supports blocking or paid overage after the cost center consumes its allocated included credits. | Enterprise budgets/cost-center controls; enterprise billing manager or owner. | **Terminology corrected.** Preserve block-versus-overage behavior and the automatically calculated pool. | [Cost-center AI-credit pools](https://github.blog/changelog/2026-07-02-cost-centers-now-support-included-usage-caps), [Budgets for usage-based billing](https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing) |
| `enterprise-budget-backstop` | The current product term is enterprise spending limit. It caps metered charges after included credits and is not a cap on the complete invoice. | Enterprise budget endpoints; enterprise billing manager or owner. | **Rename and correct consequences.** Distinguish alert-only from stop-usage behavior. | [Budgets for usage-based billing](https://docs.github.com/en/copilot/concepts/billing/budgets-for-usage-based-billing), [Budget controls tutorial](https://docs.github.com/en/copilot/tutorials/budgets/getting-started-with-budget-controls) |

All rows above were reviewed on **2026-08-07**.

## Material capabilities not represented by current settings

| Capability | Evidence disposition | Owning work |
| --- | --- | --- |
| GitHub Code Quality enablement, findings, quality rules, and code coverage rules | Standalone paid product. Explicitly supported on GHEC and Team; explicitly unavailable on GHES at launch; GHE.com support **not documented**. | #12 |
| EMU OIDC and Conditional Access | Material authentication path for EMU, distinct from SAML and SCIM provisioning. | #14 |
| Actions full-SHA pinning | Independent policy field, not part of the allowed-actions enum. | #10 |
| Workflow-created PR approval | Independent Actions policy field. | #10 |
| Runner groups and repository-level runner policy | Material access and network boundary. | Follow-up issue |
| Actions artifact/log retention, cache limits, and fork workflow controls | Material enterprise policies with REST coverage. | Follow-up issue |
| Copilot user-level budgets and paid-usage policy | Precede or constrain cost-center and enterprise spending controls. | #10 after #15 |
| Security campaigns | Operational remediation mechanism for code and secret scanning alerts. | #12 or focused follow-up |

## Changelog triage

| Date | Entry | Disposition |
| --- | --- | --- |
| 2026-04-21 | [Security-related organization API fields deprecated](https://github.blog/changelog/2026-04-21-deprecation-of-security-related-organization-api-fields) | Replace organization security booleans with code security configurations and defaults. |
| 2026-05-26 | [Code Quality repository enablement API](https://github.blog/changelog/2026-05-26-github-code-quality-repository-enablement-api) | Track in #12; do not infer GHE.com support. |
| 2026-06-01 | [Copilot billing and plans updated](https://github.blog/changelog/2026-06-01-updates-to-github-copilot-billing-and-plans) | Replace premium-request-era catalog language with AI Credits and current budgets. |
| 2026-06-11 | [GHES 3.21 GA](https://github.blog/changelog/2026-06-11-github-enterprise-server-3-21-is-now-generally-available) | Update deployment baseline and GHES-specific applicability. |
| 2026-06-23 | [Code Quality findings REST API](https://github.blog/changelog/2026-06-23-fetch-code-quality-findings-via-rest-api) | Track repository findings API in #12. |
| 2026-06-30 | [Code coverage merge protection](https://github.blog/changelog/2026-06-30-github-code-coverage-merge-protection-for-pull-requests) | Track separate Code Quality coverage ruleset rule in #12. |
| 2026-07-02 | [Cost-center AI-credit pools](https://github.blog/changelog/2026-07-02-cost-centers-now-support-included-usage-caps) | Correct `included-usage-cap` terminology and mechanics. |
| 2026-07-20 | [Code Quality GA](https://github.blog/changelog/2026-07-20-github-code-quality-is-now-generally-available) | Explicit GHEC/Team support and GHES exclusion; GHE.com remains not documented. |

## Open verification items

- Obtain an explicit GitHub source or authorized tenant confirmation for Code
  Quality on GHE.com before marking it supported or unsupported.
- Confirm whether enterprise-level Actions policy endpoints exist beyond the
  documented organization/repository REST surfaces.
- Confirm artifact attestation availability on GHES 3.21.
- Record GraphQL mappings only where GitHub publishes a matching object or
  mutation; otherwise state that no documented mapping was found.
- Treat Well-Architected pages whose content is not machine-readable as
  reachable but content-not-verified, and corroborate recommendations with
  extractable authoritative sources.
