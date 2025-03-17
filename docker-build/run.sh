#!/bin/sh

# Exit on error
set -e

# Default values
CONTAINER_NAME="recoil-autohost"
CONFIG_FILE="config.json"
ENGINES_DIR="engines"
INSTANCES_DIR="instances"
PORT=8084

# Help function
show_help() {
    echo "Usage: $0 [OPTIONS]"
    echo "Run the recoil-autohost container"
    echo ""
    echo "Options:"
    echo "  -n, --name NAME     Container name (default: $CONTAINER_NAME)"
    echo "  -c, --config FILE   Config file path (default: $CONFIG_FILE)"
    echo "  -e, --engines DIR   Engines directory path (default: $ENGINES_DIR)"
    echo "  -i, --instances DIR Instances directory path (default: $INSTANCES_DIR)"
    echo "  -p, --port PORT     Port to expose (default: $PORT)"
    echo "  -h, --help          Show this help message"
}

# Parse command line arguments
while [ "$#" -gt 0 ]; do
    case "$1" in
        -n|--name)
            CONTAINER_NAME="$2"
            shift 2
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -e|--engines)
            ENGINES_DIR="$2"
            shift 2
            ;;
        -i|--instances)
            INSTANCES_DIR="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Config file '$CONFIG_FILE' not found"
    exit 1
fi

# Check if engines directory exists
if [ ! -d "$ENGINES_DIR" ]; then
    echo "Error: Engines directory '$ENGINES_DIR' not found"
    exit 1
fi

# Create instances directory if it doesn't exist
mkdir -p "$INSTANCES_DIR"

# Run the container
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$PORT:8084" \
    -v "$(pwd)/$CONFIG_FILE:/app/config.json" \
    -v "$(pwd)/$ENGINES_DIR:/app/engines" \
    -v "$(pwd)/$INSTANCES_DIR:/app/instances" \
    recoil-autohost:latest

echo "Container '$CONTAINER_NAME' started successfully"
echo "Port: $PORT"
echo "Config file: $CONFIG_FILE"
echo "Engines directory: $ENGINES_DIR"
echo "Instances directory: $INSTANCES_DIR" 