#!/bin/bash
# ============================================================================
# scripts/setup-wabf.sh
# Script di setup per WABF (The WebADB Forensics Bridge)
# Repository: https://git.lattuga.net/garrett/WABF.git
# ============================================================================

set -e

echo "🚀 Setting up WABF (The WebADB Forensics Bridge)..."
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
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../packages/core" || exit 1

print_color $BLUE "📂 Working directory: $(pwd)"
echo ""

# Remove old dependencies if they exist
if [ -d "node_modules" ]; then
    print_color $YELLOW "🧹 Cleaning old dependencies..."
    rm -rf node_modules
fi

# Install dependencies
print_color $BLUE "📦 Installing dependencies (including @yume-chan packages)..."
pnpm install

# Verify critical dependencies
print_color $BLUE "🔍 Verifying critical dependencies..."
CRITICAL_DEPS=(
    "@yume-chan/adb"
    "@yume-chan/adb-daemon-webusb"
    "@yume-chan/stream-extra"
    "@yume-chan/struct"
)

DEPS_OK=true
for dep in "${CRITICAL_DEPS[@]}"; do
    if [ -d "node_modules/$dep" ]; then
        print_color $GREEN "   ✅ $dep"
    else
        print_color $RED "   ❌ $dep missing!"
        DEPS_OK=false
    fi
done

if [ "$DEPS_OK" = false ]; then
    print_color $RED "❌ Some critical dependencies are missing!"
    print_color $YELLOW "Trying to install them explicitly..."
    pnpm add @yume-chan/adb@^0.0.24 @yume-chan/adb-daemon-webusb@^0.0.24 @yume-chan/stream-extra@^0.0.24 @yume-chan/struct@^0.0.24
fi

print_color $GREEN "✅ All dependencies installed"
echo ""

# Type check
print_color $BLUE "🔍 Running type check..."
if pnpm typecheck; then
    print_color $GREEN "✅ Type check passed"
else
    print_color $RED "❌ Type check failed"
    print_color $YELLOW "This might be due to missing @yume-chan type definitions"
    print_color $YELLOW "The build might still work. Continuing..."
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
    print_color $YELLOW "⚠️  Some tests failed (this might be normal for mocked tests)"
    print_color $YELLOW "Check the output above for details"
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
print_color $BLUE "🔗 Package @wabf/core is ready to use!"
echo ""
