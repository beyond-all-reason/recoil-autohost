# Docker Build Configuration

This directory contains Docker-related files for building and running the Recoil Autohost service. For general information about the Recoil Autohost service, see the [main README](../README.md). For information about testing with Docker, see the [Test Case Documentation](../testcase/README.md).

## Files

- `Dockerfile`: Multi-stage build configuration using Node.js 22 Debian-slim
- `build.sh`: Script to build the Docker image
- `run.sh`: Script to run the container with configurable options
- `docker-compose.yml`: Docker Compose configuration for easy deployment
- `docker-entrypoint.sh`: Entrypoint script for container initialization and permissions

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, for using docker-compose.yml)
- A valid `config.json` file in the project root
- An `engines` directory containing the game engine binaries
- Host system with glibc support (required for Spring engine binaries)

## Building the Image

You can build the Docker image using either method:

### Using build.sh
The `build.sh` script provides options for custom tagging and publishing to a registry:

```bash
./docker-build/build.sh [OPTIONS]
```

Options:
- `-t tag`: Specify a custom tag for the image (default: "latest")
- `-p registry`: Specify a registry to publish to (e.g., "docker.io/username")
- `-h`: Show help/usage information

Examples:
```bash
# Basic build with default tag (latest)
./docker-build/build.sh

# Build with custom tag
./docker-build/build.sh -t v1.0.0

# Build and publish to registry
./docker-build/build.sh -t v1.0.0 -p docker.io/username

# Show help
./docker-build/build.sh -h
```

### Using Docker directly
```bash
docker build -t recoil-autohost:latest -f docker-build/Dockerfile .
```

## Running the Container

### Using run.sh
The `run.sh` script provides a convenient way to run the container with configurable options:

```bash
./docker-build/run.sh [OPTIONS]
```

Options:
- `-n, --name NAME`: Container name (default: recoil-autohost)
- `-c, --config FILE`: Config file path (default: config.json)
- `-e, --engines DIR`: Engines directory path (default: engines)
- `-i, --instances DIR`: Instances directory path (default: instances)
- `-p, --port PORT`: Port to expose (default: 8084)
- `-h, --help`: Show help message

Example:
```bash
./docker-build/run.sh -p 8085 -c custom-config.json
```

### Using Docker Compose
```bash
docker-compose -f docker-build/docker-compose.yml up -d
```

## Directory Structure

The container expects the following directory structure in your project root:

```
.
├── config.json
├── engines/
│   └── [engine binaries]
└── instances/
    └── [battle instances]
```

## Configuration

The service uses a `config.json` file for all configuration settings. The file should be mounted into the container at `/app/config.json`. See the [main README](../README.md) for configuration options and examples.

## Health Check

The container includes a health check that monitors the service on port 8084. The health check:
- Runs every 30 seconds
- Has a timeout of 10 seconds
- Retries 3 times before marking unhealthy
- Has a 10-second grace period on startup

## Volumes

The following directories are mounted as volumes:
- `config.json`: Configuration file
- `engines/`: Game engine binaries
- `instances/`: Battle instance data

## Security

- The container runs as a non-root user (recoil)
- Uses tini as an init system for proper process management
- Based on Debian-slim for better glibc compatibility
- Permissions are managed by the entrypoint script

## Troubleshooting

1. If the container fails to start, check:
   - The config.json file exists and is valid
   - The engines directory contains the required binaries
   - The port 8084 is not in use
   - The entrypoint script has execute permissions
   - The host system has glibc installed
   - The mounted directories have correct permissions

2. To view container logs:
   ```bash
   docker logs recoil-autohost
   ```

3. To check container permissions:
   ```bash
   docker exec recoil-autohost ls -la /app/engines /app/instances
   ```

4. To stop the container:
   ```bash
   docker stop recoil-autohost
   ```

## Testing

For testing the Docker container, see the [Test Case Documentation](../testcase/README.md) which includes a complete example of running the service in a test environment. 