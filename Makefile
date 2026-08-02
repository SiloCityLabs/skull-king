# Cloudflare Pages is configured with: Build command = `make build`, Output = `_site`
.PHONY: build

build:
	@chmod +x scripts/build-site.sh
	./scripts/build-site.sh
