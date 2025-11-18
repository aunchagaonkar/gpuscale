# GPU Video Compressor

A full-stack video compression application leveraging NVIDIA GPU acceleration (NVENC) with a Go backend and React frontend. Upload videos through a beautiful web interface and get GPU-compressed videos in seconds!


## Features

- **GPU-Accelerated Compression** - Uses NVIDIA NVENC for hardware encoding
- **Async Processing** - Non-blocking uploads with background compression
- **Universal Format Support** - Handles all common video formats
- **Easy Downloads** - One-click download of compressed videos

## Quick Start

### Prerequisites
- NVIDIA GPU with NVENC support
- Go 1.21+, Node.js 18+, ffmpeg with NVENC

### Run Application

**Terminal 1 - Backend:**
```bash
cd backend
./server
# Live on http://localhost:8080
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
# Live on http://localhost:5173
```

**Open browser to http://localhost:5173 and start compressing!**

See [QUICKSTART.md](./QUICKSTART.md) for detailed instructions.

## System Requirements

- **OS**: Linux (tested on Ubuntu)
- **GPU**: NVIDIA GPU with NVENC support (RTX/GTX series)
- **Driver**: NVIDIA drivers 535+
- **Go**: 1.21+
- **Node.js**: 18+
- **ffmpeg**: Built with NVENC support

## How It Works

1. **Upload** - User selects video file in React UI
2. **Process** - Backend receives file, generates job ID, starts GPU compression
3. **Poll** - Frontend polls status every 2 seconds
4. **Download** - When complete, user downloads compressed video

## Project Structure

```
compressVideoGPU/
├── backend/                 # Go API server
│   ├── main.go             # Complete backend with compression
│   ├── server              # Binary
│   ├── uploads/            # Input videos
│   └── static/             # Compressed videos
├── frontend/               # React app
│   └── src/
│       └── components/
│           └── VideoUploader.jsx  # Main UI component
├── go/hello_gpu/
└──  README.md
```

## API Endpoints

- `GET /health` - Health check
- `POST /upload` - Upload video, returns job ID
- `GET /status/:jobID` - Check compression status
- `GET /static/:filename` - Download compressed video

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Go + Gin Framework |
| Frontend | React + Vite |
| HTTP Client | Axios |
| Video Processing | ffmpeg + NVENC |
| GPU | NVIDIA GPU |

## Documentation

- **[QUICKSTART.md](./QUICKSTART.md)** - Installation and usage