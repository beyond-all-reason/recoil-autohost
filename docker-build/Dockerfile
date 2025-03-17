# Build stage
FROM alpine:3.21.3 AS builder

# Install build dependencies
RUN apk add --no-cache \
    curl \
    git \
    python3 \
    build-base \
    python3-dev \
    g++ \
    make

# Install Node.js
RUN apk add --no-cache nodejs npm

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
FROM alpine:3.21.3

# Install runtime dependencies
RUN apk add --no-cache \
    nodejs \
    npm \
    tini

# Create non-root user
RUN addgroup -S recoil && adduser -S recoil -G recoil

# Set working directory
WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

# Create necessary directories
RUN mkdir -p /app/engines /app/instances \
    && chown -R recoil:recoil /app

# Switch to non-root user
USER recoil

# Expose the port used by the autohost service
EXPOSE 8084

# Set environment variables
ENV NODE_ENV=production

# Create a volume for engines and instances
VOLUME ["/app/engines", "/app/instances"]

# Use tini as entrypoint
ENTRYPOINT ["/sbin/tini", "--"]

# Start the application
CMD ["node", "dist/index.js"] 