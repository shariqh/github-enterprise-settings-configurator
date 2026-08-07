import {parseIssueMarkers as parseProducerIssueMarkers} from "../../product-watch/lib/core.mjs";

export const REVIEW_LABEL = "product-watch:review";
export const MAX_ISSUES_PER_RUN = 5;
export const MAX_COMMENT_CHARS = 60000;
export const MAX_EVIDENCE_URLS_PER_COMMENT = 8;
export const MAX_EVIDENCE_URLS_PER_BATCH = 20;
export const EVALUATION_MARKER_PREFIX = "product-watch:agent-evaluation";
export const EVALUATION_WORKFLOW_ID = "copilot-product-watch-evaluation";
export const EVALUATION_WORKFLOW_MARKER =
  `<!-- gh-aw-workflow-id: ${EVALUATION_WORKFLOW_ID} -->`;

const CANDIDATE_KEY_PATTERN = /^[a-f0-9]{24}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const MANAGED_MARKER = "<!-- product-watch:managed -->";
const EVALUATION_MARKER_PATTERN =
  /<!--\s*product-watch:agent-evaluation:([^>]*)-->/g;

function labelName(label) {
  return typeof label === "string" ? label : label?.name;
}

export function parseProductWatchMarkers(body = "") {
  const text = String(body);
  const producerMarkers = parseProducerIssueMarkers(text);
  return {
    candidateKey: CANDIDATE_KEY_PATTERN.test(producerMarkers.candidateKey ?? "")
      ? producerMarkers.candidateKey
      : null,
    fingerprint: FINGERPRINT_PATTERN.test(producerMarkers.fingerprint ?? "")
      ? producerMarkers.fingerprint
      : null,
    managed: text.includes(MANAGED_MARKER),
  };
}

export function isManagedReviewIssue(issue) {
  if (!issue || issue.state !== "open" || issue.pull_request) {
    return false;
  }

  const hasReviewLabel = (issue.labels ?? []).some(
    (label) => labelName(label) === REVIEW_LABEL,
  );
  if (!hasReviewLabel) {
    return false;
  }

  const markers = parseProductWatchMarkers(issue.body);
  return Boolean(markers.candidateKey && markers.fingerprint && markers.managed);
}

export function evaluationMarker(fingerprint) {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error("Evaluation markers require a 64-character lowercase hexadecimal fingerprint.");
  }
  return `<!-- ${EVALUATION_MARKER_PREFIX}:${fingerprint} -->`;
}

export function evaluatedFingerprints(comments = []) {
  const fingerprints = new Set();
  const pattern = new RegExp(
    `<!--\\s*${EVALUATION_MARKER_PREFIX}:([a-f0-9]{64})\\s*-->`,
    "g",
  );

  for (const comment of comments) {
    const body = String(comment?.body ?? "");
    const login = comment?.user?.login;
    const isGitHubActionsBot = comment?.user?.type === "Bot"
      && (login === "github-actions" || login === "github-actions[bot]");
    if (
      !isGitHubActionsBot
      || !body.includes(EVALUATION_WORKFLOW_MARKER)
    ) {
      continue;
    }
    const markers = [...body.matchAll(pattern)];
    if (markers.length === 1) {
      fingerprints.add(markers[0][1]);
    }
  }

  return fingerprints;
}

function compareIssues(left, right) {
  const updated = String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
  return updated || Number(left.number) - Number(right.number);
}

export function selectIssuesForEvaluation(
  issues,
  commentsByIssue = new Map(),
  limit = MAX_ISSUES_PER_RUN,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ISSUES_PER_RUN) {
    throw new Error(`Evaluation limit must be between 1 and ${MAX_ISSUES_PER_RUN}.`);
  }

  return issues
    .filter(isManagedReviewIssue)
    .sort(compareIssues)
    .filter((issue) => {
      const {fingerprint} = parseProductWatchMarkers(issue.body);
      return !evaluatedFingerprints(commentsByIssue.get(issue.number)).has(fingerprint);
    })
    .slice(0, limit)
    .map((issue) => {
      const markers = parseProductWatchMarkers(issue.body);
      return {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        candidateKey: markers.candidateKey,
        fingerprint: markers.fingerprint,
        body: issue.body,
      };
    });
}

export function enforceEvidenceDefaults(evaluation) {
  const normalized = {...evaluation};
  if (
    normalized.evidenceVerdict === "not documented"
    || normalized.evidenceVerdict === "unsupported"
  ) {
    normalized.effectiveDefault = "no";
    normalized.effectiveAvailability = "no";
  }
  return normalized;
}

const REQUIRED_COMMENT_FIELDS = [
  "Affected deployments / GHES versions",
  "Affected settings / files",
  "Confidence",
  "Missing evidence",
  "Recommended human disposition",
  "Suggested implementation scope",
  "Authoritative evidence",
];

function fieldValues(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...body.matchAll(new RegExp(`^\\*\\*${escaped}:\\*\\*\\s*(.+)$`, "gmi"))]
    .map((match) => match[1].trim());
}

function fieldValue(body, label) {
  const values = fieldValues(body, label);
  if (values.length !== 1) {
    throw new Error(`Comment must contain the ${label} field exactly once.`);
  }
  return values[0];
}

export function validateEvaluationComment(body, fingerprint) {
  const rawText = String(body ?? "");
  if (rawText.length > MAX_COMMENT_CHARS) {
    throw new Error(`Comment body must not exceed ${MAX_COMMENT_CHARS} characters.`);
  }
  const text = decodeReferenceEntities(rawText);
  if (text.length > MAX_COMMENT_CHARS) {
    throw new Error(`Canonical comment body must not exceed ${MAX_COMMENT_CHARS} characters.`);
  }
  if (text.includes(EVALUATION_WORKFLOW_MARKER)) {
    throw new Error("Workflow identity marker is added by the safe-output job.");
  }
  rejectRichLinkSyntax(text);
  const markers = [...text.matchAll(EVALUATION_MARKER_PATTERN)];
  if (
    markers.length !== 1
    || markers[0][0] !== evaluationMarker(fingerprint)
  ) {
    throw new Error("Comment must contain the exact evaluation marker once.");
  }

  const evidenceVerdict = fieldValue(text, "Evidence verdict");
  const effectiveDefault = fieldValue(text, "Effective default");
  const effectiveAvailability = fieldValue(text, "Effective availability");
  if (!["supported", "unsupported", "not documented"].includes(evidenceVerdict)) {
    throw new Error("Evidence verdict must be supported, unsupported, or not documented.");
  }
  if (!["yes", "no"].includes(effectiveDefault)) {
    throw new Error("Effective default must be yes or no.");
  }
  if (!["yes", "no"].includes(effectiveAvailability)) {
    throw new Error("Effective availability must be yes or no.");
  }
  if (
    (evidenceVerdict === "not documented" || evidenceVerdict === "unsupported")
    && (effectiveDefault !== "no" || effectiveAvailability !== "no")
  ) {
    throw new Error("Unsupported or not documented evidence must keep default and availability at no.");
  }

  for (const label of REQUIRED_COMMENT_FIELDS) {
    if (!fieldValue(text, label)) {
      throw new Error(`Comment is missing the required ${label} field.`);
    }
  }
  if (!["high", "medium", "low"].includes(fieldValue(text, "Confidence"))) {
    throw new Error("Confidence must be high, medium, or low.");
  }
  if (![
    "Update required",
    "No impact",
    "Already covered",
    "Defer until GA",
    "Needs product SME",
  ].includes(fieldValue(text, "Recommended human disposition"))) {
    throw new Error("Recommended human disposition must use a product-watch disposition.");
  }

  const allUrls = extractCommentUrls(text);
  for (const value of allUrls) {
    if (!isAllowedAuthoritativeUrl(value) && !isGitHubCrossReferenceUrl(value)) {
      throw new Error(`Comment URL is not an allowed authoritative GitHub source: ${value}`);
    }
  }

  const fieldEvidenceUrls = extractCommentUrls(fieldValue(text, "Authoritative evidence"))
    .filter(isAllowedAuthoritativeUrl);
  if (fieldEvidenceUrls.length === 0) {
    throw new Error("Authoritative evidence must include a GitHub Docs, Changelog, or GitHub-maintained source URL.");
  }
  const affirmative = evidenceVerdict === "supported"
    || effectiveDefault === "yes"
    || effectiveAvailability === "yes";
  if (affirmative && !fieldEvidenceUrls.some(isAuthoritativeDocsUrl)) {
    throw new Error("Affirmative support requires an authoritative GitHub Docs URL.");
  }
  const evidenceUrls = allUrls.filter(isAllowedAuthoritativeUrl);
  if (evidenceUrls.length > MAX_EVIDENCE_URLS_PER_COMMENT) {
    throw new Error(
      `Comment may cite at most ${MAX_EVIDENCE_URLS_PER_COMMENT} distinct authoritative URLs.`,
    );
  }

  return {
    evidenceVerdict,
    effectiveDefault,
    effectiveAvailability,
    evidenceUrls,
    affirmative,
    canonicalText: text,
  };
}

export function validateCommentRequests(requests, allowedIssues) {
  if (!Array.isArray(requests) || requests.length > MAX_ISSUES_PER_RUN) {
    throw new Error(`At most ${MAX_ISSUES_PER_RUN} comment requests are allowed.`);
  }

  const allowedByNumber = new Map(
    allowedIssues.map((issue) => [String(issue.number), issue]),
  );
  const seen = new Set();
  const comments = requests.map((request) => {
    const issueNumber = String(request.issue_number ?? "");
    const issue = allowedByNumber.get(issueNumber);
    if (!issue) {
      throw new Error(`Issue ${issueNumber || "(missing)"} is not in the live evaluation allowlist.`);
    }
    if (seen.has(issueNumber)) {
      throw new Error(`Only one comment is allowed for issue ${issueNumber}.`);
    }
    seen.add(issueNumber);
    const evaluation = validateEvaluationComment(request.body, issue.fingerprint);
    const body = neutralizeGitHubReferences(evaluation.canonicalText.trim());
    if (body.length > MAX_COMMENT_CHARS) {
      throw new Error(`Sanitized comment body must not exceed ${MAX_COMMENT_CHARS} characters.`);
    }
    const finalBody = `${body}\n\n${EVALUATION_WORKFLOW_MARKER}`;
    if (finalBody.length > MAX_COMMENT_CHARS) {
      throw new Error(`Final comment body must not exceed ${MAX_COMMENT_CHARS} characters.`);
    }
    const finalMarkers = [...finalBody.matchAll(EVALUATION_MARKER_PATTERN)];
    if (
      finalMarkers.length !== 1
      || finalMarkers[0][0] !== evaluationMarker(issue.fingerprint)
    ) {
      throw new Error("Final comment must contain exactly one current evaluation marker.");
    }
    return {
      number: issue.number,
      body: finalBody,
      candidateKey: issue.candidateKey,
      fingerprint: issue.fingerprint,
      evidenceUrls: evaluation.evidenceUrls,
      affirmative: evaluation.affirmative,
    };
  });
  const batchUrls = new Set(comments.flatMap((comment) => comment.evidenceUrls));
  if (batchUrls.size > MAX_EVIDENCE_URLS_PER_BATCH) {
    throw new Error(
      `Comment batch may cite at most ${MAX_EVIDENCE_URLS_PER_BATCH} distinct authoritative URLs.`,
    );
  }
  return comments;
}

export function isAllowedAuthoritativeUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || url.pathname === "/"
    ) {
      return false;
    }
    if (url.hostname === "docs.github.com") {
      return true;
    }
    if (url.hostname === "github.blog") {
      return url.pathname.startsWith("/changelog/");
    }
    if (url.hostname === "github.com" && url.pathname.startsWith("/github/")) {
      return !/\/(?:issues|pull)\/\d+(?:\/|$)/.test(url.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function decodeReferenceEntitiesOnce(value) {
  return String(value)
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
      const codePoint = Number.parseInt(
        code.startsWith("x") || code.startsWith("X") ? code.slice(1) : code,
        code.startsWith("x") || code.startsWith("X") ? 16 : 10,
      );
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x7F
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&(?:colon|#0*58|#x0*3a);/gi, ":")
    .replace(/&(?:sol|#0*47|#x0*2f);/gi, "/")
    .replace(/&(?:bsol|#0*92|#x0*5c);/gi, "\\")
    .replace(/&(?:period|#0*46|#x0*2e);/gi, ".")
    .replace(/&(?:num|#0*35|#x0*23);/gi, "#")
    .replace(/&(?:commat|#0*64|#x0*40);/gi, "@")
    .replace(/&lbrack;/gi, "[")
    .replace(/&rbrack;/gi, "]")
    .replace(/&lpar;/gi, "(")
    .replace(/&rpar;/gi, ")")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/\\([^\w\s])/g, "$1");
}

function decodeReferenceEntities(value) {
  let current = String(value);
  for (let pass = 0; pass < 6; pass += 1) {
    const next = decodeReferenceEntitiesOnce(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
  if (decodeReferenceEntitiesOnce(current) !== current) {
    throw new Error("Comment contains excessively nested escape or entity encoding.");
  }
  return current;
}

function rejectRichLinkSyntax(value) {
  const decoded = decodeReferenceEntities(value);
  if (
    /[[\]]/.test(decoded)
    || /<\s*a\b/i.test(decoded)
    || /\b(?:href|src)\s*=/i.test(decoded)
    || /<(?:[a-z][a-z0-9+.-]*:|[^<>\s@]+@[^<>\s@]+)[^<>]*>/i.test(decoded)
    || /\b(?!https?:)[a-z][a-z0-9+.-]*:\/\/\S+/i.test(decoded)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(decoded)
  ) {
    throw new Error("Comments must use bare HTTPS URLs; rich links and email autolinks are not allowed.");
  }
}

function trimAutolinkPunctuation(value) {
  return value.replace(/[.,;:!?#[\]{}]+$/g, "");
}

function extractCommentUrls(value) {
  const decoded = decodeReferenceEntities(value);
  const urls = [];
  for (const match of decoded.matchAll(/\bhttps?:\/\/[^\s)>`"'<>\u005B\u005D]+/gi)) {
    urls.push(new URL(trimAutolinkPunctuation(match[0])).toString());
  }
  for (const match of decoded.matchAll(/(?:^|[\s("'=])(\/\/[^\s)>`"'<>\u005B\u005D]+)/g)) {
    urls.push(new URL(`https:${trimAutolinkPunctuation(match[1])}`).toString());
  }
  for (const match of decoded.matchAll(/\bwww\.[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[^\s)>`"'<>\u005B\u005D]*)?/gi)) {
    urls.push(new URL(`https://${trimAutolinkPunctuation(match[0])}`).toString());
  }
  return [...new Set(urls)];
}

function isGitHubCrossReferenceUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "github.com" || url.hostname === "www.github.com")
      && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/\d+(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function isAuthoritativeDocsUrl(value) {
  if (!isAllowedAuthoritativeUrl(value)) {
    return false;
  }
  const url = new URL(value);
  return url.hostname === "docs.github.com";
}

export function neutralizeGitHubReferences(value) {
  return decodeReferenceEntities(value)
    .replace(
      /(?:https?:)?\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)/gi,
      "https://github.com/$1/$2/$3/\u200B$4",
    )
    .replace(
      /(^|[\s(])\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/(issues|pull)\/(\d+)/g,
      "$1/$2/$3/$4/\u200B$5",
    )
    .replace(
      /(^|[^\w@])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/g,
      "$1@\u200B$2",
    )
    .replace(/\bGH-(\d+)\b/gi, "GH-\u200B$1")
    .replace(
      /\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)\b/g,
      "$1#\u200B$2",
    )
    .replace(/(^|[^\w])#(\d+)\b/g, "$1#\u200B$2");
}

export function validateLiveSelectedIssue(liveIssue, selectedIssue, comments = []) {
  if (!isManagedReviewIssue(liveIssue)) {
    throw new Error(`Selected issue ${selectedIssue.number} is no longer an open managed review issue.`);
  }
  const markers = parseProductWatchMarkers(liveIssue.body);
  if (
    Number(liveIssue.number) !== Number(selectedIssue.number)
    || markers.candidateKey !== selectedIssue.candidateKey
    || markers.fingerprint !== selectedIssue.fingerprint
  ) {
    throw new Error(`Selected issue ${selectedIssue.number} changed after selection.`);
  }
  if (evaluatedFingerprints(comments).has(selectedIssue.fingerprint)) {
    throw new Error(`Selected issue ${selectedIssue.number} was already evaluated during this run.`);
  }
  return true;
}
