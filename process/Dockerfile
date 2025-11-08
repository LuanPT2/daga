# syntax=docker/dockerfile:1.4
# Python Processing Service - ML models và video processing
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for better layer caching)
COPY requirements.txt .

# Install Python dependencies with BuildKit cache mount
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /data/daga/1daga/1temp \
    /data/daga/1daga/2video \
    /data/daga/1daga/3vertor \
    /data/daga/1daga/4uploads \
    /data/daga/1daga/5video-livestream \
    /data/daga/1daga/6video_cut

# Set environment variables
ENV PORT=5051
ENV HOST=0.0.0.0
ENV DATA_DIR=/data/daga/1daga
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5051

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5051/health')" || exit 1

# Start the API service
CMD ["python", "api.py"]

