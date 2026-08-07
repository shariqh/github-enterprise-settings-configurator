# GitHub product watch

The product watch is a deterministic review aid for maintaining this configurator as GitHub products change. It gathers configured public sources, normalizes and fingerprints entries, classifies likely catalog impact, and opens or updates human-review issues. It never edits application, catalog, recommendation, persistence, or scoring code.

## Workflow behavior

`.github/workflows/product-watch.yml` runs daily and can be dispatched manually. Manual runs default to dry-run mode. The workflow has only `contents: read` and `issues: write` permissions (set at both the workflow and job level), a 15-minute timeout, and pins every referenced action to a full-length immutable commit SHA with a version comment.

Each run:

1. Loads the versioned watch configuration from `config/v2.json` (the current baseline). `config/v1.json` remains untouched and reproducible for historical runs.
2. Fetches all configured sources concurrently with a bounded timeout.
3. Parses RSS items, a Docs page's main content, configured HTML heading sections, or the GHES all-releases index table into a common entry shape.
4. Normalizes text and URLs and calculates a SHA-256 fingerprint.
5. Applies checked-in keyword rules for products, catalog domains and setting IDs, change types, release stage, deployments, plans, and possible catalog surfaces.
6. When all configured sources succeed, discovers GHES versions present in the release index but newer than the modeled baseline, and attempts to fetch their release notes from an authoritative, allow-listed URL.
7. Stops before any GitHub mutation if any statically configured source failed.
8. Plans create, update, or skip actions by comparing stable candidate and fingerprint markers with existing review issues and the state issue.
9. In non-dry-run mode, creates or updates evidence-rich issues and advances the state issue only after all issue mutations succeed.
10. Uploads a JSON report and Markdown summary even when the scan fails.

Exact repeats are skipped. When the same source entry changes, its managed issue content is refreshed and a closed issue is reopened. Text below the `product-watch:human-notes` marker is preserved.

## Sources and watch rules

The `config/v2.json` configuration currently tracks:

- GitHub Changelog RSS
- GitHub Docs for security configurations
- GitHub Docs for REST API versions
- Version-specific GHES 3.21 release notes (the modeled baseline)
- The GHES all-releases index, used only for release discovery (see below)

Add a source to `sources` with a stable ID, label, adapter kind (`rss`, `html-page`, `html-sections`, or `ghes-release-index`), public URL, and supported deployments. `html-page` excludes surrounding navigation when a `<main>` element is available. For release notes, `html-sections` accepts `headingLevels` so the watch can fingerprint releases without opening an issue for every subsection. Use `baselineReviewedThrough` for a dated feed whose older entries have already been reviewed.

Add product, domain, setting, lifecycle, or impact keywords to the corresponding versioned rule collection. Catalog setting IDs are strings in this configuration so product-watch remains independent of runtime catalog code. Rule changes require fixture updates when expected classifications change.

Public preview, private preview, release candidate, GA, deprecation, and version-specific GHES changes are separate classifications. A candidate may have multiple change types, such as both `deprecation` and `api-change`.

## GHES release discovery

`config/v2.json` adds a `ghesRelease` block that models GHES 3.21 as the current baseline and enables daily, evidence-backed discovery of newer versions from the official GHES all-releases index (`.../admin/all-releases`) plus per-version release notes:

- `modeledVersions` lists the `major.minor` versions this catalog currently models (currently `["3.21"]`).
- `indexSourceId` points at the configured `ghes-release-index` source that supplies release-index metadata.
- `releaseNotesUrlTemplate` is a checked-in URL template (with a `{version}` placeholder) used to build a discovered version's release-notes URL.
- `allowedHosts` and `allowedPathPrefix` restrict every dynamically constructed or statically configured GHES URL to authoritative GitHub Docs hosts and paths.
- `maxDiscoveredVersions` bounds how many newly discovered versions are processed per run.

Every GHES-related candidate is tagged with one of five distinct candidate types (`ghesCandidateType`):

- `ghes-feature-release-candidate` — a pre-GA release candidate for a feature release.
- `ghes-feature-release-stable` — a GA feature release (`x.y.0`).
- `ghes-patch-release` — a patch release (`x.y.z`, `z > 0`).
- `ghes-lifecycle-change` — a tracked version's candidate/release/closing-down/support status from the all-releases index.
- `ghes-version-discovered` — a version present in the index but not yet modeled in the catalog.

**Default-no evidence policy.** A newly discovered or insufficiently documented version always produces a `ghes-version-discovered` review issue, even when its release notes could not be retrieved — the issue text distinguishes "not documented" (fetch or parse failure) from an explicit "not supported" status in the index, but both resolve to an effective **unavailable/unmodeled** posture until a human reviews authoritative evidence and updates the catalog. This automation never enables an application capability automatically; only lifecycle entries for the modeled baseline and versions newer than it are generated, so older superseded versions do not produce daily noise.

**No SSRF surface.** The only URLs product-watch ever fetches are (1) the statically configured source URLs already checked into `config/v2.json`, and (2) a discovered version's release-notes URL, which is built from the checked-in `releaseNotesUrlTemplate` and a version string that has already been validated as `^\d+\.\d+$` by the index table parser. Both are re-validated by `assertAllowedDocsUrl` (HTTPS, and both hostname and path prefix present in `ghesRelease.allowedHosts` / `allowedPathPrefix`) immediately before any request. The index table's own `href` links are never followed — they are recorded only as reference text in issue bodies.

## Local use

Run the tests:

```bash
pnpm product-watch:test
```

Run a deterministic fixture scan without network or credentials:

```bash
pnpm product-watch -- \
  --config tooling/product-watch/config/v2.json \
  --fixture tooling/product-watch/fixtures/source-payloads.json \
  --dry-run true
```

Run a live dry run:

```bash
GITHUB_REPOSITORY=owner/repository \
GITHUB_TOKEN="$(gh auth token)" \
pnpm product-watch -- --config tooling/product-watch/config/v2.json --dry-run true
```

`GITHUB_TOKEN` is optional for a local dry run, but supplying it allows dedupe planning against existing issues. It is required for a non-dry run.

## State and failure safety

The workflow manages two labels:

- `product-watch:review` for human-review candidates
- `product-watch:state` for the single state issue

The state issue stores the last fully successful scan, per-source markers, and a bounded list of recent fingerprints. A partial source failure creates no issues and does not advance state. A GitHub mutation failure may leave already-created review issues, but it does not advance state; the next run finds their markers and safely skips or updates them.

Generated issues always contain source evidence, suspected catalog impact, confidence and matched rules, the dedupe fingerprint, and this disposition checklist:

- Update required
- No impact
- Already covered
- Defer until GA
- Needs product SME

The reviewer remains responsible for deciding whether and how the catalog should change.
