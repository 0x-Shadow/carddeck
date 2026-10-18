# Contributing

Thanks for helping improve Carddeck. Keep changes focused and explain the user
problem they solve.

## Development

Requirements: Node.js 20 or newer and npm 10 or newer.

```bash
npm ci
npm run dev
npm test
npm run build
```

The app works without an AI key using its deterministic local provider. Set
`OPENAI_API_KEY` in an untracked `.env` only when you need live model
generation. Never commit `.env`, SQLite files, uploaded assets, generated
PowerPoints/PDFs, screenshots containing private decks, or credentials.

## Pull requests

- Open an issue first for large features or behavior changes.
- Include focused tests for changed behavior and run `npm test` plus
  `npm run build` before submitting.
- Describe any database migration, configuration change, or security impact.
- Use screenshots only when they contain public/demo content; scrub private
  data and metadata.
- Keep generated artifacts and local planning notes out of pull requests.

## MCP changes

Preserve stdio protocol output: logs belong on stderr, never stdout. Test tools
with an in-memory MCP client and an isolated temporary `DATA_DIR`. Document
client setup and any new tool in `docs/MCP.md`.