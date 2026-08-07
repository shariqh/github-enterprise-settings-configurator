import { createHash } from "node:crypto";

const DEFAULT_DATE = "1970-01-01T00:00:00.000Z";
const MAX_EVIDENCE_CHARS = 12000;

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeEntities(value) {
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

export function stripMarkup(value) {
  const decoded = decodeEntities(value);
  return normalizeWhitespace(
    decodeEntities(
      decoded
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(normalizeWhitespace(value));
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || key === "ref" || key === "source") {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return normalizeWhitespace(value);
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function extractXmlTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match?.[1] ?? "";
}

export function parseRss(raw, source) {
  const blocks = String(raw).match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return blocks.map((block) => {
    const title = stripMarkup(extractXmlTag(block, "title"));
    const url = canonicalizeUrl(stripMarkup(extractXmlTag(block, "link")));
    const guid = stripMarkup(extractXmlTag(block, "guid"));
    const summary = stripMarkup(
      extractXmlTag(block, "description") || extractXmlTag(block, "content:encoded"),
    );
    const publishedAt = toIsoDate(stripMarkup(extractXmlTag(block, "pubDate")));
    return {
      id: url || guid || `${source.url}#${slugify(title)}`,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      title,
      url: url || source.url,
      publishedAt,
      summary,
      deployments: source.deployments ?? [],
      sourceVersion: source.version ?? null,
    };
  });
}

export function parseHtmlSections(raw, source) {
  const documentHtml = String(raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const mainMatch = documentHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const html = mainMatch?.[1] ?? documentHtml;
  const titleMatch = documentHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const documentTitle = stripMarkup(titleMatch?.[1] ?? source.label);
  const levels = source.headingLevels ?? [2, 3];
  const headingPattern = new RegExp(
    `<h(${levels.join("|")})\\b[^>]*>([\\s\\S]*?)<\\/h\\1>`,
    "gi",
  );
  const headings = [...html.matchAll(headingPattern)];

  if (headings.length === 0) {
    const summary = stripMarkup(html);
    return [{
      id: source.url,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      title: documentTitle,
      url: source.url,
      publishedAt: null,
      summary,
      deployments: source.deployments ?? [],
      sourceVersion: source.version ?? null,
    }];
  }

  return headings.map((heading, index) => {
    const sectionTitle = stripMarkup(heading[2]).replace(/\s*\.\s*/g, ".");
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? html.length;
    const summary = stripMarkup(html.slice(start, end));
    const anchor = slugify(sectionTitle);
    const sectionId = `${anchor}-${sha256(sectionTitle.toLowerCase()).slice(0, 12)}`;
    return {
      id: `${source.url}#${sectionId}`,
      sourceId: source.id,
      sourceLabel: source.label,
      sourceUrl: source.url,
      title: sectionTitle || documentTitle,
      url: `${source.url}#${anchor}`,
      publishedAt: extractReleaseDate(summary),
      summary,
      deployments: source.deployments ?? [],
      sourceVersion: source.version ?? null,
    };
  });
}

export function parseHtmlPage(raw, source) {
  const documentHtml = String(raw)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const mainMatch = documentHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const titleMatch = documentHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = stripMarkup(titleMatch?.[1] ?? source.label);
  return [{
    id: source.url,
    sourceId: source.id,
    sourceLabel: source.label,
    sourceUrl: source.url,
    title,
    url: source.url,
    publishedAt: null,
    summary: stripMarkup(mainMatch?.[1] ?? documentHtml),
    deployments: source.deployments ?? [],
    sourceVersion: source.version ?? null,
  }];
}

function extractReleaseDate(value) {
  const match = String(value).match(/\brelease date:\s*(\d{4}-\d{2}-\d{2})\b/i);
  return match ? toIsoDate(`${match[1]}T00:00:00Z`) : null;
}

export function ingestSourceContent(source, raw) {
  let entries;
  if (source.kind === "rss") {
    entries = parseRss(raw, source);
  } else if (source.kind === "html-page") {
    entries = parseHtmlPage(raw, source);
  } else if (source.kind === "html-sections") {
    entries = parseHtmlSections(raw, source);
  } else {
    throw new Error(`Unsupported source kind: ${source.kind}`);
  }

  const baseline = toIsoDate(source.baselineReviewedThrough);
  return entries
    .filter((entry) => entry.title && entry.summary)
    .filter((entry) => !baseline || !entry.publishedAt || entry.publishedAt > baseline)
    .slice(0, source.maxEntries ?? Number.POSITIVE_INFINITY);
}

export async function ingestConfiguredSources(config, fetchSource) {
  const settled = await Promise.allSettled(
    config.sources.map(async (source) => {
      const raw = await fetchSource(source);
      const entries = ingestSourceContent(
        {...source, maxEntries: config.request.maxEntriesPerSource},
        raw,
      );
      return { source, entries };
    }),
  );

  const sources = [];
  const errors = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const source = config.sources[index];
    if (result.status === "fulfilled") {
      sources.push({
        id: source.id,
        label: source.label,
        url: source.url,
        status: "ok",
        entryCount: result.value.entries.length,
      });
    } else {
      const message = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      sources.push({
        id: source.id,
        label: source.label,
        url: source.url,
        status: "failed",
        entryCount: 0,
        error: message,
      });
      errors.push({ sourceId: source.id, message });
    }
  }

  const entries = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value.entries : []
  );
  return { entries, sources, errors };
}

function matchedValues(text, records, getPatterns = (record) => record.keywords ?? record.patterns ?? []) {
  return records
    .map((record) => ({
      record,
      patterns: getPatterns(record).filter((pattern) => text.includes(pattern.toLowerCase())),
    }))
    .filter(({patterns}) => patterns.length > 0);
}

function extractGhesVersion(text, entry) {
  if (entry.sourceVersion) {
    return entry.sourceVersion;
  }
  if (!/\b(?:ghes|github enterprise server)\b/i.test(text)) {
    return null;
  }
  const match = text.match(
    /(?:ghes|github enterprise server)[^\d]{0,20}(\d+\.\d+(?:\.\d+)?)/i,
  );
  return match?.[1] ?? null;
}

function normalizeEntry(entry) {
  const summary = normalizeWhitespace(entry.summary);
  const normalized = {
    ...entry,
    id: normalizeWhitespace(entry.id),
    title: normalizeWhitespace(entry.title),
    url: canonicalizeUrl(entry.url),
    summary,
    publishedAt: toIsoDate(entry.publishedAt),
  };
  const identity = `${normalized.sourceId}|${normalized.id || normalized.url}`;
  normalized.candidateKey = sha256(identity).slice(0, 24);
  normalized.fingerprint = sha256(JSON.stringify({
    sourceId: normalized.sourceId,
    id: normalized.id,
    title: normalized.title.toLowerCase(),
    url: normalized.url,
    publishedAt: normalized.publishedAt ?? DEFAULT_DATE,
    summary: normalized.summary.toLowerCase(),
  }));
  normalized.summaryTruncated = summary.length > MAX_EVIDENCE_CHARS;
  normalized.summary = normalized.summaryTruncated
    ? `${summary.slice(0, MAX_EVIDENCE_CHARS)}...`
    : summary;
  return normalized;
}

export function classifyEntry(rawEntry, config) {
  const entry = normalizeEntry(rawEntry);
  const text = `${entry.title} ${entry.summary}`.toLowerCase();
  const productMatches = matchedValues(text, config.products);
  const domainMatches = matchedValues(text, config.domains);
  const settings = [];
  const matchedRules = [];

  for (const {record: domain, patterns} of domainMatches) {
    matchedRules.push(...patterns.map((pattern) => `domain:${domain.id}:${pattern}`));
    for (const setting of domain.settings) {
      const settingPatterns = setting.keywords.filter((pattern) =>
        text.includes(pattern.toLowerCase())
      );
      if (settingPatterns.length > 0) {
        settings.push(setting.id);
        matchedRules.push(
          ...settingPatterns.map((pattern) => `setting:${setting.id}:${pattern}`),
        );
      }
    }
  }
  for (const {record: product, patterns} of productMatches) {
    matchedRules.push(...patterns.map((pattern) => `product:${product.id}:${pattern}`));
  }

  const changeTypeMatches = matchedValues(text, config.changeTypes);
  const changeTypes = changeTypeMatches.length > 0
    ? changeTypeMatches.map(({record}) => record.id)
    : ["documentation-clarification"];
  for (const {record, patterns} of changeTypeMatches) {
    matchedRules.push(...patterns.map((pattern) => `change:${record.id}:${pattern}`));
  }

  const releaseStageMatch = matchedValues(text, config.releaseStages)[0];
  const releaseStage = releaseStageMatch?.record.id ?? "unspecified";
  if (releaseStageMatch) {
    matchedRules.push(
      ...releaseStageMatch.patterns.map(
        (pattern) => `release-stage:${releaseStage}:${pattern}`,
      ),
    );
  }

  const configuredDeployments = new Set(entry.deployments);
  const deploymentMatches = Object.entries(config.deploymentKeywords)
    .filter(([, patterns]) => patterns.some((pattern) => text.includes(pattern)))
    .map(([deployment]) => deployment);
  const deployments = deploymentMatches.length > 0
    ? deploymentMatches.filter((deployment) => configuredDeployments.has(deployment))
    : [...configuredDeployments];

  const plans = Object.entries(config.planKeywords)
    .filter(([, patterns]) => patterns.some((pattern) => text.includes(pattern)))
    .map(([plan]) => plan);
  const impactSurfaces = matchedValues(text, config.impactSurfaces)
    .map(({record}) => record.id);
  if (impactSurfaces.length === 0) {
    impactSurfaces.push("documentation-only");
  }

  const ghesVersion = extractGhesVersion(text, entry);
  const relevant = domainMatches.length > 0 || productMatches.length > 0;
  const confidence = settings.length > 0 && changeTypeMatches.length > 0
    ? "high"
    : relevant
      ? "medium"
      : "low";

  return {
    ...entry,
    relevant,
    products: productMatches.map(({record}) => record.label),
    domains: domainMatches.map(({record}) => record.label),
    settingIds: [...new Set(settings)].sort(),
    changeTypes: [...new Set(changeTypes)],
    releaseStage,
    versionSpecific: Boolean(ghesVersion),
    ghesVersion,
    deployments: [...new Set(deployments)],
    plans: [...new Set(plans)],
    impactSurfaces: [...new Set(impactSurfaces)],
    confidence,
    matchedRules: [...new Set(matchedRules)].sort(),
  };
}

export function buildCandidates(entries, config) {
  return entries
    .map((entry) => classifyEntry(entry, config))
    .filter((candidate) => candidate.relevant)
    .sort((left, right) => {
      const dateCompare = (left.publishedAt ?? DEFAULT_DATE)
        .localeCompare(right.publishedAt ?? DEFAULT_DATE);
      return dateCompare || left.title.localeCompare(right.title);
    });
}

export function validateConfig(config) {
  if (config?.schemaVersion !== 1) {
    throw new Error(`Unsupported product-watch schemaVersion: ${config?.schemaVersion}`);
  }
  if (
    !Number.isInteger(config.state.maxFingerprints)
    || config.state.maxFingerprints < 1
    || config.state.maxFingerprints > 700
  ) {
    throw new Error("state.maxFingerprints must be an integer between 1 and 700");
  }
  for (const field of ["state", "request", "sources", "products", "domains", "changeTypes"]) {
    if (!config[field]) {
      throw new Error(`Missing product-watch config field: ${field}`);
    }
  }
  const sourceIds = new Set();
  for (const source of config.sources) {
    if (!source.id || !source.url || !source.kind || sourceIds.has(source.id)) {
      throw new Error(`Invalid or duplicate source definition: ${source.id ?? "<missing>"}`);
    }
    sourceIds.add(source.id);
  }
  return config;
}

export function parseIssueMarkers(body = "") {
  return {
    candidateKey: body.match(/<!-- product-watch:key:([a-f0-9]+) -->/)?.[1] ?? null,
    fingerprint: body.match(/<!-- product-watch:fingerprint:([a-f0-9]+) -->/)?.[1] ?? null,
  };
}

export function planIssueActions(candidates, issues, knownFingerprints = []) {
  const known = new Set(knownFingerprints);
  const issuesByKey = new Map(
    issues
      .map((issue) => ({issue, markers: parseIssueMarkers(issue.body)}))
      .filter(({markers}) => markers.candidateKey)
      .map(({issue, markers}) => [markers.candidateKey, {issue, markers}]),
  );

  return candidates.map((candidate) => {
    const existing = issuesByKey.get(candidate.candidateKey);
    if (existing?.markers.fingerprint === candidate.fingerprint) {
      return {type: "skip", reason: "existing-issue", candidate, issue: existing.issue};
    }
    if (!existing && known.has(candidate.fingerprint)) {
      return {type: "skip", reason: "state-fingerprint", candidate, issue: null};
    }
    if (existing) {
      return {type: "update", candidate, issue: existing.issue};
    }
    return {type: "create", candidate, issue: null};
  });
}

function list(values, empty = "None identified") {
  return values.length > 0 ? values.join(", ") : empty;
}

export function renderIssueBody(candidate, existingBody = "") {
  const notesMarker = "<!-- product-watch:human-notes -->";
  const existingNotesIndex = existingBody.indexOf(notesMarker);
  const existingNotes = existingNotesIndex >= 0
    ? existingBody
      .slice(existingNotesIndex + notesMarker.length)
      .replace(/^\s*## Human notes\s*/i, "")
      .replace(
        /^_Add reviewer notes below this line; product-watch updates preserve this section\._\s*/i,
        "",
      )
      .trim()
    : "";
  const publication = candidate.publishedAt ?? "No publication date exposed by source";
  const retrieved = candidate.retrievedAt ?? "Recorded in the product-watch report";

  return `<!-- product-watch:key:${candidate.candidateKey} -->
<!-- product-watch:fingerprint:${candidate.fingerprint} -->
<!-- product-watch:managed -->
# Product-change review

> This is a deterministic review candidate. The automation does not edit catalog, recommendation, persistence, scoring, or application code.

## Source evidence

| Field | Value |
| --- | --- |
| Source | ${candidate.sourceLabel} |
| Entry | [${candidate.title}](${candidate.url}) |
| Published or updated | ${publication} |
| Retrieved | ${retrieved} |
| Fingerprint | \`${candidate.fingerprint}\` |

${candidate.summary}
${candidate.summaryTruncated ? "\n\n_Evidence excerpt truncated; use the source link and report artifact for the complete normalized entry._" : ""}

## Suspected impact

| Field | Classification |
| --- | --- |
| Products | ${list(candidate.products)} |
| Catalog domains | ${list(candidate.domains)} |
| Catalog setting IDs | ${list(candidate.settingIds.map((id) => `\`${id}\``))} |
| Change types | ${list(candidate.changeTypes)} |
| Release stage | ${candidate.releaseStage} |
| Version-specific | ${candidate.versionSpecific ? `Yes${candidate.ghesVersion ? ` — GHES ${candidate.ghesVersion}` : ""}` : "No"} |
| Deployments | ${list(candidate.deployments)} |
| Product plans | ${list(candidate.plans)} |
| Possible catalog surfaces | ${list(candidate.impactSurfaces)} |
| Confidence | ${candidate.confidence} |

<details>
<summary>Matched deterministic rules</summary>

${candidate.matchedRules.map((rule) => `- \`${rule}\``).join("\n") || "- No explicit rule match"}
</details>

## Human disposition

Select one disposition and record supporting notes:

- [ ] Update required
- [ ] No impact
- [ ] Already covered
- [ ] Defer until GA
- [ ] Needs product SME

Review whether this changes applicability, recommendation logic, choices, API or automation mapping, scoring or effort metadata, or documentation only. Close the issue once disposition and any follow-up issue or pull request are linked.

${notesMarker}
## Human notes

${existingNotes || "_Add reviewer notes below this line; product-watch updates preserve this section._"}
`;
}

export function renderReportMarkdown(report) {
  const actionCounts = Object.groupBy(
    report.actions ?? [],
    (action) => action.type,
  );
  const count = (type) => actionCounts[type]?.length ?? 0;
  const lines = [
    "# GitHub product watch",
    "",
    `**Status:** ${report.status}`,
    `**Dry run:** ${report.dryRun ? "yes" : "no"}`,
    `**Retrieved:** ${report.retrievedAt}`,
    "",
    `Sources: ${report.sources.filter((source) => source.status === "ok").length}/${report.sources.length} successful`,
    `Candidates: ${report.candidateCount}`,
    `Actions: ${count("create")} create, ${count("update")} update, ${count("skip")} skip`,
  ];
  if (report.errors.length > 0) {
    lines.push("", "## Source failures", "");
    lines.push(...report.errors.map((error) => `- **${error.sourceId}:** ${error.message}`));
  }
  return `${lines.join("\n")}\n`;
}
