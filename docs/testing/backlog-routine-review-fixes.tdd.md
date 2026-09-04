# Backlog and routine review fixes — TDD evidence

## Intent

Resolve the seven design and implementation issues found in the backlog and
routine review: hydration-safe view preferences, page-scoped selection,
touch-accessible card actions, exact routine-state filters, meaningful routine
sorting, guarded task starts with pending feedback, and consistent drawer REF
identity.

## RED

Command:

```sh
npx tsc -p packages/tsconfig.json && \
  node --test dist/web/tests/taskBoardReviewFixes.test.js dist/web/tests/routine.test.js
```

Result before the implementation: 10 passed, 8 failed. The exact-state unit
test returned every routine for the unsupported `running` filter, and all seven
source-level UI contracts failed.

Checkpoint: `b06fc9c2 test: capture backlog and routine review issues`

## GREEN

Focused command:

```sh
npx tsc -p packages/tsconfig.json && \
  node --test dist/web/tests/taskBoardReviewFixes.test.js dist/web/tests/routine.test.js
```

Result: 18 passed, 0 failed.

Additional checks:

```sh
npm run lint:css -w web
npm run build -w web
npm run test:ts
git diff --check
```

Results:

- Stylelint passed.
- The optimized Next.js production build and TypeScript validation passed.
- The complete TypeScript suite passed: 1,327 tests across 264 suites.
- Git whitespace validation passed.

Checkpoint: `cff23287 fix: resolve backlog and routine review issues`

## Ownership and invariants

- Changed only the task-board web surface and its domain helpers/tests.
- No API, database, daemon, task event, or cache contract changed.
- Routine state remains derived from schedule data and live occurrences.
- Batch deletion is now limited to the records visible on current lane pages.
- Start dispatch still uses the existing mutation/daemon path; the UI only adds
  in-flight exclusion and feedback.
