#!/bin/bash

set -e

echo "🚀 Setting up WebADB Forensics Bridge for GitLab..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required. Current: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install pnpm if not present
if ! command -v pnpm &> /dev/null; then
    echo "📦 Installing pnpm..."
    corepack enable
    corepack prepare pnpm@8 --activate
fi

echo "✅ pnpm version: $(pnpm -v)"

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

# Setup git hooks
echo "🪝 Setting up git hooks..."
pnpm prepare

# Build core package
echo "🔨 Building core package..."
pnpm --filter @webadb-forensics/core build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  pnpm dev              # Start development"
echo "  pnpm test             # Run tests"
echo "  pnpm build            # Build all packages"
echo ""
echo "GitLab CI/CD will automatically:"
echo "  - Run tests on every push"
echo "  - Build Docker images"
echo "  - Deploy to staging/production"
echo ""