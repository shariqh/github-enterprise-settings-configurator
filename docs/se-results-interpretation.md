# SE results interpretation agent

`.github/agents/se-results-interpreter.agent.md` gives a GitHub Solutions
Engineer a decision-ready, internal interpretation of one configurator JSON
export. It never inspects or changes a tenant, and it never edits this
repository.

## Invocation

The agent is manual-only: `user-invokable: true` and
`disable-model-invocation: true`, so it only runs on an SE's explicit request
and is never triggered by the model on its own. Its mechanical tools are
limited to `read` and `search` — there is no edit, shell, Git, GitHub CLI, or
tenant-mutation capability, so it cannot propose a patch, open an issue or
pull request, or apply anything to a customer tenant.

Invoke it from the GitHub Copilot CLI with the current JSON export attached or
pasted, for example:

```bash
copilot --agent se-results-interpreter
```

Then share the exported file and, optionally, a short redacted context
summary (rollout stage, operating model, known constraints — nothing else).

## Input contract

- **Required:** the current schema-v2 JSON desired-state export from the
  Review step (`schema.name` =
  `github-enterprise-settings-configurator.desired-state`, `schemaVersion` =
  `2`). The Markdown handoff export, screenshots, and prose descriptions are
  not accepted in v1.
- Missing, malformed, wrong-schema, or non-JSON input fails closed with an
  exact request for a fresh JSON export — the agent does not guess.
- Optional context must already be redacted. The agent refuses raw
  transcripts, named individuals, customer/account identifiers, deal or
  contract data, and credentials, and asks for a redacted summary instead.

## Synthetic invocation example

The export below is entirely synthetic — no customer name, transcript, or
real account data — and mirrors the schema-v2 shape emitted by
`src/logic/export.ts`. It also lives at
[`tooling/se-results-interpreter/fixtures/synthetic-export.json`](../tooling/se-results-interpreter/fixtures/synthetic-export.json)
so the static checks below can validate it.

Redacted context an SE might add alongside the file:

> Rollout stage: early pilot with the platform team. Operating model:
> GitHub Enterprise Server, managed users via SAML/SCIM. Known constraint:
> must remain self-hosted through the next fiscal quarter.

```json
{
  "schema": {
    "name": "github-enterprise-settings-configurator.desired-state",
    "version": 2
  },
  "schemaVersion": 2,
  "readiness": {
    "status": "draft",
    "artifactStatus": "draft",
    "applicableEditableDecisionCount": 3,
    "reviewedDecisionCount": 1,
    "remainingDecisionCount": 2,
    "isReady": false
  },
  "caveats": [
    { "code": "unreviewed-decisions", "message": "2 applicable editable decisions have not been reviewed." },
    { "code": "default-no-exclusions", "message": "1 catalog decision is excluded by the resolved capability model." }
  ],
  "domainProfiles": [
    { "domain": "Identity & administration", "postureLabel": "Moderate", "foundationLimited": true, "rolloutBand": "Moderate", "ongoingBand": "Moderate" }
  ],
  "settings": [
    { "id": "identity-saml-enforcement", "domain": "Identity & administration", "disposition": "Recommended", "reviewStatus": "not-reviewed", "role": "Identity administrator" },
    { "id": "actions-runner-policy", "domain": "Actions & supply chain", "disposition": "Override", "reviewStatus": "not-reviewed", "role": "Platform engineering" },
    { "id": "secret-scanning-push-protection", "domain": "Code security", "disposition": "Recommended", "reviewStatus": "reviewed", "role": "Security lead" }
  ],
  "excludedDecisions": [
    { "id": "copilot-enterprise-knowledge-bases", "domain": "Copilot governance", "applicability": { "status": "excluded", "reason": "Excluded by catalog availability: missing required capabilities `copilot-enterprise`." } }
  ]
}
```

Given this input, the agent's briefing would, among other things:

- Report the artifact as **Draft** with two of three editable decisions not
  yet reviewed (from `readiness`).
- Flag the SAML enforcement decision as an **open, foundational** item ahead
  of code-security follow-ups, because `domainProfiles` marks
  `"Identity & administration"` as `foundationLimited: true`.
- Describe the excluded Copilot Enterprise knowledge-base decision as a
  capability gap for this profile, not a statement about the customer's live
  tenant or a permanent "no."
- Recommend the runner-policy override be confirmed with the customer's
  platform engineering owner rather than treated as an error.

## What it will not do

It will not claim observed tenant state, compliance/ATO status, approval,
automatic application, guaranteed availability or parity, pricing, a
timeline, a root cause, a legal interpretation, or a single composite score
across domains. `domainProfiles` are reported as separate, relative signals.
Any customer-facing recap remains a separate, human-authored artifact.

## Static enforcement

```bash
pnpm se-results-interpreter:test
```

`tooling/se-results-interpreter/test/se-results-interpreter.test.mjs` checks
the agent's frontmatter (`user-invokable: true`,
`disable-model-invocation: true`, `tools: ["read", "search"]`, and the
absence of any edit/shell/GitHub/tenant-mutation tool), the required input,
privacy, interpretation, and output-contract language, the prohibited-claims
guardrails, and that the synthetic fixture parses as a schema-v2 export. The
required `verify` job in `.github/workflows/ci.yml` runs this suite on every
pull request and push to `main`.
