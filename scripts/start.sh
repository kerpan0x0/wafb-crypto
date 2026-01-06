#!/bin/bash
# WAFB Launcher Script - Start the web UI with proper setup

set -e  # Exit on error

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════════╗"
    echo "║                                                    ║"
    echo "║           WAFB - WebADB Forensics Bridge          ║"
    echo "║                                                    ║"
    echo "╚════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_status() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "Please run this script from the project root directory"
    exit 1
fi

print_header

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_warning "Dependencies not installed"
    print_info "Installing dependencies..."
    pnpm install
    print_status "Dependencies installed"
fi

# Check if core is built
if [ ! -d "packages/core/dist" ]; then
    print_warning "Core package not built"
    print_info "Building @wafb/core..."
    pnpm --filter @wafb/core build
    print_status "Core package built"
else
    print_status "Core package already built"
fi

# Check if web dependencies are installed
if [ ! -d "packages/web/node_modules" ]; then
    print_warning "Web package dependencies not installed"
    print_info "Installing web dependencies..."
    pnpm --filter @wafb/web install
    print_status "Web dependencies installed"
fi

echo ""
print_info "Starting development server..."
echo ""
print_status "Web UI will open at: ${BLUE}http://localhost:3000${NC}"
print_status "Press ${YELLOW}Ctrl+C${NC} to stop"
echo ""
print_warning "Remember: Chrome/Edge browser required for WebUSB"
print_warning "Remember: Stop ADB server first (adb kill-server)"
echo ""

# Start the dev server
pnpm --filter @wafb/web dev