DEVBOX_IMAGE := relay-devbox:v1
OCI_DIR := .oci/relay-devbox-v1
DOCKERFILE := dockerfile
IMAGE_ID_FILE := $(OCI_DIR)/.docker-image-id
DOCKERFILE_MTIME_FILE := $(OCI_DIR)/.dockerfile-mtime

.PHONY: devbox-image devbox-check devbox-oci build test run run-fresh stop

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
	npm run run

run-fresh: devbox-oci
	npm run run

stop:
	-pkill -f "relay|dist/src/index.js" 2>/dev/null
	-pkill -f "boxlite-shim" 2>/dev/null
	-rm -f $(HOME)/.boxlite/.lock
	@echo "Stopped orchestrator and BoxLite processes."
