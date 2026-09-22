# Usage:
#   make images            # normal build
#   make images NOCACHE=1  # build without cache

NOCACHE_FLAG :=
ifeq ($(NOCACHE),1)
  NOCACHE_FLAG := --no-cache
endif

images: image-fc44 image-fc43 image-fc42 image-fc41

image-fc44: entry.sh Dockerfile
	docker build $(NOCACHE_FLAG) --build-arg FEDORA_VERSION=44 . -t mgalgs/system-monitor-next-build-test-rpm:fc44

image-fc43: entry.sh Dockerfile
	docker build $(NOCACHE_FLAG) --build-arg FEDORA_VERSION=43 . -t mgalgs/system-monitor-next-build-test-rpm:fc43

image-fc42: entry.sh Dockerfile
	docker build $(NOCACHE_FLAG) --build-arg FEDORA_VERSION=42 . -t mgalgs/system-monitor-next-build-test-rpm:fc42

image-fc41: entry.sh Dockerfile
	docker build $(NOCACHE_FLAG) --build-arg FEDORA_VERSION=41 . -t mgalgs/system-monitor-next-build-test-rpm:fc41
