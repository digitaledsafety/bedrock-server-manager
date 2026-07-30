FROM node:22-bookworm-slim

# Install system dependencies for Minecraft Bedrock Dedicated Server
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create minecraft user and group so changeOwnership operations succeed
RUN groupadd -r minecraft && useradd -r -g minecraft -d /app minecraft

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy package.json
COPY package.json ./

# Install production dependencies
RUN npm install --only=production

# Copy application source code
COPY . .

# Ensure permissions are correct
RUN chown -R minecraft:minecraft /app

# Expose ports:
# 3000: Web UI
# 19132/udp: Minecraft Bedrock IPv4
# 19133/udp: Minecraft Bedrock IPv6
EXPOSE 3000 19132/udp 19133/udp

# Start the application
CMD ["node", "app.js"]
