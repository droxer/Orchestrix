# Devbox build-context verification

## Source and user journey

No plan file was provided. The journey was derived from the reported build
failure: as a Relay developer, I can build the devbox image from the repository
root so the tracked Claude and Codex configuration files reach the Docker COPY
steps.

## Task report

- RED: `UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest backend/tests/unit/test_backend_structure.py::test_devbox_dockerfile_inputs_are_available_in_build_context -q` failed because `.dockerignore` contained `devbox/`.
- GREEN: the same focused test passed after removing that conflicting ignore pattern.
- Integration: `docker build --check -f dockerfile .` completed with no warnings.
- End to end: `make devbox-image` built and tagged `relay-devbox:v1`; both devbox COPY layers completed successfully.

## Test specification

| # | Guarantee | Test or command | Type | Result |
|---|---|---|---|---|
| 1 | Both devbox configuration inputs exist, are referenced by the root Dockerfile, and are not excluded wholesale | `test_devbox_dockerfile_inputs_are_available_in_build_context` | Unit/source invariant | PASS |
| 2 | Docker reports no ignored COPY inputs | `docker build --check -f dockerfile .` | Integration | PASS |
| 3 | The complete devbox image builds | `make devbox-image` | End to end | PASS |

## Coverage and known gaps

The change is a single Docker context rule, so statement coverage is not
applicable. Docker's own validation and a complete image build cover the
behavioral boundary directly.
