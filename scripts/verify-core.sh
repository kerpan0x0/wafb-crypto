# ============================================================================
# scripts/verify-core.sh
# Script per verificare l'installazione del pacchetto core
# ============================================================================

#!/bin/bash

set -e

echo "🔍 Verifying @webadb-forensics/core package..."
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_color() {
    color=$1
    shift
    echo -e "${color}$@${NC}"
}

cd "$(dirname "$0")/../packages/core" || exit 1

# Check if dist exists
print_color $BLUE "📁 Checking build output..."
if [ -d "dist" ]; then
    print_color $GREEN "✅ dist/ directory exists"
    
    # Check for main files
    if [ -f "dist/index.js" ] && [ -f "dist/index.mjs" ] && [ -f "dist/index.d.ts" ]; then
        print_color $GREEN "✅ All build artifacts present"
        
        # Show file sizes
        echo ""
        print_color $BLUE "📦 Build artifacts:"
        ls -lh dist/index.* | awk '{print "   " $9 ": " $5}'
    else
        print_color $RED "❌ Missing build artifacts"
        exit 1
    fi
else
    print_color $RED "❌ dist/ directory not found. Run: pnpm build"
    exit 1
fi
echo ""

# Check node_modules
print_color $BLUE "📦 Checking dependencies..."
if [ -d "node_modules" ]; then
    print_color $GREEN "✅ node_modules exists"
    
    # Check critical dependencies
    DEPS=("@yume-chan/adb" "@yume-chan/stream-extra" "vitest")
    for dep in "${DEPS[@]}"; do
        if [ -d "node_modules/$dep" ]; then
            print_color $GREEN "   ✅ $dep"
        else
            print_color $RED "   ❌ $dep missing"
        fi
    done
else
    print_color $RED "❌ node_modules not found. Run: pnpm install"
    exit 1
fi
echo ""

# Run quick tests
print_color $BLUE "🧪 Running quick test suite..."
if pnpm test --reporter=dot --run; then
    print_color $GREEN "✅ Tests passed"
else
    print_color $RED "❌ Tests failed"
    exit 1
fi
echo ""

# Type check
print_color $BLUE "🔍 Type checking..."
if pnpm typecheck; then
    print_color $GREEN "✅ Type check passed"
else
    print_color $RED "❌ Type check failed"
    exit 1
fi
echo ""

# Show package info
print_color $BLUE "📋 Package information:"
pnpm list --depth=0 2>/dev/null | head -n 5
echo ""

print_color $GREEN "✅ Verification complete!"
print_color $GREEN "Package @webadb-forensics/core is ready to use!"
echo ""
