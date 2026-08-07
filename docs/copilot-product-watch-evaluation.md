# Copilot product-watch evaluation

The Copilot evaluation lane augments the deterministic
[GitHub product watch](../tooling/product-watch/README.md). It never replaces
source ingestion, classification, fingerprinting, issue creation, or human
disposition.

## Execution and safety

`.github/workflows/copilot-product-watch-evaluation.md` is a GitHub Agentic
Workflow source file compiled by `gh aw` into
`copilot-product-watch-evaluation.lock.yml`. It runs after a successful
`GitHub product watch` completion on `main` and supports manual dispatch.
It deliberately does not use issue-created events: issues created with the
workflow `GITHUB_TOKEN` do not recursively trigger another workflow.

Before Copilot starts, a deterministic selector:

1. Queries open issues with the `product-watch:review` label.
2. Requires valid 64-character `product-watch:key` and
   `product-watch:fingerprint` body markers plus the
   `product-watch:managed` sentinel.
3. Reads comments only on those managed issues.
4. Skips fingerprints already carrying the exact
   `product-watch:agent-evaluation:FINGERPRINT` comment marker.
5. Selects at most five new or changed fingerprints.
6. Emits a `noop` safe output when there is no work, avoiding inference cost.

The agent has read-only contents, issues, and pull-request permissions. The
only configured write safe output is a custom job that adds up to five
comments. Before posting anything, it recomputes the live managed-issue
allowlist and validates every target, exact fingerprint marker, required
field, authoritative GitHub evidence URL, and the `not documented` default-no
rule. A malformed batch posts nothing. Failed jobs cannot create fallback issues.
The per-run inference budget is 100 AI Credits, with a separate 50-credit
threat-detection cap.

## Authentication and billing prerequisite

The checked-in workflow uses the documented `copilot-requests: write`
permission. Current `gh-aw` documentation defines this as organization-billed
authentication: the repository owner must be an organization with Copilot CLI
and centralized Copilot request billing enabled. No repository PAT is used.

This repository is currently owned by a personal account. GitHub documents
`COPILOT_GITHUB_TOKEN` as the personal-repository alternative, but also states
that the secret is ignored whenever `copilot-requests: write` is present.
Therefore the checked-in workflow will fail explicitly at Copilot inference
until the repository is organization-owned with centralized billing enabled.
There is no token fallback in this repository.

If ownership remains personal, a maintainer must make a separately reviewed
change that removes `copilot-requests: write`, recompiles the lock file, and
sets `COPILOT_GITHUB_TOKEN` to a fine-grained PAT owned by a licensed Copilot
user with only **Account permissions → Copilot Requests: Read**. Never commit
the token. Set it with:

```bash
gh aw secrets set COPILOT_GITHUB_TOKEN --value "<fine-grained-pat>"
```

OAuth tokens (`gho_...`) are rejected by `gh-aw` for this secret.

## Compilation and checks

Install the official extension and compile with the version used by this
repository:

```bash
gh extension install github/gh-aw
gh aw version
gh aw compile copilot-product-watch-evaluation --validate
gh aw validate copilot-product-watch-evaluation --strict
```

`gh aw compile` pins generated actions and dependencies in the lock workflow.
Do not hand-edit the lock file. The checked-in lock was generated with
`gh-aw v0.85.4`.

`gh aw audit` operates on a completed workflow run ID, so it cannot run before
the authentication prerequisite is met and the workflow has executed. After
the first authorized run, audit it with:

```bash
gh aw audit <run-id> --repo shariqh/github-enterprise-settings-configurator
```

Local policy and fixture tests:

```bash
pnpm copilot-evaluation:test
```

The separate `.github/agents/product-watch-implementation.agent.md` profile is
manual-only. It requires an explicit maintainer approval comment, may open at
most one draft pull request, runs project checks, never merges, and preserves
default-no behavior unless new authoritative evidence resolves availability.
