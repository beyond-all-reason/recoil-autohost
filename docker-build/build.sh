#!/bin/sh

# Exit on error
set -e

# Build the image
docker build -t recoil-autohost:latest -f docker-build/Dockerfile .

echo "Successfully built recoil-autohost:latest" 