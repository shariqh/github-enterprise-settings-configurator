# Repository protection — post-merge live settings

This document is the runbook for the **coordinator** to apply live repository
settings **after** this PR merges. Nothing here is applied automatically by the
PR; the checked-in files (CI workflow, hardened Pages workflow, Dependabot,
CODEOWNERS) are the code-side half, and the live settings below are the
control-plane half.

Replace `OWNER/REPO` with `shariqh/github-enterprise-settings-configurator` in
every command. All payloads were written against the live state observed on
2026-08-07 (single admin collaborator `shariqh`, public repo, `main` default
branch, no rulesets, Pages built from a workflow).

> **Sole-maintainer safety rule:** `shariqh` is the only maintainer. Every
> setting below keeps **required approvals at 0** and does **not** require code
> owner review, so a solo maintainer can still merge their own PRs. Do **not**
> raise `required_approving_review_count` or enable "require code owner review"
> unless a second reviewer exists.

---

## 1. Main branch ruleset (PRs, CI gate, conversation resolution)

Create one repository ruleset targeting `main`. It requires a PR, a green
`verify` check, thread resolution, and blocks force pushes and deletion —
without any approval requirement.

**Required status check context:** `verify` (the job name in
`.github/workflows/ci.yml`). If you later rename the job, update the ruleset.

```bash
gh api --method POST repos/OWNER/REPO/rulesets \
  --input main-branch-ruleset.json
```

`main-branch-ruleset.json`:

```json
{
  "name": "main branch protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "bypass_actors": [
    {
      "actor_type": "RepositoryRole",
      "actor_id": 5,
      "bypass_mode": "always"
    }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "dismiss_stale_reviews_on_push": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash", "merge", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "verify" }
        ]
      }
    }
  ]
}
```

Notes:

- `bypass_actors` grants the **Repository admin** role (`actor_id: 5`)
  `always` bypass for emergency merges. This is the escape hatch; it does not
  weaken the default path because normal merges still flow through CI.
- `non_fast_forward` blocks force pushes; `deletion` blocks branch deletion.
- `required_review_thread_resolution: true` is the "require conversation
  resolution before merging" control.
- `strict_required_status_checks_policy: true` requires the branch to be up to
  date with `main` before merge. Drop to `false` if you prefer fewer rebases.

---

## 2. Actions policy — full-SHA enforcement + selected actions

All checked-in workflows already pin every action to a full-length commit SHA,
so enforcement is compatible today.

### 2a. Restrict which actions may run

Only GitHub-owned actions and `pnpm/action-setup` are used.

```bash
# Enable Actions with a selected allow-list.
gh api --method PUT repos/OWNER/REPO/actions/permissions \
  -f enabled=true -f allowed_actions=selected

# Allow GitHub-owned actions plus pnpm/action-setup (any pinned ref).
gh api --method PUT repos/OWNER/REPO/actions/permissions/selected-actions \
  -F github_owned_allowed=true \
  -F verified_allowed=false \
  -f 'patterns_allowed[]=pnpm/action-setup@*'
```

Current inventory to keep this list in sync:

| Action | Where |
| --- | --- |
| `actions/checkout` | ci.yml, deploy-pages.yml |
| `actions/setup-node` | ci.yml, deploy-pages.yml, product-watch.yml |
| `pnpm/action-setup` | ci.yml, deploy-pages.yml |
| `actions/configure-pages` | deploy-pages.yml |
| `actions/upload-pages-artifact` | deploy-pages.yml |
| `actions/deploy-pages` | deploy-pages.yml |
| `actions/upload-artifact` | product-watch.yml |

> `product-watch.yml` is maintained by the daily/GHES lane and still uses
> mutable tags in some steps at the time of writing. Confirm it is fully
> SHA-pinned **before** turning on hard SHA enforcement, or those runs will be
> blocked.

### 2b. Require full-SHA pinning

Full-SHA pinning enforcement is an organization/enterprise Actions policy
("Require actions to be pinned to a full-length commit SHA"). For a
user-owned repo it is inherited from the account's Actions policy. Enable it at
`https://github.com/settings/actions` (or the org equivalent) once every
workflow — including `product-watch.yml` — is SHA-pinned.

---

## 3. Default workflow token — read-only, no PR approvals

```bash
gh api --method PUT repos/OWNER/REPO/actions/permissions/workflow \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=false
```

This matches the audited baseline (read-only token, cannot approve PR reviews)
and is compatible with all checked-in workflows: `ci.yml` and
`deploy-pages.yml` request only the scopes they need via explicit `permissions:`
blocks, and `product-watch.yml` sets its own `issues: write`.

---

## 4. Merge posture — auto-merge + delete branch on merge

Observed live state: `allow_auto_merge=false`, `delete_branch_on_merge=false`,
all three merge methods enabled. Recommended posture:

```bash
gh api --method PATCH repos/OWNER/REPO \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  -F allow_squash_merge=true \
  -F allow_merge_commit=true \
  -F allow_rebase_merge=true
```

Enabling auto-merge lets a PR merge the moment `verify` goes green and threads
resolve, without a maintainer babysitting it. `delete_branch_on_merge` keeps the
branch list clean and complements Dependabot's high PR volume.

---

## 5. Dependabot security updates

Security updates are currently **disabled**. Enable vulnerability alerts (a
prerequisite) and automated security fixes:

```bash
gh api --method PUT repos/OWNER/REPO/vulnerability-alerts
gh api --method PUT repos/OWNER/REPO/automated-security-fixes
```

Version updates (weekly, grouped, bounded) are already configured in
`.github/dependabot.yml`; they take effect automatically on merge.

---

## 6. Secret scanning & push protection (already enabled — assert)

These are already on. To (re)assert idempotently:

```bash
gh api --method PATCH repos/OWNER/REPO \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
```

---

## 7. Pages environment — main-only deployment policy

Pages builds from a workflow, and the `github-pages` environment already
restricts deployments to a custom branch policy named `main`
(`custom_branch_policies: true`). To assert/recreate that policy:

```bash
# Ensure the environment allows custom branch policies.
gh api --method PUT repos/OWNER/REPO/environments/github-pages \
  -f 'deployment_branch_policy[protected_branches]=false' \
  -f 'deployment_branch_policy[custom_branch_policies]=true'

# Allow only main to deploy to github-pages (idempotent: skip if it exists).
gh api --method POST repos/OWNER/REPO/environments/github-pages/deployment-branch-policies \
  -f name=main -f type=branch
```

This keeps `deploy-pages.yml` deployments limited to `main`, matching the
workflow's `on: push: branches: [main]` trigger.

---

## Rollback / emergency steps

- **Merge is blocked and CI is broken/unavailable:** merge via the admin bypass
  actor from the ruleset (repository admin role has `always` bypass), or
  temporarily set the ruleset `enforcement` to `evaluate` (report-only):

  ```bash
  # List rulesets to find the id.
  gh api repos/OWNER/REPO/rulesets --jq '.[] | {id, name, enforcement}'
  # Soften to report-only.
  gh api --method PUT repos/OWNER/REPO/rulesets/RULESET_ID \
    -f enforcement=evaluate
  # Re-arm afterwards.
  gh api --method PUT repos/OWNER/REPO/rulesets/RULESET_ID \
    -f enforcement=active
  ```

- **A required action is blocked by SHA enforcement / allow-list:** add the
  needed `owner/repo@*` pattern to the selected-actions list (§2a) or, as a
  last resort, set `allowed_actions=all`:

  ```bash
  gh api --method PUT repos/OWNER/REPO/actions/permissions \
    -f enabled=true -f allowed_actions=all
  ```

- **A workflow needs a broader token temporarily:** prefer adding a scoped
  `permissions:` block to that single workflow over flipping the repo default
  back to `write`.

- **Full revert of branch protection:** delete the ruleset entirely:

  ```bash
  gh api --method DELETE repos/OWNER/REPO/rulesets/RULESET_ID
  ```

- **Pages regression:** re-run the `Deploy GitHub Pages` workflow from the
  Actions tab (`workflow_dispatch`); the environment policy and concurrency
  group (`pages`, no cancel-in-progress) keep deployments serialized.
