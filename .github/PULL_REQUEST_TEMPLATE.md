# Pull request

<!--
Thank you for contributing. Read CONTRIBUTING.md before opening this.

Note the two hard rules: all four gates must pass, and test files are not yours
to modify without explicit maintainer approval.
-->

## What this changes

<!-- One short paragraph: the user-facing effect of this change. -->

## Related issue

<!-- Fixes #123, or "None". -->

## Screenshots

<!--
Required for meaningful interface changes. Include both dark and light themes
where practical. Remove this section entirely for backend-only changes.
-->

| Dark | Light |
| ---- | ----- |
| <!-- before --> | <!-- before --> |
| <!-- after --> | <!-- after --> |

## Rationale

<!--
For every non-obvious decision, describe the tradeoff accepted, the constraint
that forced the shape, or the failure this prevents. The `// WHY:` comments in
the code capture this locally; summarize the bigger ones here.

If this is a pure mechanical or trivial change, say so instead.
-->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor or cleanup with no behavior change
- [ ] Documentation only
- [ ] Provider or model changes
- [ ] Internationalization changes
- [ ] Dependency changes

## Quality gates

<!--
Run all four locally before pushing. CI runs them too, but do not rely on that
to discover a failure.

npm run check
npm run verify-i18n
npm test
npm run build
-->

- [ ] `npm run check` passes (TypeScript)
- [ ] `npm run verify-i18n` passes (en / fa key coverage)
- [ ] `npm test` passes
- [ ] `npm run build` passes

## Required confirmations

- [ ] I added a `// WHY:` comment to every non-obvious change, explaining the reason rather than restating the code.
- [ ] **I did not modify, delete, skip, or weaken any test.** No `.skip`, no loosened assertions, no widened matchers, no changed expectations, no removed fixtures.
- [ ] Snapshot IDs, source video IDs, and evidence claim IDs are preserved and unchanged through Research, AI Insights, Grounded Ideas, and Script Writer.
- [ ] Request and response bodies are still never logged, and API keys are still never returned to the browser.
- [ ] Provider credentials and paid calls remain server-side.
- [ ] Any new user-facing text exists in **both** `en` and `fa` locale files, with the same key, and `npm run verify-i18n` passes.
- [ ] New test fixtures, if any, contain obviously fake placeholder values. No real key, expired or otherwise, and no documentation example key that a secret scanner would flag.
- [ ] I did not commit `.env`, any API key, generated private data, or exports containing private channel information.

## Notes for the reviewer

<!--
Anything you want a second opinion on, a trade-off you rejected, or a place
you are unsure about.
-->
