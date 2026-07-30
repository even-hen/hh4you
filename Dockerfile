FROM node:20-slim

WORKDIR /app

# Install build dependencies for native modules (like sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files and install dependencies deterministically
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application files
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose server port
EXPOSE 8000

# Run Express server
CMD ["node", "backend/server.js"]
