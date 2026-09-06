# Backlog and routine interface fixes — TDD evidence

## Intent

Resolve the issues found in the backlog and routine setup-drawer interface
review against the Web Interface Guidelines: autofill opt-outs on the drawer
form's free-text fields, focus moved to the field at fault on failed submit
validation, a submit button that names its action, `role="group"` under the
`aria-label`s that were being dropped, and filter-bar state in the URL so a
filtered board is linkable and survives navigation.

## RED

Command:

```sh
npx tsc -p packages/tsconfig.json && \
  node --test dist/web/tests/taskBoardInterfaceFixes.test.js
```

Result before the implementation: `urlFilters.test.ts` did not compile
(`TS2307: Cannot find module '../src/lib/urlFilters.js'`), and all six
source-level UI contracts failed — 0 passed, 6 failed.

## GREEN

Focused command:

```sh
npx tsc -p packages/tsconfig.json && \
  node --test dist/web/tests/taskBoardInterfaceFixes.test.js dist/web/tests/urlFilters.test.js
```

Result: 14 passed, 0 failed.

One existing expectation changed deliberately: `appRoute.test.ts` asserted
`?q=` is canonicalized off `/backlog`; the backlog filter bar now owns `q` as
its search param, so the stale-param assertion moved to a param no surface
owns (`?bogus=stale`).

Additional checks:

```sh
npm run lint:css -w web
npm run test:ts
git diff --check
```

Results:

- Stylelint passed.
- The full TypeScript build (all packages, the Next.js web build, and
  `tsc -p packages/tsconfig.json`) passed.
- The complete TypeScript suite passed: 1,341 tests, 0 failed.
- Git whitespace validation passed.

## Ownership and invariants

- Changed only the task-board web surface, its filter/URL seam, and the i18n
  locales. No API, database, daemon, task event, or cache contract changed.
- Filter params are registered per route in `LIST_FILTER_PARAMS`
  (`web/src/lib/appRoute.ts`); enum fields drop URL values they cannot take,
  and a field at its default writes no param.
- Selection, pagination, and sort semantics are unchanged — the filters are
  the same object, now sourced from the query string instead of `useState`.
