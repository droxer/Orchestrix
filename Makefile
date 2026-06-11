DEVBOX_IMAGE := relay-devbox:v1
OCI_DIR := .oci/relay-devbox-v1
DOCKERFILE := dockerfile
IMAGE_ID_FILE := $(OCI_DIR)/.docker-image-id
DOCKERFILE_MTIME_FILE := $(OCI_DIR)/.dockerfile-mtime
PORT ?= 8787
DAEMON_PORT ?= 8790
RELAY_DAEMON_URL ?= http://127.0.0.1:$(DAEMON_PORT)
EMPLOYEE_ID ?= $(USER)
SANDBOX_ID ?= sbx_$(EMPLOYEE_ID)
DAEMON_NODE_TOKEN ?=
WORKSPACE ?=

.PHONY: devbox-image devbox-check devbox-oci build test run daemon daemon-node run-with-daemon serve web run-fresh stop

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

run:
	RELAY_DAEMON_URL="$(RELAY_DAEMON_URL)" RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" RELAY_DAEMON_NODE_TOKEN="$(DAEMON_NODE_TOKEN)" WORKSPACE="$(WORKSPACE)" npm run run

daemon: build
	node packages/relay-daemon/dist/daemon-cli.js --port $(DAEMON_PORT)

daemon-node: build
	@echo "Starting daemon node on host for protocol/debug use. In production this process runs inside the employee sandbox."
	RELAY_DAEMON_URL="$(RELAY_DAEMON_URL)" RELAY_EMPLOYEE_ID="$(EMPLOYEE_ID)" RELAY_DAEMON_NODE_TOKEN="$(DAEMON_NODE_TOKEN)" RELAY_WORKSPACE="$(WORKSPACE)" node packages/relay-daemon/dist/daemon-node-cli.js --sandbox-id $(SANDBOX_ID)

run-with-daemon: run

serve: build
	node packages/relay-daemon/dist/cli.js serve --port $(PORT)

web:
	RELAY_DAEMON_URL="$(RELAY_DAEMON_URL)" npm run dev -w relay-web

run-fresh: devbox-oci
	RELAY_WORKSPACE="$(WORKSPACE)" npm run run

stop:
	-pkill -f "node packages/relay-daemon/dist/daemon-cli.js" 2>/dev/null
	-pkill -f "node packages/relay-daemon/dist/daemon-node-cli.js" 2>/dev/null
	-pkill -f "node packages/relay-tui/dist/cli.js$$" 2>/dev/null
	-pkill -f "npm run run" 2>/dev/null
	-pkill -f "boxlite-shim" 2>/dev/null
	-node -e "import('@boxlite-ai/boxlite').then(async ({JsBoxlite}) => { const rt = JsBoxlite.withDefaultConfig(); for (const box of await rt.listInfo()) { if ((box.name || '').startsWith('relay')) await rt.remove(box.name || box.id, true).catch(() => undefined); } }).catch(() => undefined)"
	-rm -f $(HOME)/.boxlite/.lock
	@echo "Stopped orchestrator and BoxLite processes."
