#!/bin/bash

set -e

echo "🚀 Upgrading WABF to @yume-chan/adb v2.x..."
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$SCRIPT_DIR/../packages/core"

cd "$CORE_DIR" || exit 1

echo "📂 Working in: $(pwd)"
echo ""

# 1. Backup old package.json
echo "💾 Creating backup..."
cp package.json package.json.backup

# 2. Clean
echo "🧹 Cleaning old installation..."
rm -rf node_modules pnpm-lock.yaml dist coverage

# 3. Remove old dependencies
echo "🗑️  Removing old @yume-chan packages..."
pnpm remove @yume-chan/adb @yume-chan/adb-daemon-webusb @yume-chan/stream-extra @yume-chan/struct 2>/dev/null || true

# 4. Install new versions
echo "📦 Installing @yume-chan v2.x packages..."
pnpm add @yume-chan/adb@latest
pnpm add @yume-chan/android-bin@latest
pnpm add @yume-chan/scrcpy@latest
pnpm add @yume-chan/stream-extra@latest
pnpm add @yume-chan/struct@latest

# 5. Add WebUSB types
echo "🔧 Adding WebUSB types..."
pnpm add -D @types/w3c-web-usb

# 6. Install other dependencies
echo "📦 Installing other dependencies..."
pnpm install

# 7. Check versions
echo ""
echo "✅ Installed versions:"
pnpm list --depth=0 | grep @yume-chan

# 8. Try to build
echo ""
echo "🔨 Testing build..."
if pnpm build; then
    echo ""
    echo "✅ SUCCESS! Upgrade complete"
    echo ""
    echo "Generated files:"
    ls -lh dist/
    echo ""
    echo "You can now:"
    echo "  - pnpm test        # Run tests"
    echo "  - pnpm typecheck   # Check types"
    echo "  - pnpm dev         # Start development"
else
    echo ""
    echo "⚠️  Build failed but dependencies are upgraded"
    echo "Check the errors above and fix any API incompatibilities"
    echo ""
    echo "Backup saved at: package.json.backup"
fi
