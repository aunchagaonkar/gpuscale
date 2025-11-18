# Multi-stage Dockerfile for GPU Video Compressor
# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm install

# Copy frontend source
COPY frontend/ ./

# Build frontend for production
RUN npm run build

# Stage 2: Build Backend
FROM golang:1.25-alpine AS backend-builder

WORKDIR /backend

# Copy go mod files
COPY backend/go.mod backend/go.sum ./

# Download dependencies
RUN go mod download

# Copy backend source
COPY backend/ ./

# Build the Go binary
RUN CGO_ENABLED=0 GOOS=linux go build -o server main.go

# Stage 3: Final Runtime Image with FFmpeg and NVIDIA GPU support
# Using jrottenberg/ffmpeg with NVIDIA hardware acceleration
FROM jrottenberg/ffmpeg:5.0-nvidia2004
# Switch to root to install packages
USER root

# Install ca-certificates for HTTPS
RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built Go binary from backend-builder
COPY --from=backend-builder /backend/server .

# Copy the built frontend from frontend-builder
COPY --from=frontend-builder /frontend/dist ./frontend/dist

# Create necessary directories
RUN mkdir -p uploads static

# Expose port
EXPOSE 8080

# Set environment variables
ENV GIN_MODE=release

# Override the default ENTRYPOINT from ffmpeg image
ENTRYPOINT []

# Run the server
CMD ["./server"]
