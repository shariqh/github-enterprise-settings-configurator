# GitHub Enterprise Settings Configurator

A public, static React + TypeScript decision assistant that turns fragmented GitHub Enterprise guidance into a small, ordered desired-state plan. It helps a platform team choose a target profile, tailor recommendations, review complexity, and export a portable plan.

Published at
[shariqh.github.io/github-enterprise-settings-configurator](https://shariqh.github.io/github-enterprise-settings-configurator/).

## Scope

- Target profiles for GitHub Enterprise Cloud, GitHub Enterprise Cloud with Data Residency, or GitHub Enterprise Server with deployment-aware account, authentication, and provisioning choices.
- GitHub Enterprise Server recommendations target the latest generally available release; catalog metadata and evidence links remain version-pinned for reproducibility.
- Base plan, repository visibility, licensed products, and planning scope are modeled independently; GitHub Enterprise does not imply Copilot or paid security products.
- Typed decisions span identity, governance, Secret Protection, Code Security, Code Quality, Actions, audit, Copilot governance, and Copilot cost controls.
- Progressive disclosure for rationale, tradeoffs, prerequisites, consequences, scope, role, apply method, and source links.
- A Markdown review handoff with an ordered implementation checklist, owners, prerequisites, caveats, exclusions, and evidence links.
- A versioned JSON desired-state contract with stable IDs, profile/capability context, review state, and additive schema-v2 fields for import or authorized downstream adapters.

## Facilitating a pilot

Use the app in a facilitated desired-state workshop with the enterprise owner and the identity, security, Actions, and Copilot stakeholders relevant to the selected scope. Do not enter secrets or sensitive customer data, and leave unknown facts as unknown. The configurator does not inspect or apply tenant settings and does not assess compliance.

Review remains **Draft** until every applicable editable decision has been reviewed; profile-derived decisions do not block readiness. Draft Markdown and JSON exports remain available for workshop continuity after an explicit confirmation. Once review is complete, exports are labeled **Final** and **Ready for handoff**.

The Review page itself frames what a result means, what happens next, what the customer takes away, and how GitHub helps — derived read-only from the same review analysis as the detailed decision, override, caveat, and exclusion lists below it, without duplicating them. GitHub Solutions Engineers running a facilitated session should also read the internal [SE facilitation guide](docs/se-facilitation-guide.md) for pre-call context, the workshop arc, canonical result interpretation, and follow-up responsibilities.

## Relative posture and complexity model

The review view intentionally avoids a composite grade. Each domain has three separate relative scales:

- **Control influence** orders each setting's choices from stronger to lighter influence, then weights protective settings more than guardrails and enabling practices.
- **Foundational gating** caps a domain when a foundational identity, governance, security, Actions, audit, Copilot, or cost-control decision remains weak.
- **Rollout and ongoing effort** add the selected choices' complexity within that domain and normalize it to the catalog's potential range.

Hosting is context, not a security control, so it affects effort but not control influence. The scales describe the selected desired state only; they do not measure a live tenant, infer compliance, or turn missing evidence into a gap.

## Evidence tiers

The UI labels sources according to their appropriate use:

| Tier | Intended use |
| --- | --- |
| GitHub Docs · mechanics | Current product configuration mechanics |
| Well-Architected · principles | Architecture and operating principles |
| Worked example · adaptable | Examples to adapt, not canonical policy |
| Automation adapter · execution | Potential implementation integrations |

Worked examples include [safe-settings](https://github.com/github-community-projects/safe-settings), [ruleset-recipes](https://github.com/github/ruleset-recipes), and the third-party [Copilot adoption guide](https://samqbush.github.io/copilot-adoption/).

The current product-research baseline is recorded in the
[2026 catalog audit](docs/catalog-audit-2026.md). Global freshness metadata is
versioned in `src/catalogMetadata.ts`; it is not evidence that a feature is
available on a deployment unless the audit records an explicit source.

## Local development

```bash
pnpm install
pnpm dev
pnpm test
pnpm product-watch:test
pnpm copilot-evaluation:test
pnpm lint
pnpm build
```

For GitHub Pages, Vite uses the `/github-enterprise-settings-configurator/` base path in GitHub Actions and `/` for local development.

## GitHub product watch

The [GitHub product watch](tooling/product-watch/README.md) runs daily; manual
runs default to dry-run. It monitors versioned GitHub Changelog, Docs/API, and
GHES sources, including deterministic discovery from the GHES release index for
new or unmodeled versions, release candidates and stable releases, patches, and
lifecycle changes.

Required-source failures and redirects fail closed. Undocumented, unsupported,
or unmodeled availability remains effectively **no** until a human reviews the
evidence. The watch leaves an evidence-rich review issue and never edits
application, catalog, or recommendation code.

The [Copilot evaluation lane](docs/copilot-product-watch-evaluation.md) is
comment-only. It evaluates at most five exact managed fingerprints per run and
uses the documented pre-engine `noop` path when there are no candidates. Its
safe output preserves the same default-no policy for unsupported or
not-documented evidence.

For this user-owned repository, the evaluator requires the repository Actions
secret `COPILOT_GITHUB_TOKEN`. It must contain a fine-grained PAT with only
**Account permissions → Copilot Requests: Read** and no repository permissions.
Store it only as the Actions secret; never paste the token into chat, source,
logs, or workflow YAML. This credential is a prerequisite, not evidence that a
credentialed end-to-end evaluation has run.

## Repository checks and protection

The required CI check is `verify`. It runs configurator, product-watch, and
Copilot evaluator tests, followed by lint and build/type-check. Live branch,
Actions, security, merge, and Pages settings are maintained through the
[repository protection runbook](docs/repository-protection.md), which is the
source of truth for applying or recovering those controls.

## Non-goals

- No authentication, backend, tenant connection, observed-state scan, or direct apply.
- No compliance grade, universal security score, breach prediction, or cross-customer comparison.
- No claim that unknown tenant state is divergent. Non-applicable decisions are excluded rather than scored or exported as overrides.
- No recommended promotional AI-credit amounts.
- No claim that undocumented GHE.com product availability matches GitHub.com; unsupported or ambiguous combinations remain explicit.

## Export artifacts and adapters

Choose Markdown when people need to review, assign, and work the plan. Choose JSON when a tool needs the versioned desired-state contract or when the plan should be imported back into the configurator. Both artifacts include readiness, reviewed, remaining, and draft/final metadata. JSON schema v2 keeps the import-critical `profile`, `intent`, `priorities`, `settings[].id/selected`, and `reviewedSettingIds` fields stable; readiness and richer context remain additive.

A future adapter may turn the JSON contract into review tickets, policy-as-code drafts, or Terraform-provider inputs after an authorized user validates each setting and the target GitHub capability. Direct application, identity validation, tenant discovery, and billing-resource validation remain explicitly out of scope for this static MVP.
