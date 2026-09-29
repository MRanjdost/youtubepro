# Release notes

## 2026-09-23: Post-release maintenance

Cleanup pass across the codebase after the 1.0.0 public release.

### Changes

- **Dependency reduction:** 39 runtime dependencies (down from 60). Removed `framer-motion`, `next-themes`, `embla-carousel-react`, `cmdk`, `react-day-picker`, `react-resizable-panels`, `vaul`, `input-otp`, and 17 unused @radix-ui packages. shadcn/ui components reduced from 51 to 26.
- **Provider layer:** Text generation now uses a provider factory that supports Gemini or any OpenAI-compatible endpoint (`server/providers/`) with normalized error categories.
- **Test runner:** Tests run through `script/test.ts` (cross-platform recursive discovery, no shell globbing). The suite grew to 564 tests across 63 suites while removing dead-code coverage gaps.
- **i18n:** 8 namespaces across English and Persian (added `controller-guide`), verified by `npm run verify-i18n` in CI.
- **Documentation:** README, PROJECT_MAP, CONTRIBUTING, HANDOFF, PORTING, and the launch package updated to match the current architecture.

### Verification

- `npm test`: 564 tests passed, 63 suites, 0 failures
- `npm run check`: TypeScript check passed
- `npm run verify-i18n`: en/fa key parity passed
- `npm run build`: Production client and server builds completed

## 2026-08-25: Version 1.0.0 public release

This release brings the complete local-first workflow, current product documentation, and release checks together in the public GitHub repository.

### Included

- **Complete creation workflow:** Research, evidence-grounded AI Insights, automatically generated Ideas, Script Writer with teleprompter, and Thumbnail Creator remain connected through one restorable project.
- **Workflow history controls:** The eight most recent browser-local projects can be reopened, renamed, or deleted after explicit confirmation.
- **Current product tour:** Five current screenshots document Research analytics, source videos, AI Insights, the Script teleprompter, and Thumbnail Creator.
- **Launch package:** A five-minute demonstration script, presentation, shot list, and YouTube publishing package are available under `docs/launch-video/`.
- **Open-source repository:** The exact release is available at `MRanjdost/youtubepro` under the Apache License 2.0.

### Verification

- `npm test`: 62 tests passed
- `npm run check`: TypeScript check passed
- `npm run build`: Production client and server builds completed
- `npm audit --audit-level=high`: 0 vulnerabilities
- Current source scan outside the ignored `.env`: 0 secret findings
- GitHub Actions runs the same test, TypeScript, and production-build gates on every push and pull request

### Release boundary

This is a local-first application release, not a hardened multi-user internet service. Do not expose the server directly to the internet without the authentication, secret-management, shared rate-limiting, and deployment-specific security controls described in `SECURITY.md`.

## 2026-08-24: Restorable local workflows and refreshed research experience

This update makes YouTube Pro easier to leave and resume. Research, generated ideas, scripts, and thumbnail work now stay grouped as local workflows, while the research brief presents dense AI output in a more visual, scan-first format.

### Added

- **Recent workflows:** The sidebar lists the eight most recently updated projects and reopens the last useful Research, Script Writer, or Thumbnail Creator step.
- **Browser-local persistence:** Research snapshots, AI Insights, grounded ideas, script output and revisions, thumbnail briefs, and generated thumbnail results are stored in IndexedDB.
- **Independent projects:** **New Workflow** starts a fresh project without replacing earlier work in the recent-workflow list.
- **Workflow management:** Recent projects can be renamed from the sidebar or deleted after explicit confirmation.
- **Workflow helper tests:** Shared title, ordering, deduplication, and history-limit behavior now have focused automated coverage.

### Improved

- **Research readability:** AI Insights use compact visual summaries, expandable findings, opportunity cards, and collapsed evidence and methodology details.
- **Evidence clarity:** Observed findings, inferred recommendations, and metrics that require channel-owner YouTube Studio data remain visibly separated.
- **Resume behavior:** Research results are saved as soon as the public-data snapshot returns, then enriched again when AI Insights and grounded ideas finish.
- **Script Writer:** Generated output, supporting metadata, form inputs, and user revisions restore with the selected workflow.
- **Thumbnail Creator:** The brief, advanced visual controls, generated image, and model information restore with the selected workflow.
- **Navigation:** Opening a saved workflow returns to the most useful completed step instead of an empty route.

### Documentation

- Replaced the product-tour captures with five current screenshots covering Research analytics, Source Videos, AI Insights, the Script teleprompter, and Thumbnail Creator.
- Expanded the README with workflow-history behavior, local-storage boundaries, and restoration details.

### Privacy and storage boundaries

- Workflow history remains in the current browser profile. It is not synchronized to a server or another device.
- API keys remain server-side and are not written into workflow history.
- Uploaded thumbnail reference images are not retained. Users must select them again for a later generation.
- Research continues to use public YouTube Data API metadata. Owner-only metrics such as impressions, click-through rate, traffic sources, and retention require YouTube Studio and are not inferred as public facts.

### Verification

- `npm test`: 61 tests passed
- `npm run check`: TypeScript check passed
- `npm run build`: Production client and server builds completed
- README image-reference and source-image checksum checks passed
