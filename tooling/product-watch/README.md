# GitHub product watch

The product watch is a deterministic review aid for maintaining this configurator as GitHub products change. It gathers configured public sources, normalizes and fingerprints entries, classifies likely catalog impact, and opens or updates human-review issues. It never edits application, catalog, recommendation, persistence, or scoring code.

## Workflow behavior

`.github/workflows/product-watch.yml` runs every Monday and can be dispatched manually. Manual runs default to dry-run mode. The workflow has only `contents: read` and `issues: write` permissions.

Each run:

1. Loads the versioned watch configuration from `config/v1.json`.
2. Fetches all configured sources concurrently with a bounded timeout.
3. Parses RSS items, a Docs page's main content, or configured HTML heading sections into a common entry shape.
4. Normalizes text and URLs and calculates a SHA-256 fingerprint.
5. Applies checked-in keyword rules for products, catalog domains and setting IDs, change types, release stage, deployments, plans, and possible catalog surfaces.
6. Stops before any GitHub mutation if any source failed.
7. Plans create, update, or skip actions by comparing stable candidate and fingerprint markers with existing review issues and the state issue.
8. In non-dry-run mode, creates or updates evidence-rich issues and advances the state issue only after all issue mutations succeed.
9. Uploads a JSON report and Markdown summary even when the scan fails.

Exact repeats are skipped. When the same source entry changes, its managed issue content is refreshed and a closed issue is reopened. Text below the `product-watch:human-notes` marker is preserved.

## Sources and watch rules

The configuration currently tracks:

- GitHub Changelog RSS
- GitHub Docs for security configurations
- GitHub Docs for REST API versions
- Version-specific GHES 3.21 release notes

Add a source to `sources` with a stable ID, label, adapter kind (`rss`, `html-page`, or `html-sections`), public URL, and supported deployments. `html-page` excludes surrounding navigation when a `<main>` element is available. For release notes, `html-sections` accepts `headingLevels` so the watch can fingerprint releases without opening an issue for every subsection. Use `baselineReviewedThrough` for a dated feed whose older entries have already been reviewed.

Add product, domain, setting, lifecycle, or impact keywords to the corresponding versioned rule collection. Catalog setting IDs are strings in this configuration so product-watch remains independent of runtime catalog code. Rule changes require fixture updates when expected classifications change.

Public preview, private preview, release candidate, GA, deprecation, and version-specific GHES changes are separate classifications. A candidate may have multiple change types, such as both `deprecation` and `api-change`.

## Local use

Run the tests:

```bash
pnpm product-watch:test
```

Run a deterministic fixture scan without network or credentials:

```bash
pnpm product-watch -- \
  --fixture tooling/product-watch/fixtures/source-payloads.json \
  --dry-run true
```

Run a live dry run:

```bash
GITHUB_REPOSITORY=owner/repository \
GITHUB_TOKEN="$(gh auth token)" \
pnpm product-watch -- --dry-run true
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
