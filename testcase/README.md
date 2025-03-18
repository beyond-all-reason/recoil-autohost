# Recoil Autohost Test Case

This directory contains a test suite for validating the basic connectivity and functionality of the Recoil Autohost service.

## Quick Start

```bash
# Install prerequisites (Ubuntu/Debian)
sudo apt-get update && sudo apt-get install -y \
    docker.io \
    docker-compose \
    curl \
    jq

# Run the test (from project root)
sudo ./testcase/testcase_run.sh -debug
```

## Test Environment

The test environment consists of two Docker containers:

1. `tachyon-fake`: A mock Tachyon lobby server
   - Provides authentication and basic lobby functionality
   - Runs on port 8084
   - Includes health check endpoint

2. `recoil-autohost`: The service being tested
   - Connects to the mock Tachyon server
   - Validates connection and API functionality

## Test Script Usage

```bash
sudo ./testcase_run.sh [-debug] [-timeout seconds]
```

### Options

- `-debug`: Enable detailed logging output (recommended for troubleshooting)
- `-timeout`: Set custom test timeout in seconds (default: 60)

### Examples

```bash
# Basic test
sudo ./testcase_run.sh

# Test with debug output
sudo ./testcase_run.sh -debug

# Test with longer timeout
sudo ./testcase_run.sh -timeout 120

# Test with both debug and custom timeout
sudo ./testcase_run.sh -debug -timeout 120
```

## What the Test Validates

1. **Service Startup**
   - Docker containers start successfully
   - Services are healthy and responsive

2. **Connection**
   - Recoil-autohost connects to Tachyon server
   - Connection is stable and authenticated

3. **API Functionality**
   - OAuth2 token endpoint works
   - Updates subscription endpoint works

## Test Output

The test provides clear visual feedback:
- ✓ Green checkmarks for successful steps
- ✗ Red X's for failures
- ➜ Blue arrows for progress updates
- Yellow headers for test sections

Example successful output:
```
=== Test Environment Setup ===
➜ Starting Docker services...
✓ Containers are ready
✓ Docker services started

=== Connection Setup ===
✓ Connection established successfully

=== API Test ===
✓ OAuth2 token endpoint working
✓ Updates subscription working

=== Test Complete ===
✓ All core functionality tests passed

=== Cleanup ===
✓ Test completed successfully
```

## Automatic Cleanup

The test script automatically cleans up all resources, regardless of test outcome:
- Stops and removes Docker containers
- Cleans up the `engines` directory
- Cleans up the `instances` directory
- Removes Docker networks

Cleanup triggers on:
- Normal test completion
- Test failures
- Timeouts
- User interruption (Ctrl+C)

## Troubleshooting

If the test fails:

1. **Run with debug output**
   ```bash
   sudo ./testcase_run.sh -debug
   ```

2. **Check Docker logs**
   ```bash
   docker compose logs recoil-autohost
   docker compose logs tachyon-fake
   ```

3. **Verify prerequisites**
   - Docker and Docker Compose are installed and running
   - Required ports (8084) are available
   - User has sudo privileges

4. **Common Issues**
   - OAuth2 credentials mismatch
   - Network connectivity problems
   - Port conflicts
   - Insufficient permissions

## Configuration Files

- `docker-compose.yml`: Defines the test environment
- `config.dev.json`: Configures the Recoil Autohost service
- `tachyonfake/`: Contains the mock Tachyon server implementation 