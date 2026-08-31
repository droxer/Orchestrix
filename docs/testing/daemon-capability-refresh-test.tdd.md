# Daemon capability refresh test stabilization

## Source and user journey

This follow-up fixes the remaining repository test failure found while
verifying the deleted-computer change. As a maintainer, I want the daemon
concurrency test to detect readiness probes during an active run without
depending on how many valid idle refreshes occurred before the command arrived.

## RED / GREEN evidence

- RED: `node --test --test-name-pattern='capability refresh never probes agents while a run is active' dist/packages/relay-daemon/tests/daemon.test.js`
  failed with `9 !== 5`.
- Diagnosis: four additional readiness checks occurred during a valid idle
  refresh before the first command poll. The production refresh path already
  gates on `activeRuns.size === 0`.
- GREEN: after capturing the readiness count when agent execution starts and
  comparing it with the count immediately before releasing the active run, the
  same isolated command passed.

## Test specification

| Guarantee | Test type | Result |
| --- | --- | --- |
| Capability refresh does not probe agents after a run enters execution and before that run is released. | Daemon concurrency | PASS |
| Idle refresh timing before command delivery does not make the concurrency test fail. | Regression | PASS |
| The full relay-daemon suite, including existing BoxLite shutdown tests, remains green. | Package regression | PASS (`91 passed, 1 environment-skipped`) |
| The full TypeScript suite remains green. | Repository regression | PASS (`1262 passed`) |

## Coverage and known gaps

The repository has no dedicated coverage script. The focused test and complete
daemon suite exercise the affected concurrency path. No production behavior
was changed; only the test's timing baseline was corrected.
