# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

Security fixes land only in the latest 1.0.x release on the `main` branch.

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability.**

Use GitHub's private vulnerability reporting:

1. Go to the repository's **Security** tab.
2. Select **Advisories** → **Report a vulnerability**.
3. Submit the report. You will get an acknowledgement, and the maintainer will
   coordinate disclosure and a fix timeline with you.

If private advisory access is unavailable, contact the repository owner through
an already approved private channel instead.

Please include:

- The affected route, component, or file.
- Reproduction steps, ideally minimal.
- Expected impact.
- A minimal proof of concept where possible.
- The affected version.

Strip API keys, access tokens, personal data, and private channel information
from every report and screenshot before submitting.

Please do not test against third-party accounts, run automated scans against the
YouTube or Gemini APIs, or attempt denial of service.

## Scope

This project is local-first software. The most valuable reports concern the
server boundary: credential handling, the local Settings endpoint, request
validation, the snapshot and evidence contracts, or the outbound proxy path.

Out-of-scope reports include findings that require an attacker to already control
your machine or your `.env` file, and automated scanner output without a working
proof of concept.

## Supported configuration

The current supported configuration is local-first:

- The server binds to `127.0.0.1` by default.
- YouTube and Gemini keys remain in the server environment and are never returned
  to the browser.
- The local Settings endpoint accepts same-origin loopback requests only.
- Billable routes use an in-memory per-process rate limiter.

**This is not a hardened multi-user internet service.** Before remote deployment,
add authenticated access, a trusted secret-management path, a shared rate
limiter, request observability that excludes secrets and content bodies, and a
deployment-specific threat review. Refer to the deployment guidelines or contact
the maintainers for the production porting checklist.

## Credential response

If a credential is accidentally committed, revoke or rotate it immediately.
Removing it from the latest commit is not sufficient, because Git history, forks,
and clones may retain the value.

Test fixtures must contain obviously fake values. Placeholders such as
`AIzaSyFAKE_PUBLIC_REPO_PLACEHOLDER_00000000` and `sk-or-test-12345678` are
expected and are not real credentials.

## License

Security fixes are distributed under the Apache License 2.0. See `LICENSE` in the
repository root.
