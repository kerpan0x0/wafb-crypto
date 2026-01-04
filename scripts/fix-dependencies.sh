
#!/bin/bash

set -e

echo "🔧 Fixing @yume-chan dependencies for WABF..."
echo ""

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

print_color() {
    color=$1
    shift
    echo -e "${color}$@${NC}"
}

cd "$(dirname "$0")/../packages/core" || exit 1

print_color $BLUE "📦 Current directory: $(pwd)"
echo ""

# Remove node_modules and lock file
print_color $BLUE "🧹 Cleaning node_modules..."
rm -rf node_modules pnpm-lock.yaml

print_color $BLUE "📦 Installing @yume-chan packages..."

# Install dependencies one by one to ensure they're all fetched
pnpm add @yume-chan/adb@^0.0.24
pnpm add @yume-chan/adb-daemon-webusb@^0.0.24
pnpm add @yume-chan/stream-extra@^0.0.24
pnpm add @yume-chan/struct@^0.0.24

print_color $BLUE "📦 Installing other dependencies..."
pnpm install

print_color $GREEN "✅ Dependencies fixed!"
echo ""

print_color $BLUE "🔍 Verifying installation..."
DEPS=(
    "@yume-chan/adb"
    "@yume-chan/adb-daemon-webusb"
    "@yume-chan/stream-extra"
    "@yume-chan/struct"
)

for dep in "${DEPS[@]}"; do
    if [ -d "node_modules/$dep" ]; then
        VERSION=$(cat "node_modules/$dep/package.json" | grep '"version"' | head -1 | awk -F'"' '{print $4}')
        print_color $GREEN "   ✅ $dep@$VERSION"
    else
        print_color $RED "   ❌ $dep not found!"
    fi
done

echo ""
print_color $GREEN "✅ All dependencies should now be available"
print_color $BLUE "Try running: pnpm build"
