# GitHub Enterprise Settings Configurator

## Build, lint, and local development

- Use Node.js 22, matching the Pages workflow, and pnpm 11.17.0 from `package.json`.
- Install dependencies: `pnpm install`
- CI-style install: `pnpm install --frozen-lockfile`
- Start the Vite development server: `pnpm dev`
- Build and type-check: `pnpm build` (`tsc -b && vite build`)
- Lint the repository: `pnpm lint`
- Lint one file: `pnpm exec oxlint src/logic/scoring.ts`
- Preview the production build: `pnpm preview`
- No automated test runner or `test` script is currently configured.

GitHub Pages deploys `dist/` from `main` through
`.github/workflows/deploy-pages.yml`. Vite uses `/` locally and
`/github-enterprise-settings-configurator/` when `GITHUB_ACTIONS` is set, so
do not assume the deployed app is hosted at the domain root.

## Architecture

This is a client-only React 19 + TypeScript decision assistant. It has no
router, backend, authentication, or tenant connection. A versioned local draft
in browser `localStorage` preserves target profile, planning intent, priorities,
explicit selections, and review state; JSON import accepts current exports and
older exports without planning-intent metadata. `App.tsx` owns the guided
workbench state and delegates persistence validation to
`src/logic/persistence.ts`.

The domain flow is:

1. `src/types.ts` defines the profile, setting, plan, source, and disposition
   contracts.
2. `src/catalog.ts` is the authoritative setting catalog. Each entry contains
   choices, applicability, evidence, ownership, application method, influence,
   and effort metadata.
3. `src/logic/recommendations.ts` derives the profile/priority-specific
   recommendation, applies an explicit user selection when present, and marks
   every catalog entry as `Recommended`, `Override`, or `Not applicable`.
4. `src/logic/scoring.ts` groups applicable decisions by domain and calculates
   relative control influence plus rollout and ongoing effort. It deliberately
   produces separate domain scales rather than a composite score.
5. `src/components/Review.tsx` renders those domain profiles, and
   `src/logic/export.ts` reuses the same calculations for JSON and Markdown
   exports. The browser creates downloads with `Blob` URLs.
6. `src/logic/persistence.ts` validates cached and imported plan data against
   the current profile, priority, setting, and choice contracts before applying
   it. Do not trust raw local-storage or file-import values.

`src/index.css` defines the Primer Light-based global `--cp-*` design tokens,
focus treatment, and reduced-motion behavior. `src/App.css` contains the flat
document/workbench and responsive layout rules.

## Repository-specific conventions

- Catalog choice order is semantic: `scoring.ts` treats the first choice as
  strongest and the last as lightest. When adding or reordering choices,
  review posture calculations and add `effortByChoice` when effort does not
  follow that order.
- Keep catalog IDs stable. Recommendation overrides and exported desired-state
  records refer to setting and choice IDs, not labels.
- A new catalog setting must supply the full `Setting` contract, including
  `applies`, rationale/tradeoff/prerequisite/consequence text, scope, role,
  apply method, influence, effort bands, and tiered sources.
- Use `applies` for target-profile exclusion. Do not model an inapplicable
  setting as an override, and do not turn unknown current state into a gap.
- Profile- or priority-dependent defaults belong in `recommendationFor`.
  `plan.selections` remains the explicit user override layer.
- Keep `reviewed` state separate from `plan.selections`: a preselected
  recommendation is not accepted until the user reviews it. Derived,
  non-editable settings count as reviewed automatically, and bulk acceptance
  must not silently accept unreviewed overrides.
- Bump the persistence schema and add an explicit migration when changing the
  cached state shape. Keep current JSON exports importable, and preserve the
  balanced planning-intent fallback for older exports that lack intent fields.
- `foundational` choices can cap a domain's posture. `postureWeight: 0` is used
  for contextual decisions such as hosting that affect effort but must not be
  presented as security controls.
- Preserve the product language boundaries in the UI and exports: this is a
  desired-state planning tool, not observed tenant state, a compliance
  assessment, a universal security score, or a direct-apply tool.
- Classify evidence with the existing source tiers. Prefer current GitHub Docs
  for mechanics; keep Well-Architected guidance, worked examples, and
  automation adapters labeled as such rather than presenting them as canonical
  product behavior.
- Keep review and export calculations aligned by using
  `buildDomainProfiles`; do not duplicate scoring logic in components or
  serializers.
- Build UI controls from semantic HTML with explicit labels and ARIA state,
  following the existing radio-group, progress-bar, alert, and disclosure
  patterns. Reuse `--cp-*` tokens instead of hard-coded component colors.
