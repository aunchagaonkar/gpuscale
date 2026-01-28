# Complete Minikube GPU Autoscaling Demo Guide

This guide provides a complete, tested walkthrough for setting up GPU-based autoscaling on Minikube from scratch. It includes all debugging commands and troubleshooting steps.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [GPU Time-Slicing Configuration](#gpu-time-slicing-configuration)
- [Monitoring Stack Installation](#monitoring-stack-installation)
- [Application Deployment](#application-deployment)
- [Testing the Autoscaling](#testing-the-autoscaling)
- [Restarting After Minikube Stop](#restarting-after-minikube-stop)
- [Troubleshooting](#troubleshooting)
- [Cleanup](#cleanup)

---

## Prerequisites

### Required Software
- `minikube` (latest version)
- `docker` (latest version)
- `kubectl` (version 1.33+)
- `helm` (version 3+)
- `jq` (for JSON parsing)
- `curl` (for API testing)

### Hardware Requirements
- NVIDIA GPU with drivers installed on host machine
- GPU UUID: `<gpu-uuid get-using nvidia-smi -L >` (get using `nvidia-smi -L`)

### Verify Prerequisites

```bash
# Check all tools are installed
minikube version
docker --version
kubectl version --client
helm version
jq --version

# Verify NVIDIA drivers
nvidia-smi
```

---

## Initial Setup

### Step 1: Start Minikube with GPU Support

```bash
# Start Minikube cluster with Docker driver and GPU access
minikube start --driver=docker --gpus=all

# Verify cluster is running
kubectl get nodes
```

**Expected output:**
```
NAME       STATUS   ROLES           AGE   VERSION
minikube   Ready    control-plane   1m    v1.33.1
```

### Step 2: Enable NVIDIA Device Plugin

```bash
# Enable the NVIDIA device plugin addon
minikube addons enable nvidia-device-plugin

# Wait for the plugin pod to be running
kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds -w
```

Press `Ctrl+C` when the pod shows `1/1 Running`.

### Step 3: Label the Node

```bash
# Label the node for GPU workloads
kubectl label nodes minikube accelerator=nvidia-gpu

# Verify the label
kubectl get nodes --show-labels | grep accelerator
```

### Step 4: Verify Initial GPU Availability

```bash
# Check that 1 GPU is available
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
```

**Expected output:** `1`

---

## GPU Time-Slicing Configuration

Time-slicing allows multiple pods to share a single GPU by time-multiplexing access.

### Step 1: Create Time-Slicing ConfigMap

Create or verify `time-slicing.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nvidia-device-plugin-config
  namespace: kube-system
data:
  config.yaml: |
    version: v1
    sharing:
      timeSlicing:
        resources:
        - name: nvidia.com/gpu
          replicas: 4
          devices: ["<gpu-uuid get-using nvidia-smi -L >"]
```

Apply the ConfigMap:

```bash
kubectl apply -f time-slicing.yaml
```

### Step 2: Patch the Device Plugin

```bash
# Patch the DaemonSet to mount the config and use it
kubectl patch daemonset nvidia-device-plugin-daemonset -n kube-system --type='json' -p='[
  {"op": "add", "path": "/spec/template/spec/volumes/0", "value": {
    "name": "nvidia-config",
    "configMap": {"name": "nvidia-device-plugin-config"}
  }},
  {"op": "add", "path": "/spec/template/spec/containers/0/volumeMounts/0", "value": {
    "mountPath": "/etc/nvidia", "name": "nvidia-config"
  }},
  {"op": "add", "path": "/spec/template/spec/containers/0/args", "value": [
    "--config-file=/etc/nvidia/config.yaml"
  ]}
]'
```

### Step 3: Watch Pod Restart

```bash
# Monitor the device plugin pod restart
kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds -w
```

Wait for the old pod to terminate and new pod to reach `1/1 Running`. Press `Ctrl+C` to exit.

### Step 4: Verify Time-Slicing

```bash
# Check that 4 GPUs are now available
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
```

**Expected output:** `4`

**Debugging if still showing `1`:**

```bash
# Check device plugin logs
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds

# Verify ConfigMap is mounted
kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep -A 5 volumes

# Verify --config-file argument
kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep config-file
```

---

## Monitoring Stack Installation

### Step 1: Install DCGM Exporter

DCGM Exporter collects GPU metrics including encoder/decoder utilization.

```bash
# Apply the DCGM Exporter DaemonSet
kubectl apply -f dcgm-exporter.yaml
```

**Verify it's running:**

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=dcgm-exporter

# Check logs if pod is not running
kubectl logs -l app.kubernetes.io/name=dcgm-exporter
```

**Expected status:** `1/1 Running`

**Test DCGM metrics:**

```bash
# Port-forward to the exporter
kubectl port-forward svc/dcgm-exporter 9400:9400 &

# Query for encoder utilization metric
curl localhost:9400/metrics | grep dcgm_enc_utilization

# Stop port-forward
kill %1
```

### Step 2: Add Helm Repositories

```bash
# Add Prometheus community charts
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update
```

### Step 3: Install Kube-Prometheus-Stack

This installs Prometheus, Grafana, and related components.

```bash
# Install with extended timeout for Minikube
helm upgrade --install kube-prometheus-stack \
  prometheus-community/kube-prometheus-stack \
  -f kube-prometheus-stack-values.yaml \
  --timeout 15m
```

**Monitor installation:**

```bash
# Watch pods being created
kubectl get pods -w
```

Wait until these pods are `Running`:
- `prometheus-kube-prometheus-stack-prometheus-0` (2/2)
- `alertmanager-kube-prometheus-stack-alertmanager-0` (2/2)
- `kube-prometheus-stack-grafana-*` (3/3)

Press `Ctrl+C` when all are running.

**Verify Prometheus is scraping DCGM:**

```bash
# Port-forward to Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &

# Query for encoder utilization
curl -s 'http://localhost:9090/api/v1/query?query=dcgm_enc_utilization' | jq .

# Stop port-forward
kill %1
```

**Expected:** You should see results with your GPU's UUID.

---

## Application Deployment

### Step 1: Deploy Video Compressor Application

```bash
# Apply the deployment and service
kubectl apply -f video-compressor-deployment.yaml
```

**Verify pods are running:**

```bash
# Check pod status
kubectl get pods -l app=video-compressor

# If pods are stuck, describe them
kubectl describe pod -l app=video-compressor
```

**Expected:** Both pods should be `1/1 Running`.

### Step 2: Create Prometheus Recording Rule

This rule creates the `video_compressor_gpu_avg` metric from encoder utilization.

```bash
# Apply the PrometheusRule
kubectl apply -f video-compressor-prometheusrule.yaml
```

**Verify the rule is loaded:**

```bash
# Port-forward to Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &

# Check the rule is loaded and healthy
curl -s 'http://localhost:9090/api/v1/rules' | jq '.data.groups[] | select(.name=="gpu-rule-group")'
```

Look for `"health": "ok"` in the output.

**Test the metric:**

```bash
# Query the raw encoder utilization
curl -s 'http://localhost:9090/api/v1/query?query=dcgm_enc_utilization' | jq '.data.result[0].value[1]'

# Query your custom metric
curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq '.data.result[0].value[1]'

# Stop port-forward
kill %1
```

**Expected:** Both should return `"0"` (or a number) if working correctly.

### Step 3: Install Prometheus Adapter

The adapter exposes Prometheus metrics to Kubernetes' custom metrics API.

Create `prometheus-adapter-values.yaml`:

```yaml
prometheus:
  url: http://kube-prometheus-stack-prometheus.default.svc.cluster.local

rules:
  default: false
  custom:
  - seriesQuery: 'video_compressor_gpu_avg'
    resources:
      overrides:
        namespace: {resource: "namespace"}
        deployment: {resource: "deployment"}
    name:
      matches: "^(.*)$"
      as: "${1}"
    metricsQuery: 'video_compressor_gpu_avg{namespace="default",deployment="video-compressor"}'
  resource: {}
  external: []
```

Install the adapter:

```bash
# Install prometheus-adapter
helm upgrade --install prometheus-adapter \
  prometheus-community/prometheus-adapter \
  -f prometheus-adapter-values.yaml
```

**Wait for the adapter to be ready:**

```bash
# Watch the adapter pod
kubectl get pods -l app.kubernetes.io/name=prometheus-adapter -w
```

Press `Ctrl+C` when it's `1/1 Running`.

**Verify the custom metrics API (wait 1-2 minutes after installation):**

```bash
# Check if the metric is exposed
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq . | grep video_compressor_gpu_avg
```

**Expected output:**
```
"name": "namespaces/video_compressor_gpu_avg",
"name": "deployments.apps/video_compressor_gpu_avg",
```

**Query the metric directly:**

```bash
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .
```

**Debugging if metric is not available:**

```bash
# Check adapter logs
kubectl logs -l app.kubernetes.io/name=prometheus-adapter --tail=100

# Check adapter configuration
kubectl get configmap prometheus-adapter -o yaml

# Restart the adapter if needed
kubectl rollout restart deployment prometheus-adapter
```

### Step 4: Create the HorizontalPodAutoscaler

```bash
# Apply the HPA
kubectl apply -f video-compressor-hpa.yaml
```

**Verify HPA is working:**

```bash
# Check HPA status
kubectl get hpa video-compressor-hpa
```

**Expected output:**
```
NAME                   REFERENCE                     TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
video-compressor-hpa   Deployment/video-compressor   0/1       1         4         2          30s
```

The `TARGETS` should show `0/1` (not `<unknown>`).

**Debugging if showing `<unknown>`:**

```bash
# Describe HPA for events
kubectl describe hpa video-compressor-hpa

# Verify the metric is available in custom metrics API
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .

# Check HPA controller logs
kubectl logs -n kube-system -l app=kube-controller-manager | grep -i horizontal
```

---

## Testing the Autoscaling

### Step 1: Access the Application

```bash
# Get the service URL
minikube service video-compressor-svc
```

This will open the application in your browser and show the URL (e.g., `http://192.168.49.2:30736`).

### Step 2: Set Up Monitoring Terminals

**Terminal 1 - Watch HPA:**

```bash
watch -n 2 kubectl get hpa video-compressor-hpa
```

**Terminal 2 - Watch Pods:**

```bash
watch -n 2 kubectl get pods -l app=video-compressor
```

**Terminal 3 - Monitor Metrics (optional):**

```bash
# Port-forward to Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090

# In another terminal, continuously query the metric
while true; do
  echo "Encoder Utilization: $(curl -s 'http://localhost:9090/api/v1/query?query=dcgm_enc_utilization' | jq -r '.data.result[0].value[1]')"
  echo "Average Metric: $(curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq -r '.data.result[0].value[1]')"
  sleep 2
done
```

### Step 3: Generate GPU Load

1. **Upload a video** in the browser interface
2. **Click "Compress Video"**
3. The compression uses the GPU encoder (NVENC)

### Step 4: Observe Scaling Behavior

**Expected behavior within 15-30 seconds:**

1. **Terminal 3 (Metrics):**
   - `dcgm_enc_utilization` should rise to 50-100%
   - `video_compressor_gpu_avg` should reflect this value

2. **Terminal 1 (HPA):**
   ```
   NAME                   REFERENCE                     TARGETS   MINPODS   MAXPODS   REPLICAS   AGE
   video-compressor-hpa   Deployment/video-compressor   45/1      1         4         3          2m
   ```
   - `TARGETS` shows current/target (e.g., `45/1`)
   - `REPLICAS` increases from 2 to 3, then to 4

3. **Terminal 2 (Pods):**
   ```
   NAME                                READY   STATUS              RESTARTS   AGE
   video-compressor-5b5494d487-xxxxx   1/1     Running             0          5m
   video-compressor-5b5494d487-yyyyy   1/1     Running             0          5m
   video-compressor-5b5494d487-zzzzz   0/1     ContainerCreating   0          5s
   video-compressor-5b5494d487-aaaaa   0/1     ContainerCreating   0          5s
   ```
   - New pods are created immediately

### Step 5: Observe Scale-Down

After video compression completes:

1. **Encoder utilization drops to 0**
2. **HPA waits 60 seconds** (stabilization window)
3. **Excess pods are terminated**, returning to `minReplicas: 1`

**Manual verification:**

```bash
# Check current replica count
kubectl get deployment video-compressor -o jsonpath='{.status.replicas}'

# Check GPU utilization
kubectl exec -it $(kubectl get pod -l app=video-compressor -o jsonpath='{.items[0].metadata.name}') -- nvidia-smi
```

### Troubleshooting Scaling Issues

**If encoder utilization stays at 0:**

```bash
# Check if FFmpeg is using hardware encoding
kubectl logs -l app=video-compressor | grep -i nvenc

# Verify the compression code uses h264_nvenc or hevc_nvenc
kubectl exec -it $(kubectl get pod -l app=video-compressor -o jsonpath='{.items[0].metadata.name}') -- ffmpeg -encoders | grep nvenc
```

**If HPA doesn't scale up:**

```bash
# Check HPA events
kubectl describe hpa video-compressor-hpa

# Manually verify the metric value
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .

# Check if deployment has the correct label
kubectl get deployment video-compressor -o yaml | grep -A 2 labels
```

**Manual scaling for testing:**

```bash
# Manually scale up to test
kubectl scale deployment video-compressor --replicas=4

# Watch them scale back down after 60 seconds
watch kubectl get pods -l app=video-compressor
```

---

## Restarting After Minikube Stop

If you run `minikube stop` and want to resume your demo later:

### Step 1: Start Minikube

```bash
# Start the existing cluster
minikube start

# Verify the cluster is up
kubectl get nodes
```

### Step 2: Verify GPU Configuration

```bash
# Check that time-slicing is still configured (should show 4)
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
```

**If it shows `1` instead of `4`:**

```bash
# Restart the device plugin addon
minikube addons disable nvidia-device-plugin
minikube addons enable nvidia-device-plugin

# Re-apply the time-slicing configuration
kubectl apply -f time-slicing.yaml

# Re-patch the DaemonSet (use the same command from earlier)
kubectl patch daemonset nvidia-device-plugin-daemonset -n kube-system --type='json' -p='[
  {"op": "add", "path": "/spec/template/spec/volumes/0", "value": {
    "name": "nvidia-config",
    "configMap": {"name": "nvidia-device-plugin-config"}
  }},
  {"op": "add", "path": "/spec/template/spec/containers/0/volumeMounts/0", "value": {
    "mountPath": "/etc/nvidia", "name": "nvidia-config"
  }},
  {"op": "add", "path": "/spec/template/spec/containers/0/args", "value": [
    "--config-file=/etc/nvidia/config.yaml"
  ]}
]'

# Verify (should now show 4)
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
```

### Step 3: Verify All Pods are Running

```bash
# Check all pods in default namespace
kubectl get pods

# Check monitoring pods
kubectl get pods -l app.kubernetes.io/name=prometheus
kubectl get pods -l app.kubernetes.io/name=prometheus-adapter
kubectl get pods -l app.kubernetes.io/name=dcgm-exporter

# Check application pods
kubectl get pods -l app=video-compressor
```

**If any pods are not running:**

```bash
# Restart the deployment
kubectl rollout restart deployment video-compressor

# Restart prometheus-adapter if needed
kubectl rollout restart deployment prometheus-adapter

# Delete and recreate dcgm-exporter if needed
kubectl delete -f dcgm-exporter.yaml
kubectl apply -f dcgm-exporter.yaml
```

### Step 4: Verify Monitoring Pipeline

```bash
# Port-forward to Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &

# Check encoder metric
curl -s 'http://localhost:9090/api/v1/query?query=dcgm_enc_utilization' | jq .

# Check custom metric
curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq .

# Verify custom metrics API
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .

# Stop port-forward
kill %1
```

### Step 5: Verify HPA

```bash
# Check HPA status
kubectl get hpa video-compressor-hpa
```

**Expected:** Should show `0/1` (not `<unknown>`).

### Step 6: Resume Testing

Follow the [Testing the Autoscaling](#testing-the-autoscaling) section to verify everything works.

---

## Troubleshooting

### Common Issues and Solutions

#### 1. Time-Slicing Not Working (Shows 1 GPU Instead of 4)

**Symptoms:**
```bash
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
# Output: 1 (should be 4)
```

**Solutions:**

```bash
# Check device plugin logs
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds

# Verify ConfigMap exists
kubectl get configmap -n kube-system nvidia-device-plugin-config

# Verify ConfigMap is mounted in the pod
kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep -A 10 volumes

# Verify --config-file argument is present
kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep -A 5 args

# If anything is missing, re-apply the patch
kubectl delete -f time-slicing.yaml
kubectl apply -f time-slicing.yaml
# Then run the patch command again
```

#### 2. DCGM Exporter in ImagePullBackOff

**Symptoms:**
```bash
kubectl get pods -l app.kubernetes.io/name=dcgm-exporter
# Output: NAME            READY   STATUS             RESTARTS   AGE
#         dcgm-exporter   0/1     ImagePullBackOff   0          2m
```

**Solution:**

Update the image tag in `dcgm-exporter.yaml` to a newer version:

```yaml
image: "nvcr.io/nvidia/k8s/dcgm-exporter:3.3.5-3.3.0-ubuntu22.04"
```

Then reapply:

```bash
kubectl delete -f dcgm-exporter.yaml
kubectl apply -f dcgm-exporter.yaml
```

#### 3. Custom Metric Not Appearing (`<unknown>` in HPA)

**Symptoms:**
```bash
kubectl get hpa video-compressor-hpa
# Output: TARGETS: <unknown>/1
```

**Debug steps:**

```bash
# 1. Check if metric exists in Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &
curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq .
kill %1

# 2. Check PrometheusRule status
kubectl describe prometheusrule video-compressor-rule

# 3. Check prometheus-adapter logs
kubectl logs -l app.kubernetes.io/name=prometheus-adapter --tail=50

# 4. Verify metric in custom metrics API
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq . | grep video_compressor_gpu_avg

# 5. Query the specific metric endpoint
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .
```

**Solutions:**

```bash
# If metric doesn't exist in Prometheus, re-create the rule
kubectl delete -f video-compressor-prometheusrule.yaml
kubectl apply -f video-compressor-prometheusrule.yaml

# If metric exists in Prometheus but not in custom metrics API, restart adapter
kubectl rollout restart deployment prometheus-adapter

# Wait 1-2 minutes and check again
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq . | grep video_compressor_gpu_avg
```

#### 4. Encoder Utilization Always 0

**Symptoms:**
Video compression runs but `dcgm_enc_utilization` stays at 0.

**Debug steps:**

```bash
# Check if FFmpeg is using NVENC
kubectl logs -l app=video-compressor | grep -i nvenc

# Check available encoders in the container
kubectl exec -it $(kubectl get pod -l app=video-compressor -o jsonpath='{.items[0].metadata.name}') -- ffmpeg -encoders 2>&1 | grep nvenc

# Check GPU is accessible from the pod
kubectl exec -it $(kubectl get pod -l app=video-compressor -o jsonpath='{.items[0].metadata.name}') -- nvidia-smi
```

**Solution:**

Ensure your video compression code uses hardware encoding:

```bash
ffmpeg -i input.mp4 -c:v h264_nvenc -preset fast output.mp4
# or
ffmpeg -i input.mp4 -c:v hevc_nvenc -preset fast output.mp4
```

#### 5. Prometheus Scraping Timeout

**Symptoms:**
```bash
kubectl logs -l app.kubernetes.io/name=prometheus-adapter
# Output: E1102 19:27:41.179801 apiserver was unable to write a fallback JSON response: http: Handler timeout
```

**Solution:**

This is usually transient. The adapter is working but responses are slow. If persistent:

```bash
# Increase adapter resources
kubectl edit deployment prometheus-adapter

# Add resource limits:
# resources:
#   limits:
#     cpu: 500m
#     memory: 512Mi
#   requests:
#     cpu: 100m
#     memory: 128Mi
```

#### 6. HPA Not Scaling Despite High Utilization

**Debug steps:**

```bash
# Check HPA events
kubectl describe hpa video-compressor-hpa

# Verify metric value is above threshold
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq '.value'

# Check HPA controller logs
kubectl logs -n kube-system -l component=kube-controller-manager | grep -i horizontal | tail -20

# Verify deployment is not at maxReplicas
kubectl get deployment video-compressor -o jsonpath='{.status.replicas}'
```

**Solution:**

```bash
# If metric is correct but HPA not scaling, delete and recreate HPA
kubectl delete hpa video-compressor-hpa
kubectl apply -f video-compressor-hpa.yaml
```

---

## Cleanup

### Remove the Demo Environment

```bash
# Delete application resources
kubectl delete -f video-compressor-hpa.yaml
kubectl delete -f video-compressor-deployment.yaml
kubectl delete -f video-compressor-prometheusrule.yaml

# Uninstall Helm releases
helm uninstall prometheus-adapter
helm uninstall kube-prometheus-stack

# Delete monitoring components
kubectl delete -f dcgm-exporter.yaml

# Delete time-slicing configuration
kubectl delete -f time-slicing.yaml

# Delete the node label
kubectl label nodes minikube accelerator-
```

### Stop Minikube

```bash
# Stop the cluster (preserves configuration)
minikube stop
```

### Delete Minikube Cluster

```bash
# Completely delete the cluster
minikube delete
```

---

## Quick Reference Commands

### Check System Status

```bash
# Node GPU count
kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'

# All pods status
kubectl get pods -A

# Application pods
kubectl get pods -l app=video-compressor

# HPA status
kubectl get hpa video-compressor-hpa
```

### Check Metrics

```bash
# Port-forward to Prometheus
kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090 &

# Query encoder utilization
curl -s 'http://localhost:9090/api/v1/query?query=dcgm_enc_utilization' | jq -r '.data.result[0].value[1]'

# Query custom metric
curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq -r '.data.result[0].value[1]'

# Query custom metrics API
kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1/namespaces/default/deployments.apps/video-compressor/video_compressor_gpu_avg | jq .

# Stop port-forward
kill %1
```

### Check Logs

```bash
# Device plugin logs
kubectl logs -n kube-system -l name=nvidia-device-plugin-ds

# DCGM exporter logs
kubectl logs -l app.kubernetes.io/name=dcgm-exporter

# Prometheus adapter logs
kubectl logs -l app.kubernetes.io/name=prometheus-adapter

# Application logs
kubectl logs -l app=video-compressor

# HPA controller logs
kubectl logs -n kube-system -l component=kube-controller-manager | grep -i horizontal
```

### Restart Components

```bash
# Restart device plugin
kubectl rollout restart daemonset -n kube-system nvidia-device-plugin-daemonset

# Restart DCGM exporter
kubectl rollout restart daemonset dcgm-exporter

# Restart prometheus-adapter
kubectl rollout restart deployment prometheus-adapter

# Restart application
kubectl rollout restart deployment video-compressor
```

---

## File Checklist

Ensure you have these files in your workspace:

- `time-slicing.yaml` - GPU time-slicing configuration
- `dcgm-exporter.yaml` - GPU metrics collector
- `kube-prometheus-stack-values.yaml` - Prometheus configuration
- `video-compressor-deployment.yaml` - Application deployment
- `video-compressor-prometheusrule.yaml` - Custom metric definition
- `prometheus-adapter-values.yaml` - Metrics adapter configuration
- `video-compressor-hpa.yaml` - Autoscaler configuration

---

## Notes

- **Encoder vs Compute Utilization**: For video compression workloads, `dcgm_enc_utilization` (encoder) is more accurate than `dcgm_gpu_utilization` (compute). This demo uses encoder utilization.

- **Time-Slicing Limitations**: Time-slicing provides no memory or fault isolation. All pods sharing a GPU have equal access to GPU time, regardless of how many "replicas" they request.

- **Scaling Behavior**: The HPA is configured for aggressive scaling:
  - Scale up: Immediate (0 second stabilization)
  - Scale down: 60 second stabilization window
  - Threshold: 1% utilization (very sensitive for demo purposes)

- **Production Recommendations**: For production use:
  - Increase the threshold to 50-70%
  - Increase stabilization windows to 5-10 minutes
  - Add resource limits and requests
  - Use PodDisruptionBudgets
  - Monitor with Grafana dashboards

---

## License

This guide is provided under the MIT License. See `MIT-LICENSE.txt` for details.

---

## Support

For issues or questions:
1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [NVIDIA GPU Operator documentation](https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/)
3. Open an issue in the repository

---

*Last updated: November 3, 2025*
