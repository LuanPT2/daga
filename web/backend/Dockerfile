# syntax=docker/dockerfile:1.4
# Backend Web Server - Node.js only (Python processing tách riêng)
FROM node:18-alpine AS node-builder

WORKDIR /app

# Copy package files from backend directory
COPY web/backend/package*.json ./

# Install Node.js dependencies with BuildKit cache mount
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Final stage: Node.js only
FROM node:18-alpine

WORKDIR /app

# Copy Node.js dependencies from builder
COPY --from=node-builder /app/node_modules ./web/backend/node_modules

# Copy application code with proper directory structure
# server.js expects: __dirname/../../../ to be the root
# So we need: /app/web/backend/server.js -> __dirname = /app/web/backend -> ../../../ = /app
COPY web/backend/package*.json ./web/backend/
COPY web/backend/server.js ./web/backend/

# Create entrypoint script directly in container (to avoid copy issues)
# Use /bin/sh instead of /bin/bash (Alpine Linux)
RUN printf '#!/bin/sh\n\
set -e\n\
\n\
# Override paths for Docker environment\n\
export APP_ROOT=${APP_ROOT:-/app}\n\
export DATA_DIR=${DATA_DIR:-/data/daga/1daga}\n\
export PYTHON_SERVICE_URL=${PYTHON_SERVICE_URL:-http://192.168.132.134:5051}\n\
\n\
# Ensure data directories exist (will be created if not mounted)\n\
mkdir -p "$DATA_DIR/1temp"\n\
mkdir -p "$DATA_DIR/2video"\n\
mkdir -p "$DATA_DIR/3vertor"\n\
mkdir -p "$DATA_DIR/4uploads"\n\
mkdir -p "$DATA_DIR/5video-livestream"\n\
mkdir -p "$DATA_DIR/6video_cut"\n\
\n\
echo "Starting backend server..."\n\
echo "APP_ROOT: $APP_ROOT"\n\
echo "DATA_DIR: $DATA_DIR"\n\
echo "PYTHON_SERVICE_URL: $PYTHON_SERVICE_URL"\n\
\n\
# Change to backend directory\n\
cd /app/web/backend\n\
\n\
# Start the server\n\
exec node server.js\n\
' > /app/docker-entrypoint.sh && \
    chmod +x /app/docker-entrypoint.sh && \
    test -f /app/docker-entrypoint.sh && \
    head -1 /app/docker-entrypoint.sh | grep -q '#!/bin/sh' && \
    echo "Entrypoint script created successfully"

# Create necessary directories in /data/daga/1daga
RUN mkdir -p /data/daga/1daga/1temp \
    /data/daga/1daga/2video \
    /data/daga/1daga/3vertor \
    /data/daga/1daga/4uploads \
    /data/daga/1daga/5video-livestream \
    /data/daga/1daga/6video_cut


# Set working directory to backend folder
WORKDIR /app/web/backend

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5050
ENV HOST=0.0.0.0
ENV APP_ROOT=/app
ENV DATA_DIR=/data/daga/1daga
ENV PYTHON_SERVICE_URL=http://192.168.132.134:5051

# Note: Python processing is handled by separate service (python-processor)
# This backend only contains Node.js dependencies

# Expose port
EXPOSE 5050

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5050/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use entrypoint script
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]

