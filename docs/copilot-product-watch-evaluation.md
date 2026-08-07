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
2. Uses the producer's marker parser and requires the real 24-character
   `product-watch:key`, 64-character `product-watch:fingerprint`, and
   `product-watch:managed` sentinel.
3. Reads comments only on those managed issues.
4. Skips fingerprints already carrying the exact
   `product-watch:agent-evaluation:FINGERPRINT` comment marker.
5. Selects at most five new or changed fingerprints.
6. Persists the exact selected issue number, candidate key, and fingerprint as
   a run artifact before agent execution.
7. Emits a `noop` safe output through gh-aw's generated safe-output path when
   there is no work. The Copilot harness detects it before inference, so no AI
   Credits are consumed.

The agent has read-only contents, issues, and pull-request permissions. The
only configured write safe output is a custom job that adds up to five
comments. It validates requests against the immutable selection artifact, then
re-fetches each selected target and requires unchanged open state, review
label, managed marker, candidate key, and fingerprint. Before posting anything,
it also validates the 60,000-character limit, one current evaluation marker,
unique required fields, authoritative GitHub evidence URLs, and the
`unsupported`/`not documented` default-no rule. Mentions and GitHub issue/PR
cross-reference forms are neutralized to prevent notifications and timeline
links. Comments permit bare HTTPS URLs only; Markdown, reference-style, HTML,
non-HTTPS URI, and email autolink syntax is rejected so visible text cannot
hide an unverified destination.

The job fetches every cited evidence URL with HTTPS-only, allowlisted
GitHub hosts/paths, at most three allowlisted redirects, and a required 2xx
response. Affirmative support additionally requires a reachable GitHub Docs
URL. This verifies reachability, not semantic relevance; the analyst and human
reviewer remain responsible for whether the source proves the claim. gh-aw
v0.85.4 does not expose a cryptographically bindable per-`web-fetch` retrieval
record to the custom safe job, so the prompt requires same-run retrieval but
the safe job can enforce only the cited URL's live reachability.

A malformed batch posts nothing. Comment API calls are sequential and GitHub
does not provide a transaction: a network/API failure after one successful
comment can leave a partially posted batch, which the job reports explicitly.
Failed jobs cannot create fallback issues.
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
gh aw compile copilot-product-watch-evaluation --validate --strict
gh aw validate copilot-product-watch-evaluation --strict
```

`gh aw compile` pins generated actions and dependencies in the lock workflow.
The checked-in source actions use full commit SHAs instead of mutable major
tags. Compiler-generated action families use the embedded pins from the exact
`gh-aw v0.85.4` binary; `.github/aw/actions-lock.json` retains the
non-embedded gh-aw setup resolution. Do not hand-edit either lock. Two clean
strict compiles with v0.85.4 must produce byte-identical source and action
locks.

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

The evaluation tests are not yet wired into `.github/workflows/ci.yml` because
that workflow is being introduced independently. Until that branch lands and
this branch is refreshed from `main`, PR validation must run
`pnpm copilot-evaluation:test` explicitly. Adding it to CI is a required
pre-merge integration step after coordination with the CI branch owner.

The separate `.github/agents/product-watch-implementation.agent.md` profile is
manual-only and model invocation is disabled. Human invocation is the approval
for the stated scope. Its mechanical tools are limited to read, search, and
edit, so it can prepare a patch but cannot run shell/Git commands, push, publish
or ready a pull request, enable auto-merge, or merge. A human or coordinator
must run the documented checks and explicitly publish reviewed changes.
