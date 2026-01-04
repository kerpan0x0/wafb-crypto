#!/bin/bash
set -e

echo "🚀 Setting up WABF..."

# Check Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js 18+ required"
    exit 1
fi

# Install pnpm
if ! command -v pnpm &> /dev/null; then
    corepack enable
    corepack prepare pnpm@8 --activate
fi

# Install dependencies
pnpm install

# Build core
cd packages/core
pnpm build

echo "✅ Setup complete!"