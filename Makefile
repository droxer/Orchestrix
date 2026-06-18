DEVBOX_IMAGE := relay-devbox:v1
DEVBOX_BASE_IMAGE ?= node:22.19-bookworm-slim
OCI_DIR := .oci/relay-devbox-v1
DOCKERFILE := dockerfile
IMAGE_ID_FILE := $(OCI_DIR)/.docker-image-id
DOCKERFILE_MTIME_FILE := $(OCI_DIR)/.dockerfile-mtime
PORT ?= 8787
BACKEND_PORT ?= 8790
DATABASE_URL ?=
RELAY_BACKEND_URL ?= http://127.0.0.1:$(BACKEND_PORT)
EMPLOYEE_ID ?=
SANDBOX_ID ?= node_$(USER)
DAEMON_TOKEN ?=
DAEMON_NODE_TOKEN ?=
SANDBOX_MODE ?=
WORKSPACE ?=

.PHONY: devbox-image devbox-check devbox-oci build-packages test test-python backend-install backend-run backend-test backend-migrate pre-commit-install pre-commit-run run tui-install tui-run tui-test tui tui-local backend daemon-install daemon-run daemon-test daemon run-with-daemon serve web-install web-run web-test web run-fresh stop

devbox-image:
	docker build --build-arg DEVBOX_BASE_IMAGE="$(DEVBOX_BASE_IMAGE)" -t $(DEVBOX_IMAGE) -f $(DOCKERFILE) .

devbox-check: devbox-image
	docker run --rm $(DEVBOX_IMAGE) bash -lc 'node --version && command -v pi && pi --version && claude --version && codex --version && kimi --version'

devbox-oci: devbox-check
	mkdir -p $(OCI_DIR)
	docker save $(DEVBOX_IMAGE) | tar -xf - -C $(OCI_DIR)
	docker image inspect $(DEVBOX_IMAGE) --format='{{.Id}}' > $(IMAGE_ID_FILE)
	node -e "console.log(require('fs').statSync('$(DOCKERFILE)', { bigint: true }).mtimeNs.toString())" > $(DOCKERFILE_MTIME_FILE)

build-packages:
	npm run build -w relay-core
	npm run build -w relay-daemon
	npm run build -w relay-tui

test:
	npm test

test-python: backend-test

backend-install:
	UV_CACHE_DIR=.uv-cache uv sync --project backend --extra dev

pre-commit-install: backend-install
	UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pre-commit install

pre-commit-run:
	UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pre-commit run --all-files

backend-run:
	$(if $(filter command line environment,$(origin BACKEND_PORT)),BACKEND_PORT="$(BACKEND_PORT)" )UV_CACHE_DIR=.uv-cache uv run --project backend relay

backend-test:
	UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev pytest

backend-migrate:
	$(if $(DATABASE_URL),RELAY_DATABASE_URL="$(DATABASE_URL)" )UV_CACHE_DIR=.uv-cache uv run --project backend --extra dev alembic -c backend/alembic.ini upgrade head

tui-local:
	$(if $(filter command line environment,$(origin RELAY_BACKEND_URL)),RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" )$(if $(filter command line environment,$(origin EMPLOYEE_ID)),RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" )$(if $(filter command line environment,$(origin DAEMON_TOKEN)),RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" )$(if $(filter command line environment,$(origin DAEMON_NODE_TOKEN)),RELAY_DAEMON_NODE_TOKEN="$(DAEMON_NODE_TOKEN)" )$(if $(filter command line environment,$(origin SANDBOX_MODE)),RELAY_SANDBOX_MODE="$(SANDBOX_MODE)" )$(if $(filter command line environment,$(origin WORKSPACE)),RELAY_WORKSPACE="$(WORKSPACE)" WORKSPACE="$(WORKSPACE)" )node packages/relay-tui/dist/local-run.js

tui-install:
	npm install -w relay-tui

tui-run:
	$(if $(filter command line environment,$(origin RELAY_BACKEND_URL)),RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" )$(if $(filter command line environment,$(origin EMPLOYEE_ID)),RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" )$(if $(filter command line environment,$(origin DAEMON_TOKEN)),RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" )$(if $(filter command line environment,$(origin DAEMON_NODE_TOKEN)),RELAY_DAEMON_NODE_TOKEN="$(DAEMON_NODE_TOKEN)" )$(if $(filter command line environment,$(origin SANDBOX_ID)),RELAY_SANDBOX_ID="$(SANDBOX_ID)" SANDBOX_ID="$(SANDBOX_ID)" )$(if $(filter command line environment,$(origin WORKSPACE)),RELAY_WORKSPACE="$(WORKSPACE)" WORKSPACE="$(WORKSPACE)" )node packages/relay-tui/dist/cli.js

tui-test:
	npm run build -w relay-core
	npm run build -w relay-daemon
	npm run build -w relay-tui
	./node_modules/.bin/tsc -p packages/tsconfig.json
	node --test dist/packages/relay-tui/tests/tui.test.js

tui: tui-run

run: tui-local

backend: backend-run

daemon-install:
	npm install -w relay-daemon

daemon-run:
	@echo "Starting the Relay daemon. It registers with the backend, owns the sandbox, and runs agent CLIs."
	$(if $(filter command line environment,$(origin RELAY_BACKEND_URL)),RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" )$(if $(filter command line environment,$(origin EMPLOYEE_ID)),RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" )$(if $(filter command line environment,$(origin DAEMON_TOKEN)),RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" )$(if $(filter command line environment,$(origin DAEMON_NODE_TOKEN)),RELAY_DAEMON_NODE_TOKEN="$(DAEMON_NODE_TOKEN)" )$(if $(filter command line environment,$(origin WORKSPACE)),RELAY_WORKSPACE="$(WORKSPACE)" )node packages/relay-daemon/dist/cli.js --sandbox-id $(SANDBOX_ID) $(if $(filter command line environment,$(origin SANDBOX_MODE)),--sandbox $(SANDBOX_MODE),)

daemon-test:
	npm run build -w relay-core
	npm run build -w relay-daemon
	./node_modules/.bin/tsc -p packages/tsconfig.json
	node --test dist/packages/relay-core/tests/handoff.test.js

daemon: daemon-run

run-with-daemon: run

serve:
	$(if $(filter command line environment,$(origin PORT)),BACKEND_PORT="$(PORT)" )UV_CACHE_DIR=.uv-cache uv run --project backend relay serve

web-install:
	npm install -w web

web-run:
	$(if $(filter command line environment,$(origin RELAY_BACKEND_URL)),RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" )npm run dev -w web

web-test:
	npm run build -w relay-core
	./node_modules/.bin/tsc -p packages/tsconfig.json
	node --test dist/web/tests/status.test.js dist/web/tests/messageBlock.test.js

web: web-run

run-fresh: devbox-oci
	$(if $(filter command line environment,$(origin WORKSPACE)),RELAY_WORKSPACE="$(WORKSPACE)" )node packages/relay-tui/dist/local-run.js

stop:
	-pkill -f "backend --port" 2>/dev/null
	-pkill -f "node packages/relay-daemon/dist/cli.js" 2>/dev/null
	-pkill -f "node packages/relay-tui/dist/cli.js$$" 2>/dev/null
	-pkill -f "npm run run" 2>/dev/null
	-pkill -f "boxlite-shim" 2>/dev/null
	-node -e "import('@boxlite-ai/boxlite').then(async ({JsBoxlite}) => { const rt = JsBoxlite.withDefaultConfig(); for (const box of await rt.listInfo()) { if ((box.name || '').startsWith('relay')) await rt.remove(box.name || box.id, true).catch(() => undefined); } }).catch(() => undefined)"
	-rm -f $(HOME)/.boxlite/.lock
	@echo "Stopped Relay backend, daemon, and BoxLite processes."
