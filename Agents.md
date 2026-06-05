# Relay Agent Guide

This repository is a TypeScript/Node.js CLI. Do not add Python host code back to the project.

## Project Shape

- Runtime entrypoint: `src/index.ts`
- Relay implementation: `src/relay.ts`
- Tests: `tests/handoff.test.ts`
- Package manager: npm
- Local devbox image: `dockerfile`
- Generated outputs: `dist/`, `node_modules/`, `.oci/`

## Commands

- Install dependencies: `npm install`
- Build: `npm run build`
- Test: `npm test` or `make test`
- Run the orchestrator: `make run` or `npm run run`
- Rebuild/export the devbox image only when the image changes: `make run-fresh`
- Build/check/export devbox pieces manually: `make devbox-image`, `make devbox-check`, `make devbox-oci`

Use `make run` for normal execution. Do not tell users to run `make run-fresh` unless `dockerfile` or the devbox image changed.

## Implementation Notes

- Keep the host orchestrator in TypeScript.
- Use BoxLite's Node SDK (`@boxlite-ai/boxlite`) for VM lifecycle and command execution.
- `execStream()` should stream stdout/stderr while also collecting output for routing and logs.
- Claude uses `--output-format stream-json`; render JSONL through `JsonLineRenderer` instead of printing raw JSON.
- Codex uses `exec --json`; render JSONL through `JsonLineRenderer` instead of printing raw JSON.
- Pi versions differ: use `-P` only when `pi --help` advertises `-P` or `--print-streaming`; otherwise fall back to `-p`.
- Keep terminal output readable: section headers, status labels, aligned startup fields, and no raw JSON events.

## Verification

For behavior changes, add or update tests in `tests/handoff.test.ts` and run `npm test`.

Before handing off, check:

1. TypeScript compiles.
2. Existing handoff and provider tests pass.
3. Terminal rendering tests still prove Claude/Codex JSONL is not printed raw.
4. Pi command generation remains compatible with old and new Pi CLI versions.
