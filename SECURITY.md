# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for this repository (Security → Advisories →
Report a vulnerability). Include the affected version or commit, impact, and a
minimal reproduction. Do not include real user data, credentials, or private
decks in a report.

## Supported versions

Security fixes are made against the latest `main` branch. Until a release
policy is established, users should run the latest published source.

## Deployment notes

- Set a random `SESSION_SECRET` of at least 32 characters in production.
- Keep `DATA_DIR` private and persistent; it contains accounts, decks, and
  uploaded images.
- Treat public share links as public access. Do not share sensitive deck
  content through a public link.
- Do not expose the local stdio MCP process to untrusted clients. It has the
  same filesystem and database authority as the account running it.