# End-to-End GPU Scaling Demo on Minikube

This guide provides a complete walkthrough for setting up a Kubernetes cluster using Minikube, configuring it for GPU time-slicing, and deploying the video compressor application with autoscaling based on GPU metrics.

Your GPU UUID is: `<gpu-uuid get-using nvidia-smi -L >`

---

## Step 1: Prerequisites & Cluster Setup

1.  **Install Prerequisites**: Ensure you have `minikube`, `docker`, `kubectl`, `helm`, and `jq` installed. Your NVIDIA drivers must also be correctly installed on your host machine.

2.  **Start Minikube**: Start a new Minikube cluster with the Docker driver and GPU access enabled.

    ```bash
    minikube start --driver=docker --gpus=all
    ```

3.  **Enable NVIDIA Device Plugin**: The NVIDIA device plugin allows Kubernetes to discover and use the GPU. Enable the Minikube addon for it.

    ```bash
    minikube addons enable nvidia-device-plugin
    ```

4.  **Label the Minikube Node**: Label the node so `dcgm-exporter` knows where to run.

    ```bash
    kubectl label nodes minikube accelerator=nvidia-gpu
    ```

5.  **Verify GPU is Available**: Check that the node shows 1 allocatable GPU.

    ```bash
    kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
    ```
    **Expected output:** `1`

---

## Step 2: Configure GPU Time-Slicing

This will partition your single physical GPU into 4 virtual, time-sliced GPUs, allowing multiple pods to request a GPU resource.

1.  **Create the Time-Slicing ConfigMap**: Apply the configuration file that tells the NVIDIA device plugin to advertise 4 GPU resources.

    ```bash
    kubectl apply -f time-slicing.yaml
    ```

    The `time-slicing.yaml` file should contain:
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

2.  **Patch the Device Plugin DaemonSet**: Mount the ConfigMap and add the `--config-file` argument to make the device plugin use the time-slicing configuration.

    ```bash
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

3.  **Watch the Device Plugin Restart**: Monitor the pod restart to ensure the patch is applied.

    ```bash
    kubectl get pods -n kube-system -l name=nvidia-device-plugin-ds -w
    ```
    Wait until the old pod terminates and the new one is `Running`. Press `Ctrl+C` to exit the watch.

4.  **Verify Time-Slicing**: Check that the node now reports 4 allocatable GPUs.

    ```bash
    kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
    ```
    **Expected output:** `4`

    If you still see `1`, check the device plugin logs:
    ```bash
    kubectl logs -n kube-system -l name=nvidia-device-plugin-ds
    ```

---

## Step 3: Deploy Monitoring Components

1.  **Install DCGM Exporter**: This daemonset will collect and expose detailed GPU metrics.

    ```bash
    kubectl apply -f dcgm-exporter.yaml
    ```

2.  **Verify DCGM Exporter is Running**: Check that the pod is running and not stuck in `ImagePullBackOff`.

    ```bash
    kubectl get pods -l app.kubernetes.io/name=dcgm-exporter
    ```

    If the pod is in `ImagePullBackOff` or `CrashLoopBackOff`, check the logs:
    ```bash
    kubectl logs -l app.kubernetes.io/name=dcgm-exporter
    ```

3.  **Test DCGM Exporter Metrics**: Port-forward to the service and query for GPU metrics.

    ```bash
    kubectl port-forward svc/dcgm-exporter 9400:9400
    ```
    
    In a new terminal:
    ```bash
    curl localhost:9400/metrics | grep dcgm_gpu_utilization
    ```
    You should see GPU utilization metrics. Press `Ctrl+C` in the first terminal to stop the port-forward.

4.  **Add Prometheus Helm Repository**:

    ```bash
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update
    ```

5.  **Install Kube-Prometheus-Stack**: This installs Prometheus and Grafana. The values file configures Prometheus to scrape metrics from `dcgm-exporter`.

    ```bash
    helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
      -f kube-prometheus-stack-values.yaml \
      --timeout 15m
    ```

6.  **Wait for Prometheus to be Ready**: Monitor the pods until they are all running.

    ```bash
    kubectl get pods -l app.kubernetes.io/name=prometheus -w
    ```
    Wait for `prometheus-kube-prometheus-stack-prometheus-0` to be `2/2 Running`. Press `Ctrl+C` to exit.

---

## Step 4: Deploy and Configure the Application

1.  **Build and Push Your Docker Image** (if you made code changes):
    Ensure you have rebuilt and pushed the `docker.io/aunchagaonkar/video-compressor` image after making the code changes to the frontend and backend to display the pod name.

    ```bash
    cd compressVideoGPU
    docker build -t docker.io/aunchagaonkar/video-compressor:latest .
    docker push docker.io/aunchagaonkar/video-compressor:latest
    ```

2.  **Deploy the Video Compressor**: Apply the manifest to create the Deployment and the LoadBalancer Service.

    ```bash
    kubectl apply -f video-compressor-deployment.yaml
    ```

3.  **Verify Pods are Running**: Check that both video compressor pods are running.

    ```bash
    kubectl get pods -l app=video-compressor
    ```

    Both pods should show `1/1 Running`. If they're stuck in `ContainerCreating` or `ImagePullBackOff`, describe the pod:
    ```bash
    kubectl describe pod -l app=video-compressor
    ```

4.  **Create the Prometheus Rule**: This rule creates the custom metric `video_compressor_gpu_avg` that the HPA will use.

    ```bash
    kubectl apply -f video-compressor-prometheusrule.yaml
    ```

5.  **Verify the Prometheus Rule is Loaded**: Port-forward to Prometheus and check the rules.

    ```bash
    kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090
    ```

    In a new terminal, verify the rule exists:
    ```bash
    curl -s 'http://localhost:9090/api/v1/rules' | jq '.data.groups[] | select(.name=="gpu-rule-group")'
    ```

    You should see the `video_compressor_gpu_avg` recording rule with `"health": "ok"`.

6.  **Test the Metric in Prometheus**: Query Prometheus to see if the metric has data.

    ```bash
    # First check the base metric
    curl -s 'http://localhost:9090/api/v1/query?query=dcgm_gpu_utilization' | jq .
    
    # Then check your custom metric
    curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq .
    ```

    The first query should return data with your GPU UUID. The second query should return a result with a value (possibly `0` if no GPU load is present).

    Press `Ctrl+C` in the port-forward terminal when done.

7.  **Install Prometheus Adapter**: This adapter exposes the custom metric from Prometheus to the Kubernetes custom metrics API.

    ```bash
    helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter \
      --set prometheus.url="http://kube-prometheus-stack-prometheus.default.svc.cluster.local" \
      -f prometheus-adapter-values.yaml
    ```

8.  **Wait for Prometheus Adapter to be Ready**:

    ```bash
    kubectl get pods -l app.kubernetes.io/name=prometheus-adapter -w
    ```
    Wait until the pod is `1/1 Running`. Press `Ctrl+C` to exit.

9.  **Verify Custom Metric API**: Wait about 1-2 minutes for the adapter to discover metrics, then check.

    ```bash
    kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq . | grep video_compressor_gpu_avg
    ```

    You should see an entry for `video_compressor_gpu_avg`. If not, check the adapter logs:
    ```bash
    kubectl logs -l app.kubernetes.io/name=prometheus-adapter
    ```

10. **Create the HorizontalPodAutoscaler (HPA)**: This is the final piece that connects the metric to the deployment's scale.

    ```bash
    kubectl apply -f video-compressor-hpa.yaml
    ```

11. **Verify the HPA is Created**:

    ```bash
    kubectl get hpa video-compressor-hpa
    ```

    You should see the HPA with `TARGETS` showing `<unknown>/10` initially, then updating to `0/10` or a numeric value.

---

## Step 5: Test the Scaling Demo

1.  **Get Application URL**: Since we are using Minikube, get the URL for the service. This command will open the application in your browser.

    ```bash
    minikube service video-compressor-svc
    ```

    Note the URL that appears (e.g., `http://192.168.49.2:30736`).

2.  **Watch the HPA**: In a separate terminal, watch the HPA status. It will update every 15-30 seconds.

    ```bash
    kubectl get hpa video-compressor-hpa -w
    ```

    Initially, the `TARGETS` will show `<unknown>/10` until the metric is scraped, then it should show a value like `0/10`.

3.  **Watch the Pods**: In another terminal, watch the video compressor pods.

    ```bash
    kubectl get pods -l app=video-compressor -w
    ```

4.  **Generate GPU Load**:
    - In the browser window that opened, you should see the video compressor UI.
    - Note which pod is serving you (shown at the top of the page).
    - Upload a video file.
    - Click "Compress Video".
    - The compression will start on one of the pods, generating GPU load.

5.  **Monitor GPU Utilization**: While the video is compressing, check the GPU utilization in Prometheus.

    ```bash
    kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090
    ```

    In another terminal:
    ```bash
    curl -s 'http://localhost:9090/api/v1/query?query=dcgm_gpu_utilization' | jq '.data.result[0].value[1]'
    curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq '.data.result[0].value[1]'
    ```

    You should see non-zero values while compression is running.

6.  **Observe Scaling**:
    - Look at the terminal watching the HPA. The `TARGETS` value should rise above `0`.
    - When the average utilization (`TARGETS`) exceeds `10`, the HPA will increase the `REPLICAS` count from 2 to 3, and potentially to 4.
    - In the terminal watching the pods, you'll see new pods being created: `ContainerCreating` → `Running`.

7.  **Test Load Balancing**:
    - Open a new incognito browser window and navigate to the same URL.
    - The request may be served by a different pod. The UI will show the name of the pod serving you (e.g., `Served by Pod: video-compressor-xxxx-yyyy`).
    - Upload and compress videos from multiple browser windows to distribute load across pods.

8.  **Observe Scale Down**:
    - Once all compression jobs finish, GPU utilization will drop to 0.
    - The HPA will wait for the `scaleDown` stabilization window (300 seconds = 5 minutes) before reducing the replica count.
    - After the stabilization window, you'll see the `REPLICAS` count decrease back to 2 in the HPA watch terminal.

---

## Troubleshooting

### Time-Slicing Not Working (Still shows 1 GPU)

If `kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'` still returns `1`:

1. Check device plugin logs:
   ```bash
   kubectl logs -n kube-system -l name=nvidia-device-plugin-ds
   ```

2. Verify the ConfigMap is mounted:
   ```bash
   kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep -A 5 volumes
   ```

3. Verify the `--config-file` argument is present:
   ```bash
   kubectl get pod -n kube-system -l name=nvidia-device-plugin-ds -o yaml | grep config-file
   ```

### DCGM Exporter in ImagePullBackOff

If the `dcgm-exporter` pod is stuck in `ImagePullBackOff`, the image tag may be outdated. Check the image in `dcgm-exporter.yaml` and update to a newer version like `nvcr.io/nvidia/k8s/dcgm-exporter:3.3.5-3.3.0-ubuntu22.04`.

### Custom Metric Not Appearing

If `video_compressor_gpu_avg` doesn't appear in the custom metrics API:

1. Verify the metric exists in Prometheus:
   ```bash
   kubectl port-forward svc/kube-prometheus-stack-prometheus 9090:9090
   curl -s 'http://localhost:9090/api/v1/query?query=video_compressor_gpu_avg' | jq .
   ```

2. Check the PrometheusRule status:
   ```bash
   kubectl describe prometheusrule video-compressor-rule
   ```

3. Check prometheus-adapter logs:
   ```bash
   kubectl logs -l app.kubernetes.io/name=prometheus-adapter
   ```

4. Verify the prometheus-adapter configuration:
   ```bash
   kubectl get configmap prometheus-adapter -o yaml
   ```

### HPA Shows `<unknown>` for Metrics

If the HPA shows `<unknown>` for the `TARGETS`:

1. Verify the custom metric is available:
   ```bash
   kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq . | grep video_compressor_gpu_avg
   ```

2. Check HPA events:
   ```bash
   kubectl describe hpa video-compressor-hpa
   ```

3. Ensure the prometheus-adapter is running:
   ```bash
   kubectl get pods -l app.kubernetes.io/name=prometheus-adapter
   ```

---

## Cleanup

To tear down the demo environment:

```bash
# Delete the HPA and deployment
kubectl delete -f video-compressor-hpa.yaml
kubectl delete -f video-compressor-deployment.yaml
kubectl delete -f video-compressor-prometheusrule.yaml

# Uninstall Helm releases
helm uninstall prometheus-adapter
helm uninstall kube-prometheus-stack

# Delete DCGM exporter
kubectl delete -f dcgm-exporter.yaml

# Delete the time-slicing ConfigMap
kubectl delete -f time-slicing.yaml

# Stop Minikube
minikube stop

# Delete the cluster (optional)
minikube delete
```