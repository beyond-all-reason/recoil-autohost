#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Global variables for cleanup
DOCKER_RUNNING=false
ENGINE_DOWNLOADED=false
TEMP_FILES=()
REBUILD=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -rebuild)
            REBUILD=true
            shift
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            echo "Usage: $0 [-rebuild]"
            exit 1
            ;;
    esac
done

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Cleanup function
cleanup() {
    echo -e "${BLUE}Cleaning up...${NC}"
    
    # Stop Docker services if they're running
    if [ "$DOCKER_RUNNING" = true ]; then
        echo -e "${BLUE}Stopping Docker services...${NC}"
        cd "${SCRIPT_DIR}" && sudo docker compose down || true
    fi
    
    # Clean up downloaded engine file
    if [ -f "${SCRIPT_DIR}/engine.7z" ]; then
        echo -e "${BLUE}Cleaning up downloaded engine file...${NC}"
        rm -f "${SCRIPT_DIR}/engine.7z" || true
    fi

    # Clean up any temporary files
    for file in "${TEMP_FILES[@]}"; do
        if [ -f "$file" ]; then
            echo -e "${BLUE}Removing temporary file: $file${NC}"
            rm -f "$file" || true
        fi
    done

    # Clean up engines and instances directories
    echo -e "${BLUE}Cleaning up engines and instances directories...${NC}"
    rm -rf "${SCRIPT_DIR}/engines" || true
    rm -rf "${SCRIPT_DIR}/instances" || true
    
    # Clean up src directory
    echo -e "${BLUE}Cleaning up src directory...${NC}"
    rm -rf "${SCRIPT_DIR}/src" || true
    
    echo -e "${GREEN}Cleanup complete${NC}"
}

# Set up cleanup on script exit (normal exit, error, or interrupt)
trap cleanup EXIT
trap 'exit 1' ERR
trap 'exit 1' INT

echo -e "${BLUE}Setting up test environment...${NC}"

# Create necessary directories if they don't exist
cd "${SCRIPT_DIR}"
mkdir -p engines instances

# Download and extract the specific engine version
ENGINE_VERSION="105.1.1-2590-gb9462a0 BAR105"
ENGINE_DIR="${SCRIPT_DIR}/engines/${ENGINE_VERSION}"

if [ ! -d "${ENGINE_DIR}" ]; then
    echo -e "${BLUE}Downloading engine...${NC}"
    cd "${SCRIPT_DIR}"
    curl -L "https://github.com/beyond-all-reason/spring/releases/download/spring_bar_%7BBAR105%7D105.1.1-2590-gb9462a0/spring_bar_.BAR105.105.1.1-2590-gb9462a0_linux-64-minimal-portable.7z" -o engine.7z
    ENGINE_DOWNLOADED=true
    TEMP_FILES+=("${SCRIPT_DIR}/engine.7z")
    
    echo -e "${BLUE}Extracting engine...${NC}"
    7z x engine.7z -o"${ENGINE_DIR}" || {
        echo -e "${RED}Failed to extract engine${NC}"
        exit 1
    }
fi

# Start Docker services
echo -e "${BLUE}Starting Docker services...${NC}"
cd "${SCRIPT_DIR}"
if [ "$REBUILD" = true ]; then
    echo -e "${BLUE}Rebuilding containers...${NC}"
    sudo docker compose build --no-cache
fi
sudo docker compose up -d || {
    echo -e "${RED}Failed to start Docker services${NC}"
    exit 1
}
DOCKER_RUNNING=true

# Wait for services to start
echo -e "${BLUE}Waiting for services to start...${NC}"
sleep 10

# Check if services are running
if ! sudo docker compose ps | grep -q "recoil-autohost.*running"; then
    echo -e "${RED}Error: recoil-autohost service is not running${NC}"
    sudo docker compose logs recoil-autohost
    exit 1
fi

# Subscribe to updates
echo -e "${BLUE}Subscribing to updates...${NC}"
TIMESTAMP=$(date '+%s%6N')
curl --json "{\"since\":$TIMESTAMP}" http://127.0.0.1:8084/request/0/subscribeUpdates || {
    echo -e "${RED}Failed to subscribe to updates${NC}"
    exit 1
}

# Start the battle
echo -e "${BLUE}Starting battle...${NC}"
BATTLE_ID=$(uuidgen -r)
jq ".battleId = \"$BATTLE_ID\"" "${SCRIPT_DIR}/start.json" | curl --json @- http://127.0.0.1:8084/request/0/start || {
    echo -e "${RED}Failed to start battle${NC}"
    exit 1
}

echo -e "${GREEN}Test environment is ready!${NC}"
echo -e "${GREEN}To join the game, run:${NC}"
echo -e "${BLUE}cd ${SCRIPT_DIR} && ./engines/105.1.1-2590-gb9462a0\\ BAR105/spring --isolation --write-dir \"\$(pwd)/instances\" spring://Player:password1@127.0.0.1:20001${NC}"

# Keep script running until user interrupts
echo -e "${BLUE}Press Ctrl+C to stop the test environment${NC}"
echo -e "${BLUE}To view logs: cd ${SCRIPT_DIR} && sudo docker compose logs -f${NC}"
wait 