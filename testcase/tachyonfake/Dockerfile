FROM node:22-slim

# Install curl for health check and tini for process management
RUN apt-get update && apt-get install -y curl tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the tachyon fake server implementation
COPY src/tachyonServer.fake.ts ./src/
COPY src/tachyonTypes.ts ./src/
COPY src/tachyonTypes.test.ts ./src/
COPY src/oauth2Client.ts ./src/
COPY src/oauth2Client.test.ts ./src/
COPY tsconfig.json ./

# Build TypeScript files
RUN npm run build

# Expose the port that tachyon fake server uses
EXPOSE 8084

# Use Tini as entrypoint with subreaper mode
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]

# Start the tachyon fake server
CMD ["node", "dist/tachyonServer.fake.js"] 