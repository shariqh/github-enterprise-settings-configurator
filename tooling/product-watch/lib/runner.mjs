import {
  assertAllowedDocsUrl,
  buildCandidates,
  buildVersionDiscoveredEntry,
  compareGhesVersions,
  ingestConfiguredSources,
  ingestSourceContent,
  parseIssueMarkers,
  planIssueActions,
  renderIssueBody,
  sha256,
} from "./core.mjs";
import {createGitHubClient} from "./github.mjs";

const STATE_JSON_PATTERN =
  /<!-- product-watch:state:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- product-watch:state:end -->/;

export function parseState(body = "") {
  const match = body.match(STATE_JSON_PATTERN);
  if (!match) {
    return {schemaVersion: 1, lastSuccessfulScan: null, sources: {}, fingerprints: []};
  }
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.fingerprints)) {
      throw new Error("Unsupported state payload");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid product-watch state issue: ${error.message}`);
  }
}

export function renderStateBody(state) {
  return `# Product watch state

This issue is managed by the GitHub product-watch workflow. It records the last fully successful scan and bounded deduplication state. Partial source or mutation failures never advance it.

<!-- product-watch:state:start -->
\`\`\`json
${JSON.stringify(state, null, 2)}
\`\`\`
<!-- product-watch:state:end -->
`;
}

function buildNextState(previous, candidates, sources, retrievedAt, maxFingerprints) {
  const fingerprints = [
    ...previous.fingerprints,
    ...candidates.map((candidate) => candidate.fingerprint),
  ];
  const uniqueFingerprints = [...new Set(fingerprints)].slice(-maxFingerprints);
  return {
    schemaVersion: 1,
    lastSuccessfulScan: retrievedAt,
    sources: Object.fromEntries(
      sources.map((source) => [
        source.id,
        {
          lastSuccessfulScan: retrievedAt,
          entryCount: source.entryCount,
          url: source.url,
        },
      ]),
    ),
    fingerprints: uniqueFingerprints,
  };
}

function titleFor(candidate) {
  const title = `[product-watch] ${candidate.title}`;
  return title.length <= 256 ? title : `${title.slice(0, 252)}...`;
}

async function fetchText(source, config, fetchImpl) {
  const response = await fetchImpl(source.url, {
    headers: {
      Accept: source.kind === "rss"
        ? "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8"
        : "text/html, application/xhtml+xml;q=0.9",
      "User-Agent": config.request.userAgent,
    },
    signal: AbortSignal.timeout(config.request.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchTextFromUrl(url, config, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html, application/xhtml+xml;q=0.9",
      "User-Agent": config.request.userAgent,
    },
    signal: AbortSignal.timeout(config.request.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

function maxGhesVersion(versions) {
  return versions.reduce((max, value) => (compareGhesVersions(value, max) > 0 ? value : max));
}

/**
 * Discovers GHES versions present in the release index but not yet modeled
 * in the catalog (newer than the configured baseline). For each discovered
 * version this always produces one "version discovered" candidate entry
 * (regardless of whether its release notes could be retrieved) plus, when
 * retrievable, per-release candidates (feature candidate/stable/patch) for
 * that version's release notes, each marked as an unmodeled version.
 *
 * The templated release-notes URL is only ever built from a checked-in
 * template plus a version string already validated as `major.minor` by the
 * index table parser, and is re-validated against the authoritative
 * GitHub Docs host/path allow-list immediately before any fetch — this keeps
 * dynamically followed URLs from becoming an SSRF surface.
 *
 * Fetch failures here are handled per-version and never counted against the
 * ingestion-level `errors` that gate GitHub mutations: a version that cannot
 * be documented still gets its own review issue defaulting to unavailable,
 * rather than aborting the entire run.
 */
async function discoverGhesEntries({config, ingestion, fixtureSources, fetchImpl}) {
  const ghesRelease = config.ghesRelease;
  if (!ghesRelease) {
    return [];
  }
  const indexSource = ingestion.sources.find((source) => source.id === ghesRelease.indexSourceId);
  const rows = indexSource?.versions ?? [];
  const staticVersions = new Set(
    config.sources.filter((source) => source.version).map((source) => source.version),
  );
  const maxModeled = maxGhesVersion(ghesRelease.modeledVersions);
  const discoveredRows = rows
    .filter((row) => compareGhesVersions(row.version, maxModeled) > 0)
    .filter((row) => !staticVersions.has(row.version))
    .slice(0, ghesRelease.maxDiscoveredVersions ?? 5);

  const entries = [];
  for (const row of discoveredRows) {
    let fetchError = null;
    let releaseEntries = [];
    try {
      const url = ghesRelease.releaseNotesUrlTemplate.replace("{version}", row.version);
      assertAllowedDocsUrl(url, ghesRelease);
      const raw = fixtureSources && Object.hasOwn(fixtureSources, url)
        ? fixtureSources[url]
        : await fetchTextFromUrl(url, config, fetchImpl);
      const pseudoSource = {
        id: `ghes-discovered-${row.version}`,
        label: `GitHub Enterprise Server ${row.version} release notes (discovered)`,
        url,
        deployments: ["ghes"],
        version: row.version,
        headingLevels: [2],
        kind: "html-sections",
      };
      releaseEntries = ingestSourceContent(pseudoSource, raw)
        .map((entry) => ({...entry, discoveredVersion: true}));
    } catch (error) {
      fetchError = error instanceof Error ? error : new Error(String(error));
    }
    entries.push(
      buildVersionDiscoveredEntry(row, ghesRelease, ghesRelease.indexSourceId, fetchError),
    );
    entries.push(...releaseEntries);
  }
  return entries;
}

export async function runProductWatch({
  config,
  repository,
  token,
  dryRun,
  fixtureSources = null,
  fetchImpl = fetch,
  githubClient = null,
  now = () => new Date(),
}) {
  const retrievedAt = now().toISOString();
  const ingestion = await ingestConfiguredSources(config, async (source) => {
    if (fixtureSources) {
      if (!(source.id in fixtureSources)) {
        throw new Error(`Missing fixture content for ${source.id}`);
      }
      return fixtureSources[source.id];
    }
    return fetchText(source, config, fetchImpl);
  });
  const discoveryEntries = ingestion.errors.length === 0
    ? await discoverGhesEntries({config, ingestion, fixtureSources, fetchImpl})
    : [];
  const candidates = buildCandidates([...ingestion.entries, ...discoveryEntries], config)
    .map((candidate) => ({...candidate, retrievedAt}));
  const report = {
    schemaVersion: 1,
    runId: sha256(`${repository}|${retrievedAt}`).slice(0, 16),
    repository,
    retrievedAt,
    dryRun,
    status: ingestion.errors.length > 0 ? "partial-source-failure" : "pending",
    sources: ingestion.sources,
    errors: ingestion.errors,
    scannedEntryCount: ingestion.entries.length + discoveryEntries.length,
    candidateCount: candidates.length,
    candidates,
    actions: [],
    stateAdvanced: false,
  };

  if (ingestion.errors.length > 0) {
    return report;
  }

  if (!dryRun && !token && !githubClient) {
    report.status = "mutation-failure";
    report.errors.push({
      sourceId: "github",
      message: "GITHUB_TOKEN is required when dry-run is disabled",
    });
    return report;
  }

  const client = githubClient ?? (
    token ? createGitHubClient({token, repository, fetchImpl}) : null
  );

  let stateIssue = null;
  let reviewIssues = [];
  let previousState = {
    schemaVersion: 1,
    lastSuccessfulScan: null,
    sources: {},
    fingerprints: [],
  };
  try {
    if (client) {
      const [stateIssues, issues] = await Promise.all([
        client.listIssues(config.state.issueLabel),
        client.listIssues(config.state.reviewLabel),
      ]);
      stateIssue = stateIssues.find((issue) => issue.title === config.state.issueTitle) ?? null;
      reviewIssues = issues;
      if (stateIssue) {
        previousState = parseState(stateIssue.body);
      }
    }

    const actions = planIssueActions(
      candidates,
      reviewIssues,
      previousState.fingerprints,
    );
    report.actions = actions.map((action) => ({
      type: action.type,
      reason: action.reason ?? null,
      candidateKey: action.candidate.candidateKey,
      fingerprint: action.candidate.fingerprint,
      title: action.candidate.title,
      issueNumber: action.issue?.number ?? null,
      issueUrl: action.issue?.html_url ?? null,
    }));

    if (dryRun) {
      report.status = "dry-run";
      return report;
    }

    await Promise.all([
      client.ensureLabel(
        config.state.reviewLabel,
        "1f6feb",
        "Deterministic GitHub product-change review candidate",
      ),
      client.ensureLabel(
        config.state.issueLabel,
        "6e7781",
        "Managed state for the GitHub product-watch workflow",
      ),
    ]);

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (action.type === "skip") {
        continue;
      }
      if (action.type === "create") {
        const issue = await client.createIssue({
          title: titleFor(action.candidate),
          body: renderIssueBody(action.candidate),
          labels: [config.state.reviewLabel],
        });
        report.actions[index].issueNumber = issue.number;
        report.actions[index].issueUrl = issue.html_url;
      } else {
        const issue = await client.updateIssue(action.issue.number, {
          title: titleFor(action.candidate),
          body: renderIssueBody(action.candidate, action.issue.body),
          state: "open",
        });
        report.actions[index].issueNumber = issue.number;
        report.actions[index].issueUrl = issue.html_url;
      }
    }

    const nextState = buildNextState(
      previousState,
      candidates,
      ingestion.sources,
      retrievedAt,
      config.state.maxFingerprints,
    );
    const stateBody = renderStateBody(nextState);
    if (stateIssue) {
      await client.updateIssue(stateIssue.number, {
        title: config.state.issueTitle,
        body: stateBody,
        state: "open",
      });
    } else {
      stateIssue = await client.createIssue({
        title: config.state.issueTitle,
        body: stateBody,
        labels: [config.state.issueLabel],
      });
    }
    report.stateIssueNumber = stateIssue.number;
    report.stateIssueUrl = stateIssue.html_url;
    report.stateAdvanced = true;
    report.status = "success";
    return report;
  } catch (error) {
    report.status = "mutation-failure";
    report.errors.push({
      sourceId: "github",
      message: error instanceof Error ? error.message : String(error),
    });
    return report;
  }
}

export function existingIssueSummary(issue) {
  return {
    number: issue.number,
    title: issue.title,
    htmlUrl: issue.html_url,
    ...parseIssueMarkers(issue.body),
  };
}
