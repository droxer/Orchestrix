DEVBOX_IMAGE := orchestrix-devbox:v1
OCI_DIR := .oci/orchestrix-devbox-v1
DOCKERFILE := dockerfile
IMAGE_ID_FILE := $(OCI_DIR)/.docker-image-id

.PHONY: devbox-image devbox-oci run run-fresh stop

devbox-image:
	docker build -t $(DEVBOX_IMAGE) -f $(DOCKERFILE) .

devbox-oci: devbox-image
	mkdir -p $(OCI_DIR)
	docker save $(DEVBOX_IMAGE) | tar -xf - -C $(OCI_DIR)
	docker image inspect $(DEVBOX_IMAGE) --format='{{.Id}}' > $(IMAGE_ID_FILE)

run:
	uv run python -m orchestrix

run-fresh: devbox-oci
	uv run python -m orchestrix

stop:
	-pkill -f "orchestrix|orchestrator.py" 2>/dev/null
	-pkill -f "boxlite-shim" 2>/dev/null
	-rm -f $(HOME)/.boxlite/.lock
	@echo "Stopped orchestrator and BoxLite processes."
