# Recoil Autohost Test Case

This directory contains a test suite for validating the basic connectivity and functionality of the Recoil Autohost service.

## Quick Start

```bash
# Install prerequisites (Ubuntu/Debian)
sudo apt-get update && sudo apt-get install -y \
    docker.io \
    curl \
    jq \
    p7zip-full \
    uuid-runtime

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

## Example Session

The test case demonstrates a complete example of starting a game with the autohost service:

1. Set up BAR checkout as described in the main game repository
   https://github.com/beyond-all-reason/Beyond-All-Reason.

2. Make sure you have "Quicksilver Remake 1.24" map installed.

3. Fetch engine
   ```shell
   curl -L https://github.com/beyond-all-reason/spring/releases/download/spring_bar_%7BBAR105%7D105.1.1-2590-gb9462a0/spring_bar_.BAR105.105.1.1-2590-gb9462a0_linux-64-minimal-portable.7z -o engine.7z
   7z x engine.7z -o'engines/105.1.1-2590-gb9462a0 BAR105'
   ```

4. Start tachyon fake and autohost as described above.

5. Subscribe to all updates from autohost.
   ```shell
   printf '{"since":%d}' $(date '+%s%6N') | curl --json @- http://127.0.0.1:8084/request/0/subscribeUpdates
   ```

6. Create a simple start script request in `start.json`:
   ```json
   {
     "battleId": null,
     "engineVersion": "105.1.1-2590-gb9462a0 BAR105",
     "gameName": "Beyond All Reason $VERSION",
     "mapName": "Quicksilver Remake 1.24",
     "startPosType": "ingame",
     "allyTeams": [{
       "startBox": { "top": 0, "bottom": 0.3, "left": 0, "right": 1 },
       "teams": [{
         "faction": "Cortex",
         "bots": [{
           "aiShortName": "BARb",
           "aiVersion": "stable",
           "hostUserId": "11111"
         }]
       }]
     }, {
       "startBox": { "top": 0.7, "bottom": 1, "left": 0, "right": 1 },
       "teams": [{
         "faction": "Armada",
         "players": [{
           "userId": "11111",
           "name": "Player",
           "password": "password1"
         }]
       }]
     }]
   }
   ```

7. Start the engine dedicated in autohost:
   ```shell
   jq ".battleId = \"$(uuidgen -r)\"" start.json | curl --json @- http://127.0.0.1:8084/request/0/start
   ```

8. Join the game yourself, using the port that will be printed on the tachyon
   server fake output and user name and password from `start.json`:
   ```shell
   ./engines/105.1.1-2590-gb9462a0\ BAR105/spring --isolation --write-dir "{absolute path to your data folder}" spring://Player:password1@127.0.0.1:20001
   ```

> [!NOTE]
> Until [a fix](https://github.com/beyond-all-reason/spring/pull/1876) gets
> released in some of the future engine version, you have only 30s between
> autohost starts the game and you connect to it.

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