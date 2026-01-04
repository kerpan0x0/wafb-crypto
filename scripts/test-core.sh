# ============================================================================
# scripts/test-core.sh
# Script per eseguire tutti i test del pacchetto core
# ============================================================================

#!/bin/bash

set -e

echo "🧪 Running @webadb-forensics/core test suite..."
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

# Parse arguments
WATCH=false
UI=false
COVERAGE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --watch|-w)
            WATCH=true
            shift
            ;;
        --ui|-u)
            UI=true
            shift
            ;;
        --coverage|-c)
            COVERAGE=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--watch|-w] [--ui|-u] [--coverage|-c]"
            exit 1
            ;;
    esac
done

if [ "$WATCH" = true ]; then
    print_color $BLUE "🔄 Running tests in watch mode..."
    pnpm test:watch
elif [ "$UI" = true ]; then
    print_color $BLUE "🎨 Running tests with UI..."
    pnpm test:ui
elif [ "$COVERAGE" = true ]; then
    print_color $BLUE "📊 Running tests with coverage..."
    pnpm test:coverage
    
    if [ -f "coverage/index.html" ]; then
        print_color $GREEN "✅ Coverage report generated!"
        print_color $BLUE "📊 Open coverage/index.html to view detailed report"
        
        # Try to open in browser (macOS/Linux)
        if command -v open &> /dev/null; then
            open coverage/index.html
        elif command -v xdg-open &> /dev/null; then
            xdg-open coverage/index.html
        fi
    fi
else
    print_color $BLUE "🧪 Running all tests..."
    pnpm test
fi

echo ""
print_color $GREEN "✅ Test suite completed!"
