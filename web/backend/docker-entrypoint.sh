#!/bin/sh
set -e

# Override paths for Docker environment
export APP_ROOT=${APP_ROOT:-/app}
export DATA_DIR=${DATA_DIR:-/data/daga/1daga}
export PYTHON_SERVICE_URL=${PYTHON_SERVICE_URL:-http://192.168.132.134:5051}

# Ensure data directories exist (will be created if not mounted)
mkdir -p "$DATA_DIR/1temp"
mkdir -p "$DATA_DIR/2video"
mkdir -p "$DATA_DIR/3vertor"
mkdir -p "$DATA_DIR/4uploads"
mkdir -p "$DATA_DIR/5video-livestream"
mkdir -p "$DATA_DIR/6video_cut"

echo "Starting backend server..."
echo "APP_ROOT: $APP_ROOT"
echo "DATA_DIR: $DATA_DIR"
echo "PYTHON_SERVICE_URL: $PYTHON_SERVICE_URL"

# Change to backend directory
cd /app/web/backend

# Start the server
exec node server.js

