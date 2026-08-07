# GitHub Enterprise Settings Configurator

A public, static React + TypeScript decision assistant that turns fragmented GitHub Enterprise guidance into a small, ordered desired-state plan. It helps a platform team choose a target profile, tailor recommendations, review complexity, and export a portable plan.

## Scope

- Target profiles for GitHub.com, GHE.com data residency, or GHES 3.21 with deployment-aware account, authentication, and provisioning choices.
- Base plan, repository visibility, licensed products, and planning scope are modeled independently; GitHub Enterprise does not imply Copilot or paid security products.
- Typed decisions span identity, governance, Secret Protection, Code Security, Code Quality, Actions, audit, Copilot governance, and Copilot cost controls.
- Progressive disclosure for rationale, tradeoffs, prerequisites, consequences, scope, role, apply method, and source links.
- JSON and Markdown exports of the desired state.

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
pnpm lint
pnpm build
```

For GitHub Pages, Vite uses the `/github-enterprise-settings-configurator/` base path in GitHub Actions and `/` for local development.

## GitHub product watch

The scheduled [GitHub product watch](tooling/product-watch/README.md) monitors versioned GitHub Changelog, Docs/API, and GHES release-note sources. It deterministically opens evidence-rich human-review issues and never edits catalog or recommendation code. Manual workflow runs default to dry-run mode.

## Non-goals

- No authentication, backend, tenant connection, observed-state scan, or direct apply.
- No compliance grade, universal security score, breach prediction, or cross-customer comparison.
- No claim that unknown tenant state is divergent. Non-applicable decisions are excluded rather than scored or exported as overrides.
- No recommended promotional AI-credit amounts.
- No claim that undocumented GHE.com product availability matches GitHub.com; unsupported or ambiguous combinations remain explicit.

## Roadmap and export adapters

The JSON format is intentionally a desired-state contract. A future adapter may turn it into review tickets, policy-as-code drafts, or Terraform-provider inputs after an authorized user validates each setting and the target GitHub capability. Direct application, identity validation, tenant discovery, and billing-resource validation remain explicitly out of scope for this static MVP.
