#!/bin/bash
# ============================================================================
# scripts/setup-core.sh
# Script per il setup iniziale del pacchetto core
# ====

set -e

echo "🚀 Setting up @webadb-forensics/core package..."
echo ""

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per stampare con colore
print_color() {
    color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Check Node.js version
print_color $BLUE "📦 Checking Node.js version..."
if ! command -v node &> /dev/null; then
    print_color $RED "❌ Node.js not found. Please install Node.js 18+"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    print_color $RED "❌ Node.js 18+ required. Current: $(node -v)"
    exit 1
fi

print_color $GREEN "✅ Node.js version: $(node -v)"
echo ""

# Check/Install pnpm
print_color $BLUE "📦 Checking pnpm..."
if ! command -v pnpm &> /dev/null; then
    print_color $YELLOW "⚠️  pnpm not found. Installing..."
    corepack enable
    corepack prepare pnpm@8 --activate
fi

print_color $GREEN "✅ pnpm version: $(pnpm -v)"
echo ""

# Navigate to core package directory
cd "$(dirname "$0")/../packages/core" || exit 1

# Install dependencies
print_color $BLUE "📦 Installing dependencies..."
pnpm install --frozen-lockfile

print_color $GREEN "✅ Dependencies installed"
echo ""

# Type check
print_color $BLUE "🔍 Running type check..."
if pnpm typecheck; then
    print_color $GREEN "✅ Type check passed"
else
    print_color $RED "❌ Type check failed"
    exit 1
fi
echo ""

# Lint
print_color $BLUE "🧹 Running linter..."
if pnpm lint; then
    print_color $GREEN "✅ Linting passed"
else
    print_color $YELLOW "⚠️  Linting warnings found (continuing...)"
fi
echo ""

# Build
print_color $BLUE "🔨 Building package..."
if pnpm build; then
    print_color $GREEN "✅ Build successful"
    print_color $GREEN "   - CommonJS: dist/index.js"
    print_color $GREEN "   - ESM: dist/index.mjs"
    print_color $GREEN "   - Types: dist/index.d.ts"
else
    print_color $RED "❌ Build failed"
    exit 1
fi
echo ""

# Run tests
print_color $BLUE "🧪 Running tests..."
if pnpm test; then
    print_color $GREEN "✅ All tests passed"
else
    print_color $RED "❌ Some tests failed"
    exit 1
fi
echo ""

# Coverage
print_color $BLUE "📊 Generating coverage report..."
if pnpm test:coverage; then
    print_color $GREEN "✅ Coverage report generated"
    print_color $GREEN "   View report: packages/core/coverage/index.html"
else
    print_color $YELLOW "⚠️  Coverage generation failed (continuing...)"
fi
echo ""

print_color $GREEN "✅ Setup complete!"
echo ""
print_color $BLUE "📝 Next steps:"
echo "   cd packages/core"
echo "   pnpm test:watch      # Run tests in watch mode"
echo "   pnpm test:ui         # Run tests with UI"
echo "   pnpm dev             # Build in watch mode"
echo ""
print_color $BLUE "🔗 Package ready to use:"
echo "   import { ADBConnection } from '@webadb-forensics/core';"
echo ""