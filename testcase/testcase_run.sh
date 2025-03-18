#!/bin/bash
set -e

# Check if running as root/sudo
if [ "$EUID" -ne 0 ]; then
    echo "Please run this script as root (sudo ./testcase_run.sh)"
    exit 1
fi

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Global variables
DOCKER_RUNNING=false
DEBUG=false
TEST_TIMEOUT=60  # Timeout in seconds
TEST_START_TIME=0
TEST_STATUS="NOT_STARTED"
CLEANUP_DONE=false
LOG_PID=""

# Function to print section headers
print_header() {
    echo -e "\n${YELLOW}=== $1 ===${NC}"
}

# Function to print status updates
print_status() {
    echo -e "${BLUE}➜ $1${NC}"
}

# Function to print success messages
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error messages
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to clean directories
clean_directories() {
    local dir="$1"
    print_status "Cleaning directory: $dir"
    if [ -d "$dir" ]; then
        # First try to remove contents only
        rm -rf "${dir:?}"/* 2>/dev/null || {
            # If that fails, try with sudo
            sudo rm -rf "${dir:?}"/* 2>/dev/null || {
                print_error "Failed to clean $dir"
                return 1
            }
        }
        print_success "Cleaned $dir"
    fi
}

# Function to start log streaming in background
start_log_streaming() {
    if [ "$DEBUG" = true ]; then
        print_status "Starting log streaming..."
        docker compose logs -f &
        LOG_PID=$!
    fi
}

# Function to stop log streaming
stop_log_streaming() {
    if [ -n "$LOG_PID" ]; then
        kill $LOG_PID 2>/dev/null || true
        LOG_PID=""
    fi
}

# Cleanup function
cleanup() {
    # Prevent duplicate cleanup
    if [ "$CLEANUP_DONE" = true ]; then
        return
    fi
    CLEANUP_DONE=true

    # Stop log streaming if active
    stop_log_streaming

    print_header "Cleanup"
    
    # Print test status
    case $TEST_STATUS in
        "SUCCESS")
            print_success "Test completed successfully"
            ;;
        "TIMEOUT")
            print_error "Test timed out after $TEST_TIMEOUT seconds"
            ;;
        "FAILED")
            print_error "Test failed"
            ;;
        *)
            print_status "Test was interrupted"
            ;;
    esac
    
    # Stop Docker services if they're running
    if [ "$DOCKER_RUNNING" = true ]; then
        print_status "Stopping Docker services..."
        cd "${SCRIPT_DIR}" && docker compose down || true
    fi

    # Clean up directories
    print_status "Cleaning up test directories..."
    clean_directories "${SCRIPT_DIR}/engines"
    clean_directories "${SCRIPT_DIR}/instances"
    
    # Exit with appropriate status code
    case $TEST_STATUS in
        "SUCCESS")
            exit 0
            ;;
        *)
            exit 1
            ;;
    esac
}

# Function to check if test has timed out
check_timeout() {
    if [ $TEST_START_TIME -ne 0 ]; then
        current_time=$(date +%s)
        elapsed=$((current_time - TEST_START_TIME))
        if [ $elapsed -gt $TEST_TIMEOUT ]; then
            TEST_STATUS="TIMEOUT"
            print_error "Test timed out after $TEST_TIMEOUT seconds"
            cleanup
        fi
    fi
}

# Set up cleanup traps for various exit scenarios
trap cleanup EXIT
trap 'TEST_STATUS="INTERRUPTED"; cleanup' INT TERM

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -debug)
            DEBUG=true
            shift
            ;;
        -timeout)
            shift
            if [[ $1 =~ ^[0-9]+$ ]]; then
                TEST_TIMEOUT=$1
                shift
            else
                print_error "Invalid timeout value: $1"
                echo "Usage: $0 [-debug] [-timeout seconds]"
                exit 1
            fi
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Usage: $0 [-debug] [-timeout seconds]"
            exit 1
            ;;
    esac
done

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header "Test Environment Setup"
TEST_START_TIME=$(date +%s)

print_header "Starting Services"

# Start Docker services
cd "${SCRIPT_DIR}"
print_status "Starting Docker services..."
docker compose up -d || {
    TEST_STATUS="FAILED"
    print_error "Failed to start Docker services"
    exit 1
}
DOCKER_RUNNING=true

# Start log streaming if debug mode is enabled
start_log_streaming

# Wait for containers to be ready
print_status "Waiting for containers to be ready..."
max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if docker compose ps | grep -q "healthy"; then
        print_success "Containers are ready"
        break
    fi
    print_status "Waiting for containers (attempt $attempt/$max_attempts)..."
    sleep 2
    ((attempt++))
done

if [ $attempt -gt $max_attempts ]; then
    TEST_STATUS="FAILED"
    print_error "Containers failed to become ready"
    if [ "$DEBUG" = false ]; then
        docker compose logs
    fi
    exit 1
fi

print_success "Docker services started"

# Wait for services to start and establish connection
print_header "Connection Setup"

wait_for_connection() {
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        check_timeout
        
        if docker compose logs recoil-autohost | grep -q "connected to tachyon server"; then
            print_success "Connection established successfully"
            return 0
        fi
        print_status "Waiting for connection (attempt $attempt/$max_attempts)..."
        sleep 2
        ((attempt++))
    done
    
    TEST_STATUS="FAILED"
    print_error "Connection timeout"
    print_error "Last few lines of logs:"
    docker compose logs --tail 50
    exit 1
}

wait_for_connection

print_header "API Test"

# Test OAuth2 token endpoint
print_status "Testing OAuth2 token endpoint..."
token_response=$(curl -s -u "autohost1:pass1" -d "grant_type=client_credentials&scope=tachyon.lobby" http://127.0.0.1:8084/token)
access_token=$(echo "$token_response" | jq -r '.access_token')

if [ -z "$access_token" ] || [ "$access_token" = "null" ]; then
    TEST_STATUS="FAILED"
    print_error "Failed to get access token"
    print_error "Token response: $token_response"
    exit 1
fi

print_success "OAuth2 token endpoint working"

# Test updates subscription
print_status "Testing updates subscription..."
TIMESTAMP=$(date '+%s%6N')
subscribe_response=$(curl -s --json "{\"since\":$TIMESTAMP}" http://localhost:8084/request/0/subscribeUpdates)
if [ $? -ne 0 ]; then
    TEST_STATUS="FAILED"
    print_error "Failed to subscribe to updates"
    print_error "Response: $subscribe_response"
    exit 1
fi

print_success "Updates subscription working"

print_header "Test Complete"
print_success "All core functionality tests passed"
TEST_STATUS="SUCCESS"

cleanup 