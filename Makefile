.PHONY: help install build clean dev dev-web dev-core test lint format start

# Colors
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m # No Color

help: ## Show this help message
	@echo "$(BLUE)WAFB - WebADB Forensics Bridge$(NC)"
	@echo ""
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(NC) %s\n", $$1, $$2}'

install: ## Install all dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	pnpm install
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

build: ## Build all packages
	@echo "$(BLUE)Building all packages...$(NC)"
	pnpm build
	@echo "$(GREEN)✓ All packages built$(NC)"

build-core: ## Build only core package
	@echo "$(BLUE)Building @wafb/core...$(NC)"
	pnpm --filter @wafb/core build
	@echo "$(GREEN)✓ Core built$(NC)"

build-web: ## Build only web package
	@echo "$(BLUE)Building @wafb/web...$(NC)"
	pnpm --filter @wafb/web build
	@echo "$(GREEN)✓ Web built$(NC)"

clean: ## Clean all build artifacts and dependencies
	@echo "$(BLUE)Cleaning...$(NC)"
	pnpm clean
	@echo "$(GREEN)✓ Cleaned$(NC)"

dev: ## Start all packages in dev mode
	@echo "$(BLUE)Starting dev mode for all packages...$(NC)"
	pnpm dev

dev-web: build-core ## Start only web UI (builds core first)
	@echo "$(BLUE)Starting web UI...$(NC)"
	@echo "$(YELLOW)⚠ Remember: Chrome/Edge required + adb kill-server$(NC)"
	pnpm --filter @wafb/web dev

dev-core: ## Start only core in watch mode
	@echo "$(BLUE)Starting core in watch mode...$(NC)"
	pnpm --filter @wafb/core dev

test: ## Run all tests
	@echo "$(BLUE)Running tests...$(NC)"
	pnpm test

lint: ## Run linter
	@echo "$(BLUE)Running linter...$(NC)"
	pnpm lint

lint-fix: ## Fix linting issues
	@echo "$(BLUE)Fixing linting issues...$(NC)"
	pnpm lint:fix

format: ## Format code with prettier
	@echo "$(BLUE)Formatting code...$(NC)"
	pnpm format

typecheck: ## Run TypeScript type checking
	@echo "$(BLUE)Type checking...$(NC)"
	pnpm typecheck

start: ## Quick start - build core and run web UI
	@echo "$(BLUE)╔════════════════════════════════════════════════════╗$(NC)"
	@echo "$(BLUE)║          Starting WAFB Web UI                      ║$(NC)"
	@echo "$(BLUE)╚════════════════════════════════════════════════════╝$(NC)"
	@echo ""
	@if [ ! -d "node_modules" ]; then \
		echo "$(YELLOW)⚠ Installing dependencies...$(NC)"; \
		pnpm install; \
	fi
	@if [ ! -d "packages/core/dist" ]; then \
		echo "$(YELLOW)⚠ Building core package...$(NC)"; \
		pnpm --filter @wafb/core build; \
	fi
	@echo ""
	@echo "$(GREEN)✓ Web UI starting at http://localhost:3000$(NC)"
	@echo "$(YELLOW)⚠ Remember: Chrome/Edge required$(NC)"
	@echo "$(YELLOW)⚠ Remember: Run 'adb kill-server' first$(NC)"
	@echo ""
	@pnpm --filter @wafb/web dev

preview: ## Preview production build
	@echo "$(BLUE)Starting preview server...$(NC)"
	pnpm preview