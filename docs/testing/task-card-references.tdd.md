# Task card references — TDD evidence

## Source plan

No plan file was supplied. The journey and acceptance criteria were derived
during this TDD run.

## User journey

As a Relay operator, I want routine and backlog cards to show the same short
task reference as their list rows, so that I can quote and find a task without
switching views.

## Task report

- RED: `node --test web/tests/taskCardRef.test.ts` ran the new regression and
  failed because `TaskReference.tsx` did not exist (`1` failed, `0` passed).
- GREEN: `npx tsc -p packages/tsconfig.json && node --test
  dist/web/tests/taskCardRef.test.js dist/web/tests/taskRef.test.js` passed all
  four focused tests.
- Full verification: `npm run test:ts` completed the production build and
  passed `1319` tests across `263` suites, including the new regression.
- Style verification: `npm run lint:css -w web` passed.
- Repository hygiene: `git diff --check` passed before the GREEN checkpoint.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Backlog cards render the shared short task reference | `web/tests/taskCardRef.test.ts` | UI source contract | PASS | `npm run test:ts` |
| 2 | Routine cards render the same shared short task reference | `web/tests/taskCardRef.test.ts` | UI source contract | PASS | `npm run test:ts` |
| 3 | The card reference uses translated `Ref` copy and `taskRef(taskId)` | `web/tests/taskCardRef.test.ts` | UI source contract | PASS | `npm run test:ts` |
| 4 | Short references remain stable, discriminating, and legacy-safe | `web/tests/taskRef.test.ts` | Unit | PASS | focused compiled test run |
| 5 | The web production bundle compiles | `npm run test:ts` | Build | PASS | Next.js compiled and generated static pages |

## Coverage and known gaps

The repository does not define an instrumented TypeScript coverage command.
The focused contract covers both card consumers and the shared formatter, and
the complete TypeScript suite passed. No browser screenshot regression is
included; layout is guarded by the shared card class and the CSS/stylelint
checks.

## Merge evidence

- RED checkpoint: `fc307c81 test: add reproducer for task card references`
- GREEN checkpoint: `a93e304a feat: show refs on routine and backlog cards`
