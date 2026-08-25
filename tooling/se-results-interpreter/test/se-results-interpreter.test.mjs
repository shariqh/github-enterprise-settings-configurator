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

test("agent fails closed on missing or incompatible input", () => {
  assertIncludes(agentFlat, "Accept only a single, current schema-v2 JSON desired-state export");
  assertIncludes(agentFlat, "schema.version`/`schemaVersion` must equal `2`");
  assertIncludes(agentFlat, "Do not parse or interpret the Markdown handoff export");
  assertIncludes(agentFlat, "Fail closed on missing input, non-JSON input");
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

test("agent applies the canonical interpretation contract", () => {
  for (const term of [
    "Draft / not-reviewed",
    "Ready for handoff / reviewed",
    "Override",
    "Excluded / derived default-no",
    "Caveat",
    "High rollout band or ongoing band",
    "Foundational decision",
  ]) {
    assertIncludes(agent, term, `missing interpretation term: ${term}`);
  }
  assertIncludes(agentFlat, 'not automatically "never"');
  assertIncludes(agentFlat, "not a security grade");
});

test("agent requires the eight-section output contract", () => {
  const required = [
    "Result status and input confidence",
    "What appears settled",
    "What remains open",
    "Foundational decisions to address first",
    "Prioritized SE actions",
    "Generic owner roles",
    "Questions for the next customer meeting",
    "Evidence and assumptions to recheck",
  ];
  for (const section of required) {
    assertIncludes(agent, section, `missing required output section: ${section}`);
  }
  assertIncludes(agentFlat, "validate, discover, deep-dive, pilot/phase, or escalate");
  assertIncludes(agentFlat, "never a named person");
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

test("documentation gives a synthetic invocation example only", () => {
  assertIncludes(docFlat, "entirely synthetic");
  assertIncludes(docFlat, "se-results-interpreter");
  assertIncludes(docFlat, "pnpm se-results-interpreter:test");
  // The doc's illustrative JSON and prose must never carry a real customer
  // name, transcript reference, or contract detail alongside the export.
  for (const forbidden of ["transcript excerpt", "contract value", "account executive"]) {
    assert.equal(doc.toLowerCase().includes(forbidden), false, `doc must not include: ${forbidden}`);
  }
});

test("synthetic fixture is a valid schema-v2 export the agent would accept", () => {
  assert.equal(fixture.schema.name, "github-enterprise-settings-configurator.desired-state");
  assert.equal(fixture.schema.version, 2);
  assert.equal(fixture.schemaVersion, 2);
  assert.ok(Array.isArray(fixture.settings) && fixture.settings.length > 0);
  assert.ok(fixture.readiness);
  assert.ok(Array.isArray(fixture.domainProfiles) && fixture.domainProfiles.length > 0);
  assert.ok(Array.isArray(fixture.caveats));
  assert.ok(Array.isArray(fixture.excludedDecisions));

  const reviewStatuses = new Set(fixture.settings.map((item) => item.reviewStatus));
  assert.ok(reviewStatuses.has("reviewed"));
  assert.ok(reviewStatuses.has("not-reviewed"));
  const dispositions = new Set(fixture.settings.map((item) => item.disposition));
  assert.ok(dispositions.has("Recommended"));
  assert.ok(dispositions.has("Override"));
  assert.equal(fixture.excludedDecisions[0].applicability.status, "excluded");
  assert.equal(
    fixture.domainProfiles.some((profile) => profile.foundationLimited === true),
    true,
  );

  // Guard against accidental real customer content in the checked-in fixture.
  for (const forbidden of ["transcript", "@", "contract number", "contract value"]) {
    assert.equal(
      fixtureText.toLowerCase().includes(forbidden),
      false,
      `fixture must not include: ${forbidden}`,
    );
  }
});
