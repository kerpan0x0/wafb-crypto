# ============================================================================
# Makefile per il progetto (opzionale ma utile)
# packages/core/Makefile
# ============================================================================

.PHONY: help install build test test-watch test-ui coverage clean lint typecheck dev verify

# Default target
help:
	@echo "Available targets:"
	@echo "  install      - Install dependencies"
	@echo "  build        - Build the package"
	@echo "  test         - Run tests"
	@echo "  test-watch   - Run tests in watch mode"
	@echo "  test-ui      - Run tests with UI"
	@echo "  coverage     - Generate coverage report"
	@echo "  lint         - Run linter"
	@echo "  typecheck    - Run type checker"
	@echo "  dev          - Start development mode"
	@echo "  verify       - Verify package setup"
	@echo "  clean        - Clean build artifacts"

install:
	pnpm install --frozen-lockfile

build:
	pnpm build

test:
	pnpm test

test-watch:
	pnpm test:watch

test-ui:
	pnpm test:ui

coverage:
	pnpm test:coverage

lint:
	pnpm lint

typecheck:
	pnpm typecheck

dev:
	pnpm dev

verify:
	@bash ../../scripts/verify-core.sh

clean:
	pnpm clean
	rm -rf node_modules