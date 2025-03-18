#!/bin/bash

# Exit on error
set -e

# Default values
IMAGE_NAME="recoil-autohost"
TAG="latest"
REGISTRY=""
PUBLISH=false

# Print usage
usage() {
    echo "Usage: $0 [-t tag] [-p registry]"
    echo "  -t tag      : Tag to use for the image (default: latest)"
    echo "  -p registry : Registry to publish to (e.g., docker.io/username)"
    echo "               If specified, the image will be published to the registry"
    exit 1
}

# Parse command line arguments
while getopts "t:p:h" opt; do
    case $opt in
        t)
            TAG="$OPTARG"
            ;;
        p)
            REGISTRY="$OPTARG"
            PUBLISH=true
            ;;
        h)
            usage
            ;;
        \?)
            echo "Invalid option: -$OPTARG" >&2
            usage
            ;;
    esac
done

# Construct image names
LOCAL_IMAGE="${IMAGE_NAME}:${TAG}"
if [ -n "$REGISTRY" ]; then
    REMOTE_IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"
fi

# Build the image
echo "Building image ${LOCAL_IMAGE}..."
docker build -t "${LOCAL_IMAGE}" -f docker-build/Dockerfile .
echo "Successfully built ${LOCAL_IMAGE}"

# If registry is specified, tag and push the image
if [ "$PUBLISH" = true ]; then
    echo "Tagging image for registry: ${REMOTE_IMAGE}"
    docker tag "${LOCAL_IMAGE}" "${REMOTE_IMAGE}"
    
    echo "Publishing image to registry..."
    docker push "${REMOTE_IMAGE}"
    echo "Successfully published ${REMOTE_IMAGE}"
fi 