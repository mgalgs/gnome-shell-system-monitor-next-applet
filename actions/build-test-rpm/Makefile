images: image-fc43 image-fc42 image-fc41

image-fc43: entry.sh Dockerfile
	docker build --build-arg FEDORA_VERSION=43 . -t mgalgs/system-monitor-next-build-test-rpm:fc43

image-fc42: entry.sh Dockerfile
	docker build --build-arg FEDORA_VERSION=42 . -t mgalgs/system-monitor-next-build-test-rpm:fc42

image-fc41: entry.sh Dockerfile
	docker build --build-arg FEDORA_VERSION=41 . -t mgalgs/system-monitor-next-build-test-rpm:fc41
