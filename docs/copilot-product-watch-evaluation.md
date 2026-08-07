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

This user-owned repository uses the documented personal-repository
authentication mode. The workflow intentionally omits the organization-only
`copilot-requests: write` permission, so `gh-aw` requires the
`COPILOT_GITHUB_TOKEN` Actions secret and fails explicitly during activation
when it is absent or invalid. There is no authentication fallback.

Create a **fine-grained personal access token**, not a classic PAT, OAuth token,
GitHub App token, or `GITHUB_TOKEN`. The token must:

- be owned by the personal account that has an active GitHub Copilot license;
- use that user as the resource owner; and
- grant only **Account permissions → Copilot Requests: Read**.

Repository permissions are not required for Copilot inference. Safe-output
comments continue to use the short-lived workflow `GITHUB_TOKEN`, limited to
the generated comment job. Never commit, print, log, or place the PAT in
workflow YAML. Store it only as the repository Actions secret:

```bash
gh aw secrets set COPILOT_GITHUB_TOKEN --value "<fine-grained-pat>"
```

This secret is a **post-merge human prerequisite**. Do not enable or manually
dispatch the workflow until it is configured. OAuth tokens (`gho_...`) are
rejected by `gh-aw`.

### Rotation and revocation

1. Create a replacement fine-grained PAT with the same minimum account
   permission and an expiration date.
2. Replace the repository secret with `gh aw secrets set
   COPILOT_GITHUB_TOKEN --value "<replacement-fine-grained-pat>"`.
3. Run one manual evaluation and confirm authentication before revoking the old
   token.
4. Revoke the old PAT under GitHub **Settings → Developer settings → Personal
   access tokens → Fine-grained tokens**.
5. To disable the lane immediately, delete the repository secret and revoke the
   active PAT. The next run fails closed during activation.

If the repository later moves to an organization with centralized Copilot CLI
billing, a separate reviewed migration may add `copilot-requests: write`,
remove the PAT prerequisite, recompile the lock, and revoke the personal token.

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
