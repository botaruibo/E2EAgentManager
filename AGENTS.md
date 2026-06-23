# Repository Guidelines

## Project Structure & Module Organization

This repository contains a TypeScript MVP for Baiying product-to-window automation. Use `design.md` as baseline.

```text
apps/desktop/src/        Local console, CSV runner, and server entry points
packages/shared/src/     Shared domain types
packages/dsl/src/        Workflow schema, default Baiying flow, validation
packages/browser/src/    Browser runtime interface, fake runtime, Playwright adapter
packages/replay/src/     Action execution, policy checks, locator evidence
packages/workflow/src/   Event-driven workflow runner
packages/app-service/src/ Desktop-facing use-case facade
packages/storage/src/    Run and workflow-version stores
packages/*/src/          Locator, policy, trace, recorder, parsing, healing
docs/                    Architecture and research notes
examples/                Sample CSV input
tests/                   Node integration tests
```

Keep runtime logic in `packages/` and runnable code in `apps/desktop/`.

## Build, Test, and Development Commands

```bash
npm run build      # Compile TypeScript into dist/
npm run lint       # Type-check without emitting files
npm test           # Build, then run tests/run-tests.js
npm run demo       # Run the sample dry-run through the fake browser
npm run console    # Generate .tmp/console.html
npm run doctor     # Check local readiness and configuration
npm run login:browser # Open a persistent browser profile for Baiying login
npm run run:csv -- examples/products.csv --mode dry_run
npm run serve -- --port 4173
npm run desktop -- --port 4173 # Launch the Electron desktop shell
```

Use `run:csv` for verification and `serve` for the console.

## Coding Style & Naming Conventions

Use TypeScript, ES modules, and 2-space indentation. Prefer exported types, pure helpers, and structured results (`{ ok, value }` / `{ ok, error }`) over thrown errors at module boundaries.

Use `kebab-case` for directories, `camelCase` for functions and variables, `PascalCase` for classes/types, and `UPPER_SNAKE_CASE` only for true constants.

## Testing Guidelines

Tests are plain Node integration tests in `tests/run-tests.js`, executed after `npm run build`. Add focused tests when changing workflow validation, CSV parsing, locator scoring, policy approval behavior, persistence, server APIs, or browser adapters. Test names should describe behavior, for example `testBatchRequiresApproval`.

## Commit & Pull Request Guidelines

There is no established commit history yet. Use concise conventional-style messages:

```text
feat: add workflow version selection
fix: handle missing run exports
docs: update architecture notes
```

Pull requests should include a short summary, motivation, test results, and screenshots or recordings for UI changes. Mention any credential, cookie, session-profile, or Douyin Baiying account implications.

## Security & Configuration Tips

Do not commit real Baiying credentials, cookies, browser profiles, exported business data, or sensitive screenshots. Keep generated artifacts under ignored paths such as `.tmp/` and document safe example configuration only.
