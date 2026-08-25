# SE facilitation guide

This is internal guidance for a GitHub Solutions Engineer (SE) running a
facilitated workshop with the public
[GitHub Enterprise Settings Configurator](../README.md). It reflects patterns
observed across many customer facilitations, generalized into composite,
non-attributable guidance. **Nothing here is a real customer quote, name, or
private source.** Every example below is synthetic. Do not add a real
transcript, customer name, direct quote, customer-specific fact, or private
source path to this file or any other file in this public repository.

The configurator itself stays a static, public planning tool. This guide does
not make it internal-only; it is the operating manual an SE reads before,
during, and after using it with a customer.

## Why use the configurator, and when not to

Use it when a customer needs to turn fragmented GitHub Enterprise guidance
into one small, ordered, desired-state plan they can review, own, and export
before implementation begins. It is strongest for the recurring, high-value
part of an SE engagement: getting a customer's identity, governance, security,
Actions, audit, and Copilot decisions written down as explicit, reviewed
choices, with rationale and tradeoffs attached, instead of left as scattered
notes across a call.

Do not reach for it when:

- The customer needs a live tenant assessment. The configurator never
  inspects, connects to, or reads a real tenant; it only helps a customer
  describe the desired state they want.
- The ask is a compliance attestation, audit response, or certification. This
  tool produces a planning artifact, not evidence of compliance.
- The customer wants pricing, licensing cost quotes, or a committed
  implementation timeline. Those belong with the account team and official
  pricing sources, not this workshop.
- A decision genuinely needs current product-availability confirmation beyond
  what the catalog's evidence links already show. Pause and validate against
  current GitHub Docs (or escalate) rather than let the workshop imply an
  availability fact the tool cannot confirm.

## Pre-call context to gather

Arrive with enough context that the workshop spends its time on decisions, not
on discovery you could have done beforehand. At minimum, understand:

- **Rollout stage** — is this greenfield, an existing estate being hardened,
  or a migration? This changes which catalog defaults are relevant and how
  much the customer will treat prior configuration as a baseline.
- **Operating model** — personal accounts, Enterprise Managed Users, or a
  GitHub Enterprise Server instance account model, and the authentication and
  provisioning method that goes with it.
- **Identity baseline** — the current or intended identity provider
  relationship (SAML, OIDC, SCIM, JIT, LDAP, or none yet).
- **Cost owner** — who inside the customer organization owns the licensing and
  Copilot cost decisions. Effort and cost decisions land better when the
  accountable budget owner is in the room or named for follow-up.
- **Governance and approval constraints** — known regulatory, procurement, or
  internal-policy constraints that will shape deliberate overrides later.
  Capture these as constraints to expect, not as facts to enter into the tool.
- **Intended scope** — which domains (identity, governance, security,
  Actions, audit, Copilot) this session should actually cover. Not every
  workshop needs every domain in one sitting.

Never enter secrets, credentials, or customer-identifying data into the
configurator itself. It is a static, public, browser-only tool with no
backend; anything unknown should stay marked unknown rather than guessed.

## Workshop arc

### Before

Confirm the pre-call context above, agree on scope with the customer contact,
and identify who from the customer side should be present for each domain
(an identity owner for authentication/provisioning choices, a security owner
for Secret Protection/Code Security, and so on).

### During

Walk the target-profile questions first so the catalog resolves to the right
capability set, then move domain by domain. Let the customer make each
editable decision explicitly — resist making it for them, even when the
catalog recommendation is confident. The value of the artifact comes from the
customer's own reviewed choice, not from the SE's guess at their preference.

Use the rationale, tradeoff, prerequisite, and consequence text as talking
points, not as something to read verbatim. When a customer's real-world
constraint pushes them to a different choice than the recommendation, that is
a legitimate override — capture it and ask them to state the reason out loud
so it is easy to recall later.

### Review

Walk the Review page's own framing before touching the detailed lists below
it: what the result means, what happens next, what the customer takes away,
and how GitHub helps. Use it to set expectations, then let the detailed
decision, override, caveat, and exclusion lists underneath answer "which
one, specifically."

### Handoff

Export both artifacts. The Markdown review handoff is for people: it is the
ordered, human-readable checklist with owners, prerequisites, caveats,
exclusions, and evidence links. The JSON desired-state contract is for tools
and re-entry: a customer or partner can import it back into the configurator
later, or adapt it for an authorized downstream tool. Confirm with the
customer which artifact(s) they need before ending the call.

### Follow-through

The workshop is not the end of the engagement. See "SE follow-up
responsibilities" below for what an SE owns after the export.

## Canonical result interpretation

Interpret every Review-page result the same way, regardless of the specific
customer, so the story stays consistent across engagements:

- **Draft vs. Ready** — Draft means at least one applicable editable decision
  has not been explicitly reviewed yet; Ready means every applicable editable
  decision has been. Neither state is a judgment about the customer's
  security posture. A Draft plan with strong choices is not "less secure"
  than a Ready plan; it is simply not yet a completed artifact.
- **Unreviewed decisions** — pending, not defaulted. An unreviewed decision
  still shows a generated recommendation or an already-entered explicit value,
  but it has not been accepted by the customer. Treat it as an open item to
  close with the right stakeholder, not as evidence of a gap.
- **Deliberate overrides** — a customer choosing a different value than the
  catalog recommendation is not a mistake to correct. It usually encodes a
  real, legitimate constraint (contractual, regulatory, operational, or
  historical). Confirm the rationale and the owner who can speak to it later,
  and record that reasoning outside the tool if the customer wants it kept.
- **Exclusions and default-no results** — a setting excluded from the plan
  because the resolved profile does not satisfy its catalog capability
  requirement is a planning result, not an observed gap. It often means
  "not applicable right now" or "not licensed yet," not "missing control."
  Never present an exclusion to a customer as something that is broken or
  unconfigured on their tenant — the tool never looked at their tenant.
- **Caveats** — flag genuinely open questions (unresolved current state,
  unreviewed decisions, or default-no exclusions). Each caveat names
  something to validate, not something already known to be wrong.
- **Effort (rollout and ongoing)** — describes operational and process
  complexity, not security strength. A High-effort domain is not a weak
  domain; it is a domain that will need more rollout planning, pilot
  sequencing, or ongoing operational capacity. Treat High effort as a
  sequencing signal, never as a reason to soften the underlying choice.
- **Foundational limits** — some domains are capped when a foundational
  decision (for example, an identity or governance baseline) remains weak.
  The cap is a modeling signal that downstream enhancements in that domain
  will not raise its ceiling until the foundational decision itself changes.
  Resolve the foundational decision first; do not try to compensate for it
  with unrelated settings in the same domain.
- **No composite score** — the configurator deliberately reports control
  influence, rollout effort, and ongoing effort as three separate scales per
  domain. Never collapse them into a single number, grade, or ranking when
  presenting results, and do not let a customer's own tooling do so either
  without noting the same caveat.

## Customer takeaway

The customer leaves the workshop with a reviewed (or explicitly still-draft)
desired-state artifact: the Markdown handoff and/or JSON contract, plus the
open questions, assumptions, overrides, and caveats captured along the way.
That artifact is a decision record for their own team to act on — it is not
an implementation order, an approval, or a compliance sign-off.

## SE follow-up responsibilities

After the workshop, the SE's job is to keep the plan moving without turning
into an implementation vendor:

- Chase down anything left unreviewed with the named accountable stakeholder,
  and close out open caveats before treating the plan as final.
- Validate any assumption the customer could not confirm live (current
  licensing, deployment topology, or product documentation) against
  authoritative, current sources — not memory from a prior engagement.
- Offer a focused follow-up call or deep dive for any domain that surfaced
  real complexity (a High-effort domain, a foundational limitation, or a
  cluster of deliberate overrides) rather than trying to resolve it in the
  same session.
- Help the customer scope a pilot or phased rollout plan for high-effort
  domains, sequenced after their foundational decisions are settled.
- Escalate internally when a customer's question needs authoritative evidence
  the SE does not have — an undocumented capability, an ambiguous deployment
  combination, or a product-roadmap question — rather than guessing an
  answer that becomes a customer-facing commitment.

## Guardrails

- **Privacy** — never enter or record a real transcript, customer name, direct
  quote, or private source path in this repository, in the exported
  artifacts, or in any related documentation. Keep composite, synthetic
  examples only.
- **Compliance** — the configurator does not perform a compliance assessment
  and does not produce compliance evidence. Do not represent the exported
  plan, or a "Ready for handoff" status, as a compliance attestation.
- **Product availability** — trust the catalog's evidence tier labels. A
  Worked example or Well-Architected source is guidance to adapt, not a
  canonical statement of product availability; only a GitHub Docs · mechanics
  source (or an explicit entry in the
  [catalog audit](catalog-audit-2026.md)) supports an availability claim.
  When a customer's exact deployment/plan combination is not documented,
  say so plainly instead of inferring support from silence.
- **Pricing and timelines** — do not quote prices, licensing costs, or commit
  to an implementation date or delivery timeline in the workshop. Route those
  questions to the account team and official pricing channels.
- **No live tenant** — the configurator never inspects, connects to, applies
  settings to, or reads state from a real GitHub tenant. Do not imply
  otherwise to a customer, and do not accept live credentials, tokens, or
  tenant exports as workshop input.

## Composite example (synthetic, not a real engagement)

A public-sector customer (a composite, not a real account) enters the
workshop mid-migration with an existing GitHub Enterprise Cloud tenant, SAML
authentication, and no formal Copilot governance yet. During the session they
override the default Secret Protection rollout choice to a slower, wave-based
rollout because their change-management process requires phased approval —
a legitimate, deliberate override, not a mistake. Two Copilot governance
decisions remain unreviewed because the customer's Copilot budget owner was
not on the call. The SE exports a Draft Markdown handoff, schedules a
30-minute follow-up with the budget owner to close the two open decisions,
and flags the Actions & supply chain domain — which came back High effort —
as a candidate for a phased pilot once the foundational identity decisions
are finalized.
