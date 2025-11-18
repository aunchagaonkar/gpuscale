# GPU-Accelerated Video Compression with Autoscaling

A Kubernetes-based demo showcasing GPU workload autoscaling using a video compression application. The system automatically scales pods based on GPU encoder utilization.

## Features

- **GPU-Accelerated Video Compression**: Hardware-accelerated H.264 encoding using NVIDIA NVENC
- **Horizontal Pod Autoscaling**: Automatically scales from 1 to 4 pods based on GPU utilization
- **Prometheus Monitoring**: Real-time GPU metrics collection using DCGM Exporter
- **Web UI**: Simple drag-and-drop interface for video uploads

## Architecture

```
User Upload → Video Compressor Pod → NVIDIA GPU (NVENC)
                    ↓
            DCGM Exporter → Prometheus → Custom Metrics API
                                              ↓
                                    Horizontal Pod Autoscaler
```

## Quick Start

### Prerequisites

- Docker with NVIDIA GPU support
- Minikube with GPU passthrough
- NVIDIA GPU with NVENC support
- kubectl and helm

## Documentation

- [SETUP.md](SETUP.md) - Detailed installation and configuration guide
- [compressVideoGPU/README.md](compressVideoGPU/README.md) - Application details

## License

GPL License - See [LICENSE](LICENSE) for details
