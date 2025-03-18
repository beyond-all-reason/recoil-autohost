# Build stage
FROM node:22-slim AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Runtime stage
FROM node:22-slim

# Install tini
RUN apt-get update && apt-get install -y tini curl && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r recoil && useradd -r -g recoil recoil

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create necessary directories and set permissions
RUN mkdir -p /app/engines /app/instances && \
    chown -R recoil:recoil /app/engines /app/instances && \
    chmod -R 755 /app/engines /app/instances

# Copy and set permissions for entrypoint script
COPY docker-build/docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh && \
    chown recoil:recoil /app/docker-entrypoint.sh

# Switch to non-root user
USER recoil

# Set environment variables
ENV NODE_ENV=production

ENTRYPOINT ["/usr/bin/tini", "-s", "--", "/app/docker-entrypoint.sh"] 