export const REVIEW_LABEL = "product-watch:review";
export const MAX_ISSUES_PER_RUN = 5;
export const EVALUATION_MARKER_PREFIX = "product-watch:agent-evaluation";
export const EVALUATION_WORKFLOW_ID = "copilot-product-watch-evaluation";
export const EVALUATION_WORKFLOW_MARKER =
  `<!-- gh-aw-workflow-id: ${EVALUATION_WORKFLOW_ID} -->`;

const PRODUCT_WATCH_MARKER_PATTERN = {
  candidateKey: /<!-- product-watch:key:([a-f0-9]{64}) -->/,
  fingerprint: /<!-- product-watch:fingerprint:([a-f0-9]{64}) -->/,
  managed: /<!-- product-watch:managed -->/,
};

function labelName(label) {
  return typeof label === "string" ? label : label?.name;
}

export function parseProductWatchMarkers(body = "") {
  return {
    candidateKey: String(body).match(PRODUCT_WATCH_MARKER_PATTERN.candidateKey)?.[1] ?? null,
    fingerprint: String(body).match(PRODUCT_WATCH_MARKER_PATTERN.fingerprint)?.[1] ?? null,
    managed: PRODUCT_WATCH_MARKER_PATTERN.managed.test(String(body)),
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
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
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
    for (const match of body.matchAll(pattern)) {
      fingerprints.add(match[1]);
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
  if (normalized.evidenceVerdict === "not documented") {
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
  const text = String(body ?? "");
  const marker = evaluationMarker(fingerprint);
  if (text.split(marker).length !== 2) {
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
    evidenceVerdict === "not documented"
    && (effectiveDefault !== "no" || effectiveAvailability !== "no")
  ) {
    throw new Error("Not documented evidence must keep default and availability at no.");
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

  const evidenceUrls = fieldValue(text, "Authoritative evidence").match(/https:\/\/[^\s)]+/g) ?? [];
  const hasAuthoritativeUrl = evidenceUrls.some((value) => {
    const url = new URL(value);
    return url.hostname === "docs.github.com"
      || url.hostname === "github.blog"
      || (url.hostname === "github.com" && url.pathname.startsWith("/github/"));
  });
  if (!hasAuthoritativeUrl) {
    throw new Error("Authoritative evidence must include a GitHub Docs, Changelog, or GitHub-maintained source URL.");
  }

  return {
    evidenceVerdict,
    effectiveDefault,
    effectiveAvailability,
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
  return requests.map((request) => {
    const issueNumber = String(request.issue_number ?? "");
    const issue = allowedByNumber.get(issueNumber);
    if (!issue) {
      throw new Error(`Issue ${issueNumber || "(missing)"} is not in the live evaluation allowlist.`);
    }
    if (seen.has(issueNumber)) {
      throw new Error(`Only one comment is allowed for issue ${issueNumber}.`);
    }
    seen.add(issueNumber);
    validateEvaluationComment(request.body, issue.fingerprint);
    return {
      number: issue.number,
      body: `${String(request.body).trim()}\n\n${EVALUATION_WORKFLOW_MARKER}`,
    };
  });
}
