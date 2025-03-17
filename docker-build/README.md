# Docker Build Configuration

This directory contains Docker-related files for building and running the Recoil Autohost service.

## Files

- `Dockerfile`: Multi-stage build configuration using Alpine 3.21.3
- `build.sh`: Script to build the Docker image
- `run.sh`: Script to run the container with configurable options
- `docker-compose.yml`: Docker Compose configuration for easy deployment

## Prerequisites

- Docker installed on your system
- Docker Compose (optional, for using docker-compose.yml)
- A valid `config.json` file in the project root
- An `engines` directory containing the game engine binaries

## Building the Image

You can build the Docker image using either method:

### Using build.sh
```bash
./docker-build/build.sh
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

## Health Check

The container includes a health check that monitors the service on port 8084. The health check:
- Runs every 30 seconds
- Has a timeout of 10 seconds
- Retries 3 times before marking unhealthy
- Has a 10-second grace period on startup

## Environment Variables

- `NODE_ENV`: Set to "production" by default

## Volumes

The following directories are mounted as volumes:
- `config.json`: Configuration file
- `engines/`: Game engine binaries
- `instances/`: Battle instance data

## Security

- The container runs as a non-root user (recoil)
- Uses tini as an init system for proper process management
- Based on Alpine Linux for a minimal attack surface

## Troubleshooting

1. If the container fails to start, check:
   - The config.json file exists and is valid
   - The engines directory contains the required binaries
   - The port 8084 is not in use

2. To view container logs:
   ```bash
   docker logs recoil-autohost
   ```

3. To stop the container:
   ```bash
   docker stop recoil-autohost
   ``` 