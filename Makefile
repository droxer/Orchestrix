DEVBOX_IMAGE := relay-devbox:v1
OCI_DIR := .oci/relay-devbox-v1
DOCKERFILE := dockerfile
IMAGE_ID_FILE := $(OCI_DIR)/.docker-image-id
DOCKERFILE_MTIME_FILE := $(OCI_DIR)/.dockerfile-mtime
PORT ?= 8787
BACKEND_PORT ?= 8790
RELAY_BACKEND_URL ?= http://127.0.0.1:$(BACKEND_PORT)
EMPLOYEE_ID ?= $(USER)
SANDBOX_ID ?= sbx_$(EMPLOYEE_ID)
DAEMON_TOKEN ?=
SANDBOX_MODE ?=
WORKSPACE ?=

.PHONY: devbox-image devbox-check devbox-oci build test run tui tui-local backend daemon run-with-daemon serve web run-fresh stop

devbox-image:
	docker build -t $(DEVBOX_IMAGE) -f $(DOCKERFILE) .

devbox-check: devbox-image
	docker run --rm $(DEVBOX_IMAGE) bash -lc 'node --version && command -v pi && pi --version && claude --version && codex --version'

devbox-oci: devbox-check
	mkdir -p $(OCI_DIR)
	docker save $(DEVBOX_IMAGE) | tar -xf - -C $(OCI_DIR)
	docker image inspect $(DEVBOX_IMAGE) --format='{{.Id}}' > $(IMAGE_ID_FILE)
	node -e "console.log(require('fs').statSync('$(DOCKERFILE)', { bigint: true }).mtimeNs.toString())" > $(DOCKERFILE_MTIME_FILE)

build:
	npm run build

test:
	npm test

tui-local:
	RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" RELAY_SANDBOX_MODE="$(SANDBOX_MODE)" RELAY_WORKSPACE="$(WORKSPACE)" WORKSPACE="$(WORKSPACE)" node packages/relay-tui/dist/local-run.js

tui:
	RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" RELAY_WORKSPACE="$(WORKSPACE)" WORKSPACE="$(WORKSPACE)" node packages/relay-tui/dist/cli.js

run: tui

backend:
	node packages/relay-backend/dist/backend-cli.js --port $(BACKEND_PORT)

daemon:
	@echo "Starting the Relay daemon. It registers with the backend, owns the sandbox, and runs agent CLIs."
	RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" RELAY_DAEMON_TOKEN="$(DAEMON_TOKEN)" RELAY_WORKSPACE="$(WORKSPACE)" node packages/relay-daemon/dist/cli.js --sandbox-id $(SANDBOX_ID) $(if $(SANDBOX_MODE),--sandbox $(SANDBOX_MODE),)

run-with-daemon: run

serve:
	node packages/relay-backend/dist/cli.js serve --port $(PORT)

web:
	RELAY_BACKEND_URL="$(RELAY_BACKEND_URL)" npm run dev -w relay-web

run-fresh: devbox-oci
	RELAY_WORKSPACE="$(WORKSPACE)" node packages/relay-tui/dist/local-run.js

stop:
	-pkill -f "node packages/relay-backend/dist/backend-cli.js" 2>/dev/null
	-pkill -f "node packages/relay-daemon/dist/cli.js" 2>/dev/null
	-pkill -f "node packages/relay-tui/dist/cli.js$$" 2>/dev/null
	-pkill -f "npm run run" 2>/dev/null
	-pkill -f "boxlite-shim" 2>/dev/null
	-node -e "import('@boxlite-ai/boxlite').then(async ({JsBoxlite}) => { const rt = JsBoxlite.withDefaultConfig(); for (const box of await rt.listInfo()) { if ((box.name || '').startsWith('relay')) await rt.remove(box.name || box.id, true).catch(() => undefined); } }).catch(() => undefined)"
	-rm -f $(HOME)/.boxlite/.lock
	@echo "Stopped Relay backend, daemon, and BoxLite processes."
