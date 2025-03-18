# Test Case

This directory contains the test case for the Recoil Autohost service, including configuration files and the test runner script.

## Architecture

The test environment consists of two Docker containers:

1. `tachyon-fake`: A minimal implementation of the Tachyon lobby server for testing
   - Built from `testcase/tachyonfake/Dockerfile`
   - Runs on port 8084
   - Provides a mock lobby server interface
   - Located in the `tachyonfake` directory

2. `recoil-autohost`: The main autohost service
   - Built from `docker-build/Dockerfile`
   - Connects to the tachyon-fake server
   - Manages game instances and engine files
   - Uses ports 20001-20010 for game connections

The containers communicate through a Docker network (`autohost-network`), and the tachyon-fake server must be healthy before the autohost service starts.

## Prerequisites

1. Docker and Docker Compose installed on your system
2. Required system packages:
   ```bash
   # For Ubuntu/Debian
   sudo apt-get update
   sudo apt-get install -y p7zip-full curl jq uuid-runtime
   ```

## Files

### config.dev.json
Configuration file for the autohost service (located in project root):
- `tachyonServer`: Set to "localhost" for local testing
- `tachyonServerPort`: Port for the tachyon server (8084)
- `authClientId`: Client ID for authentication
- `authClientSecret`: Client secret for authentication
- `hostingIP`: IP address where the service is hosted
- `engineSettings`: Additional engine configuration options

### start.json
Configuration for the test battle:
- `battleId`: Generated UUID for the battle
- `engineVersion`: Version of the game engine to use
- `gameName`: Name of the game
- `mapName`: Name of the map to use
- `startPosType`: Type of starting positions
- `allyTeams`: Configuration for teams and players

### docker-compose.yml
Defines the Docker services:
- Sets up the tachyon-fake server
- Configures the recoil-autohost service
- Creates a network for container communication
- Manages volume mounts and port mappings
- Uses config.dev.json for autohost configuration

### testcase_run.sh
The main test runner script that:
1. Sets up the test environment
2. Downloads and extracts the required engine version
3. Starts the Docker services (including tachyon-fake)
4. Subscribes to updates
5. Starts a test battle
6. Provides instructions for joining the game
7. Handles cleanup on exit

## Usage

1. Navigate to the project root directory
2. Run the test script:
   ```bash
   ./testcase/testcase_run.sh
   ```

The script will:
- Create necessary directories
- Download and extract the required engine version
- Start both Docker services (tachyon-fake and recoil-autohost)
- Subscribe to updates
- Start a test battle
- Provide instructions for joining the game

To view logs while the test is running:
```bash
docker compose logs -f
```

To stop the test environment, press Ctrl+C. The script will automatically clean up all resources.

## Cleanup

The script includes comprehensive cleanup that runs in all scenarios:
- Normal exit
- Script errors
- User interruption (Ctrl+C)
- Failed Docker operations
- Failed engine download/extraction
- Failed API calls

All resources will be cleaned up, including:
- Docker containers and networks
- Downloaded engine files
- Temporary files
- `engines` directory and its contents
- `instances` directory and its contents

## Troubleshooting

1. If the service fails to start:
   - Check Docker logs: `docker compose logs recoil-autohost`
   - Check tachyon-fake logs: `docker compose logs tachyon-fake`
   - Verify config.dev.json exists and is valid
   - Ensure all required ports are available

2. If cleanup fails:
   - Manually remove the `engines` and `instances` directories
   - Stop any running Docker containers: `docker compose down`
   - Check for any remaining temporary files 