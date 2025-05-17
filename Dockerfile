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
FROM node:22-slim AS runtime

# Install tini
RUN apt-get update && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r recoil && useradd -r -g recoil recoil

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production node dependencies
RUN npm ci --omit dev --omit optional

# Create necessary directories and set permissions
RUN mkdir -p /app/engines /app/instances && \
    chown -R recoil:recoil /app/engines /app/instances && \
    chmod -R 755 /app/engines /app/instances

# Switch to non-root user
USER recoil

# Set environment variables
ENV NODE_ENV=production

ENTRYPOINT ["node", "dist/main.js", "/app/config.json"]
