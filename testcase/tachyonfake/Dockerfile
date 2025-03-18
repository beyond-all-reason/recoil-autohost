FROM node:22-alpine

# Install curl for health check
RUN apk add --no-cache curl

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

# Start the tachyon fake server
CMD ["node", "dist/tachyonServer.fake.js"] 