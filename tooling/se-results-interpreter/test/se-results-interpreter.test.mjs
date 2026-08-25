import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const agentPath = new URL(
  "../../../.github/agents/se-results-interpreter.agent.md",
  import.meta.url,
);
const docPath = new URL(
  "../../../docs/se-results-interpretation.md",
  import.meta.url,
);
const fixturePath = new URL(
  "../fixtures/synthetic-export.json",
  import.meta.url,
);

const agent = await readFile(agentPath, "utf8");
const doc = await readFile(docPath, "utf8");
const fixtureText = await readFile(fixturePath, "utf8");
const fixture = JSON.parse(fixtureText);

// Markdown prose reflows across lines; collapse all whitespace so phrase
// assertions do not depend on exact line-wrap points.
const flatten = (text) => text.replace(/\s+/g, " ");
const agentFlat = flatten(agent);
const docFlat = flatten(doc);

const assertIncludes = (haystack, needle, message) => {
  assert.equal(haystack.includes(needle), true, message ?? `missing: ${needle}`);
};

test("agent is manual-only and mechanically read/search-only", () => {
  assert.match(agent, /user-invokable: true/);
  assert.match(agent, /disable-model-invocation: true/);
  assert.match(agent, /tools: \["read", "search"\]/);

  // No mutation-capable tool keyword may appear anywhere in the frontmatter
  // — this agent must never edit, run shell/Git commands, or touch GitHub
  // issues/PRs/tenant state.
  const frontmatterEnd = agent.indexOf("---", agent.indexOf("---") + 3);
  const frontmatter = agent.slice(0, frontmatterEnd);
  for (const forbidden of ["edit", "shell", "execute", "write", "github("]) {
    assert.equal(
      frontmatter.toLowerCase().includes(forbidden),
      false,
      `frontmatter must not reference the "${forbidden}" tool`,
    );
  }
  assertIncludes(agentFlat, "no edit, shell, Git, GitHub CLI, issue/PR, or tenant-mutation capability");
  assertIncludes(agentFlat, "it never proposes a patch to this repository");
});

test("agent fails closed on missing or incompatible input, including the required top-level export fields", () => {
  assertIncludes(agentFlat, "Accept only a single, current schema-v2 JSON desired-state export");
  assertIncludes(agentFlat, "schema.version`/`schemaVersion` must equal `2`");
  assertIncludes(agentFlat, "Do not parse or interpret the Markdown handoff export");
  assertIncludes(agentFlat, "Fail closed on missing input, non-JSON input");
  for (const requiredField of [
    "`schema`",
    "`schemaVersion`",
    "`profile`",
    "`capabilityContext`",
    "`readiness`",
    "`settings` (array)",
    "`caveats` (array)",
    "`domainProfiles` (array)",
    "`excludedDecisions` (array)",
  ]) {
    assertIncludes(agentFlat, requiredField, `input contract must require ${requiredField}`);
  }
  assertIncludes(
    agentFlat,
    "I need a current schema-v2 JSON desired-state export from the configurator",
  );
  assertIncludes(agentFlat, "Never guess, backfill, or reconstruct a missing export field");
});

test("agent enforces the redacted-context privacy contract", () => {
  assertIncludes(agentFlat, "Optional context is limited to a short, redacted summary");
  assertIncludes(agentFlat, "Refuse raw call transcripts, named individuals, customer or account");
  assertIncludes(agentFlat, "ask for a short redacted summary instead of the raw material");
  assertIncludes(agentFlat, "Never infer a customer's identity, contract terms, or facts");
});

test("agent distinguishes plan-level readiness from decision-level review status", () => {
  assertIncludes(agentFlat, "is a **plan-level** rollup");
  assertIncludes(agentFlat, "**decision-level** field");
  assertIncludes(agentFlat, "Never collapse these into one status");
});

test("agent applies the canonical interpretation contract without inventing a foundational-setting field", () => {
  for (const term of [
    "Plan-level Draft",
    "Plan-level Ready for handoff",
    "Decision-level not-reviewed",
    "Decision-level reviewed",
    "Decision-level derived",
    "Override, reviewed",
    "Override, not-reviewed",
    "Excluded / derived default-no",
    "Caveat",
    "High rollout band or ongoing band",
    "Foundationally limited domain",
  ]) {
    assertIncludes(agent, term, `missing interpretation term: ${term}`);
  }
  assertIncludes(agentFlat, 'not automatically "never"');
  assertIncludes(agentFlat, "not a security grade");
  assertIncludes(agentFlat, "confirmed with the customer/SE outside the export");
  assertIncludes(agentFlat, "not as separately settled");

  // schema-v2 exports never carry a `foundational` flag on individual
  // settings[] entries; the agent must not claim otherwise or promise to
  // name the exact limiting decision for a foundation-limited domain.
  assertIncludes(agentFlat, "does not include a `foundational` flag on individual");
  assertIncludes(agentFlat, "does not identify which exact decision caused a domain's limit");
  assert.equal(agentFlat.includes("`foundational: true`"), false);
});

test("agent does not treat every override or exclusion as open work, and never double-counts summary caveats", () => {
  assertIncludes(
    agentFlat,
    "Treat an exclusion that is consistent with the stated profile/context as traceability information",
  );
  assertIncludes(agentFlat, "Only flag an exclusion to validate when it conflicts with the redacted");
  assertIncludes(
    agentFlat,
    "are summary rollups of the same not-reviewed decisions and exclusions you already",
  );
  assertIncludes(agentFlat, "never as additional separate findings");
});

test("agent requires the eight-section output contract distinguishing open, settled, and traceability items, citing capabilityContext.profileWarnings by exact path", () => {
  const required = [
    "Result status and input confidence",
    "What appears settled",
    "What remains open or needs confirmation",
    "Foundationally limited domains to address first",
    "Prioritized SE actions",
    "Generic owner roles",
    "Questions for the next customer meeting",
    "Evidence and assumptions to recheck",
  ];
  for (const section of required) {
    assertIncludes(agent, section, `missing required output section: ${section}`);
  }
  assertIncludes(agentFlat, "including reviewed overrides, with IDs");
  assertIncludes(agentFlat, "Reviewed overrides");
  assertIncludes(agentFlat, "Only unexpected exclusions to validate");
  assertIncludes(agentFlat, "must not be listed here");
  assertIncludes(agentFlat, "validate, discover, deep-dive, pilot/phase, or escalate");
  assertIncludes(agentFlat, "never a named person");
  assertIncludes(agentFlat, "capabilityContext.profileWarnings");
  assertIncludes(agentFlat, "not as new findings");
});

test("agent forbids the prohibited product and legal claims", () => {
  for (const term of [
    "Observed or live tenant state, compliance/certification/ATO status",
    "That any setting has been or will be automatically applied",
    "Guaranteed product availability, feature parity across deployments",
    "A root cause for a customer problem or a legal interpretation",
    "A composite score, ranking, or single \"best\" answer across domains",
    "confirmed customer intent or",
  ]) {
    assertIncludes(agentFlat, term, `missing guardrail: ${term}`);
  }
});

test("documentation gives a genuinely valid, synthetic invocation example only", () => {
  assertIncludes(docFlat, "genuinely valid and current");
  assertIncludes(docFlat, "se-results-interpreter");
  assertIncludes(docFlat, "pnpm se-results-interpreter:test");
  assertIncludes(docFlat, "parseImportedPlan");
  assertIncludes(docFlat, "does not identify which specific decision in that domain caused the limit");
  assertIncludes(docFlat, "reviewed** Override");
  assertIncludes(docFlat, "traceability, not open work");
  assertIncludes(docFlat, "double-count the");
  // The doc's illustrative JSON and prose must never carry a real customer
  // name, transcript reference, or contract detail alongside the export.
  for (const forbidden of ["transcript excerpt", "contract value", "account executive"]) {
    assert.equal(doc.toLowerCase().includes(forbidden), false, `doc must not include: ${forbidden}`);
  }
});

test("synthetic fixture declares the required top-level export fields and a real profile/capability shape", () => {
  assert.equal(fixture.schema.name, "github-enterprise-settings-configurator.desired-state");
  assert.equal(fixture.schema.version, 2);
  assert.equal(fixture.schemaVersion, 2);
  assert.ok(fixture.profile);
  assert.ok(fixture.capabilityContext);
  assert.ok(fixture.readiness);
  assert.ok(Array.isArray(fixture.settings) && fixture.settings.length > 0);
  assert.ok(Array.isArray(fixture.caveats));
  assert.ok(Array.isArray(fixture.domainProfiles) && fixture.domainProfiles.length > 0);
  assert.ok(Array.isArray(fixture.excludedDecisions) && fixture.excludedDecisions.length > 0);

  // A real, current, capability-compatible profile: GHES only supports
  // instance accounts and cannot license Copilot (capabilities.ts).
  assert.equal(fixture.profile.deployment, "ghes");
  assert.equal(fixture.profile.accountModel, "instance");
  assert.equal(fixture.profile.licensedProducts.copilot, "none");

  // A profile warning is present and must be citable at the exact path the
  // agent is required to reference.
  assert.ok(Array.isArray(fixture.capabilityContext.profileWarnings));
  assert.ok(fixture.capabilityContext.profileWarnings.length > 0);

  const reviewStatuses = new Set(fixture.settings.map((item) => item.reviewStatus));
  assert.ok(reviewStatuses.has("reviewed"));
  assert.ok(reviewStatuses.has("not-reviewed"));
  const dispositions = new Set(fixture.settings.map((item) => item.disposition));
  assert.ok(dispositions.has("Recommended"));
  assert.ok(dispositions.has("Override"));

  // Both an unreviewed and a reviewed override must be present so the
  // "open vs. settled" distinction has real, concrete examples: an
  // unreviewed override is still open; a reviewed override is settled but
  // needs its rationale confirmed outside the export.
  const overrides = fixture.settings.filter((item) => item.disposition === "Override");
  assert.ok(overrides.some((item) => item.reviewStatus === "not-reviewed"));
  assert.ok(overrides.some((item) => item.reviewStatus === "reviewed"));

  assert.equal(fixture.excludedDecisions[0].applicability.status, "excluded");
  assert.equal(
    fixture.domainProfiles.some((profile) => profile.foundationLimited === true),
    true,
  );

  // No exported setting carries a `foundational` field — this is the exact
  // gap the agent's contract is written to respect.
  for (const setting of fixture.settings) {
    assert.equal(Object.hasOwn(setting, "foundational"), false);
  }

  // Guard against accidental real customer content in the checked-in fixture.
  for (const forbidden of ["transcript", "contract number", "contract value", "account executive"]) {
    assert.equal(
      fixtureText.toLowerCase().includes(forbidden),
      false,
      `fixture must not include: ${forbidden}`,
    );
  }
});
