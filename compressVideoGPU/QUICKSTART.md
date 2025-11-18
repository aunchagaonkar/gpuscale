# GPU Video Compressor

A full-stack application for GPU-accelerated video compression using FFmpeg with NVIDIA NVENC.

## Features

- GPU-accelerated video compression using NVIDIA h264_nvenc
- React frontend with real-time upload progress
- Go backend with Gin framework
- Fully Dockerized single-image deployment
- Real-time compression status polling
- Persistent storage for uploads and compressed videos

## Architecture

- **Frontend**: React + Vite (served as static files by backend)
- **Backend**: Go + Gin (API and static file server)
- **Compression**: FFmpeg with NVIDIA GPU acceleration
- **Deployment**: Multi-stage Docker build

## Prerequisites

### For Docker Deployment (Recommended)
- Docker and Docker Compose
- NVIDIA GPU with CUDA support
- NVIDIA Container Toolkit

### For Local Development
- Node.js 20+ (for frontend)
- Go 1.23+ (for backend)
- FFmpeg with NVIDIA hardware acceleration support

## Quick Start with Docker

### 1. Build and Run with Docker Compose

```bash
# Build and start the application
docker-compose up -d

# View logs
docker-compose logs -f

# Stop the application
docker-compose down
```

The application will be available at: **http://localhost:8080**

### 2. Or Build with Docker directly

```bash
# Build the image
docker build -t video-compressor .

# Run the container with GPU support
docker run -d \
  --gpus all \
  -p 8080:8080 \
  -v $(pwd)/uploads:/app/uploads \
  -v $(pwd)/static:/app/static \
  --name video-compressor \
  video-compressor
```

## Local Development

### Backend Development

```bash
cd backend

# Install dependencies
go mod download

# Run the server
go run main.go
```

The backend API will be available at: **http://localhost:8080**

### Frontend Development

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The frontend will be available at: **http://localhost:5173**

### Build Frontend for Production

```bash
cd frontend
npm run build
```

The built files will be in `frontend/dist/` and served by the Go backend.

## API Endpoints

- `GET /health` - Health check endpoint
- `POST /upload` - Upload video for compression
  - Body: `multipart/form-data` with `video` field
  - Returns: `{ jobID, message, filename, size }`
- `GET /status/:jobID` - Check compression status
  - Returns: `{ jobID, status, downloadURL? }`
- `GET /static/:filename` - Download compressed video
- `GET /` - Frontend application (when built)

## Environment Variables

- `GIN_MODE` - Gin mode (`debug` or `release`)
- `VITE_API_URL` - Frontend API base URL (optional, defaults to same origin in production)

## Project Structure

```
compressVideoGPU/
├── backend/
│   ├── main.go              # Go backend server
│   ├── go.mod               # Go dependencies
│   └── go.sum
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── VideoUploader.jsx
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── Dockerfile               # Multi-stage build
├── docker-compose.yml       # Docker Compose config
└── README.md
```

## GPU Requirements

This application requires an NVIDIA GPU with:
- CUDA support
- NVENC encoder support
- NVIDIA drivers installed

### Installing NVIDIA Container Toolkit

```bash
# Ubuntu/Debian
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### Verify GPU Access

```bash
docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu24.04 nvidia-smi
```

## Troubleshooting

### GPU not detected
- Ensure NVIDIA drivers are installed
- Verify NVIDIA Container Toolkit is installed
- Check GPU is accessible: `nvidia-smi`

### FFmpeg encoding fails
- Verify GPU supports NVENC
- Check FFmpeg has NVENC support: `ffmpeg -encoders | grep nvenc`

### Frontend not loading
- Ensure frontend was built: `cd frontend && npm run build`
- Check `frontend/dist/` directory exists

## License

GPL

## Contributing

Pull requests are welcome!
