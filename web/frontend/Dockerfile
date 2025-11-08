# Stage 1: Build the React application
FROM node:18-alpine AS builder

WORKDIR /app

# Accept build arguments for environment variables
ARG REACT_APP_API_BASE
ARG REACT_APP_DEFAULT_PATH

# Set environment variables for build
ENV REACT_APP_API_BASE=${REACT_APP_API_BASE}
ENV REACT_APP_DEFAULT_PATH=${REACT_APP_DEFAULT_PATH}

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration (optional - for SPA routing)
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

