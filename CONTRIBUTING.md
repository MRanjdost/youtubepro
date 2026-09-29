# Contributing to YouTube Pro

YouTube Pro welcomes focused contributions that preserve the continuous workflow from Research to Insights to Ideas to Script Writer to Thumbnail Creator.

## Fork and clone

1. Fork the repository on GitHub.
2. Clone your fork and add the upstream remote:

   ```bash
   git clone https://github.com/<your-username>/youtubepro.git
   cd youtubepro
   git remote add upstream https://github.com/MRanjdost/youtubepro.git
   ```

3. Create a branch for your work:

   ```bash
   git checkout -b your-change
   ```

## Local setup

1. Install Node.js 20.19 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and add your own provider keys, or configure them through the local Settings page.
4. Run `npm run dev` and open `http://127.0.0.1:5433`.

Never commit `.env`, provider keys, generated private data, or exports containing private channel information.

## The `// WHY:` comment convention

Every non-obvious change carries a short `// WHY:` comment stating the reason, not a restatement of the code. The intent is to capture what the code alone cannot express: the tradeoff accepted, the constraint that forced the shape, or the failure this prevents.

```ts
// WHY: YouTube rejects requests with duplicate ids and bills each call, so the
// batch size is capped rather than driven by the caller's result limit.
```

Use it for behavioral decisions, security boundaries, and non-obvious workarounds. Do not use it to narrate self-evident lines. In TypeScript files use `// WHY:`; in SCSS, JSON, and Markdown, put it on the preceding line as `// WHY:` or use the `WHY:` form in an adjacent HTML comment.

## Required checks

All four gates must pass before you open a pull request:

```bash
npm run check         # TypeScript type check
npm run verify-i18n   # Persian/English locale key coverage
npm test              # Full test suite
npm run build         # Production client and server build
```

The automated suite uses fixtures and mocks. It must not spend YouTube or Gemini quota.

## Tests are not yours to modify

Test files are the maintainer's safety net for the evidence, provider, and security contracts. Do not edit, delete, skip, rename, or weaken any test to make a change pass. Doing so blocks the pull request until a maintainer approves it explicitly.

This includes loosening an assertion, widening a matcher, adding `.skip`, changing an expected value to match new output, or deleting a fixture. If a test genuinely conflicts with a correct behavior change, open an issue first and describe the case. Maintainer approval is per-change and is never retroactive.

Test fixtures must contain obviously fake values. Do not paste a real key, even an expired one, or a documentation example key that a secret scanner would flag. Use placeholders such as `AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000` or `sk-or-test-12345678`.

## Opening a pull request

1. Rebase onto upstream before you push, so CI runs against current `main`:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. Push your branch to your fork and open the pull request against `main`.
3. Fill in the description with the user-facing effect, the `// WHY:` reasoning for non-obvious decisions, and which of the four gates you ran.
4. Attach before-and-after screenshots for meaningful interface changes, in both dark and light themes where practical.
5. Respond to review by pushing follow-up commits to the same branch.

### Change guidelines

- Keep each change focused and explain its user-facing effect.
- Preserve snapshot IDs and source-video evidence through the Research, Insights, Ideas, and Script stages.
- Keep provider credentials and paid calls on the server.
- Add or update focused tests when changing request contracts, provider behavior, evidence rules, exports, or security boundaries.
- Include screenshots for meaningful interface changes in both dark and light themes when practical.
- State which checks were run and any acceptance work that remains.

## License and contributions

By contributing, you agree that your contributions will be licensed under the repository's [Apache License 2.0](LICENSE).
