# 统一命令入口：本地开发与 CI 共用同一套检查，避免多套脚本漂移。
# 提交前只需执行：make check
# Go 不在 PATH 时可覆盖：make GO=/usr/local/go/bin/go GOFMT=/usr/local/go/bin/gofmt check

GO ?= go
GOFMT ?= gofmt

.PHONY: fmt gofmt-check lint test test-race build check
.PHONY: check-modules check-names check-layers check-roadmap check-mapping check-standard check-backend check-storefront check-admin check-migration check-security

fmt:
	$(GOFMT) -w ./cmd ./internal ./tests
	cd web/storefront && npm run format
	cd web/admin && npm run format

gofmt-check:
	@out="$$($(GOFMT) -l ./cmd ./internal ./tests)"; \
	if [ -n "$$out" ]; then \
		echo "gofmt 未通过（先运行 make fmt）："; \
		echo "$$out"; \
		exit 1; \
	fi

lint:
	$(GO) vet ./...
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo "golangci-lint 未安装，跳过（安装后自动启用）"; \
	fi
	cd web/storefront && npm run lint
	cd web/storefront && npm run typecheck
	cd web/admin && npm run lint
	cd web/admin && npm run typecheck

test:
	$(GO) test ./...
	cd web/storefront && npm test
	cd web/admin && npm test

test-race:
	$(GO) test -race ./...

build:
	cd web/storefront && npm run build
	cd web/admin && npm run build
	$(GO) build -tags production ./...

check: lint check-modules check-names check-layers check-roadmap check-mapping check-standard test build

# —— CI 工作流按职责复用同一套命令（避免本地一套、CI 另一套）——
check-backend: gofmt-check check-modules check-names check-layers check-roadmap check-mapping check-standard
	$(GO) vet ./...
	@if command -v golangci-lint >/dev/null 2>&1; then \
		golangci-lint run ./...; \
	else \
		echo "golangci-lint 未安装，跳过（安装后自动启用）"; \
	fi
	$(GO) test ./... -count=1
	$(GO) build ./...

check-storefront: check-names
	cd web/storefront && npm run format:check
	cd web/storefront && npm run lint
	cd web/storefront && npm run typecheck
	cd web/storefront && npm test
	cd web/storefront && npm run build

check-admin: check-names
	cd web/admin && npm run gen:api
	git diff --exit-code -- web/admin/src/generated/api/types.ts
	cd web/admin && npm run format:check
	cd web/admin && npm run lint
	cd web/admin && npm run typecheck
	cd web/admin && npm test
	cd web/admin && npm run build

check-migration:
	$(GO) test ./internal/platform/database/sqlite/... -count=1
	$(GO) test ./internal/platform/database/sqlite/schema/... -count=1
	$(GO) test ./tests/integration/ -run 'TestMigration' -count=1

check-modules:
	bash scripts/check-modules.sh

check-names:
	bash scripts/check-names.sh

check-layers:
	bash scripts/check-layers.sh

check-roadmap:
	bash scripts/check-roadmap.sh

check-mapping:
	bash scripts/check-mapping.sh

check-standard:
	bash scripts/check-standard.sh

check-security:
	@if command -v govulncheck >/dev/null 2>&1; then \
		govulncheck ./...; \
	else \
		echo "govulncheck 未安装，跳过（安全 CI 会先安装再执行）"; \
	fi
	bash scripts/node-audit.sh web/admin
	bash scripts/node-audit.sh web/storefront
	bash scripts/security-scan.sh
