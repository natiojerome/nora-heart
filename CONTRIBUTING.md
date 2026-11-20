# Contributing

Nora Heart separates its orchestration engine, contracts and replaceable modules.
Read `AGENTS.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` before changing code.

Use Node.js 24 and the pnpm version declared in `package.json`/the lockfile.
Run `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm demo:local`.
Browser checks: `pnpm test:web:e2e` (install Chromium with
`pnpm exec playwright install chromium`). Linux development/terminal checks need
Bubblewrap and ripgrep; see `docs/DEVELOPMENT.md` for the sandbox setup.
Use disposable data. Never use an owner's production account for test writes.

Keep contracts short and provider-neutral. Modules expose `index.ts`, do not import
concrete sibling modules, and are wired explicitly in `src/app`. Keep SQL in
storage modules. Tests must cover behaviour and failure cases rather than mirror
implementation details. Update current documentation with each meaningful change.

The public repository begins with a reviewed source snapshot. Private deployment
reports, screenshots, runtime state and credentials are not published. Public
clones use ordinary commits and pull requests; local operator history is separate.
