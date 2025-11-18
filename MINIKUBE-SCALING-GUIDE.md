# End-to-End GPU Scaling Demo on Minikube

This guide provides a complete walkthrough for setting up a Kubernetes cluster using Minikube, configuring it for GPU time-slicing, and deploying the video compressor application with autoscaling based on GPU metrics.

Your GPU UUID is: `<gpu-uuid get-using nvidia-smi -L >`

---

### Step 1: Prerequisites & Cluster Setup

1.  **Install Prerequisites**: Ensure you have `minikube`, `docker`, `kubectl`, and `helm` installed. Your NVIDIA drivers must also be correctly installed on your host machine.

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

---

### Step 2: Configure GPU Time-Slicing

This will partition your single physical GPU into 4 virtual, time-sliced GPUs, allowing multiple pods to request a GPU resource.


minikube addons disable nvidia-device-plugin
minikube addons enable nvidia-device-plugin

1.  **Create the Time-Slicing ConfigMap**: This configuration tells the NVIDIA device plugin to advertise 4 GPU resources based on your physical GPU's UUID.

    ```bash
    # Create the configmap using your GPU UUID
    cat <<EOF | kubectl apply -f -
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
    EOF
    ```

2.  **Patch the Device Plugin DaemonSet**: Mount the ConfigMap into the device plugin pods so they apply the new configuration.

    ```bash
    kubectl patch daemonset nvidia-device-plugin-daemonset -n kube-system --type='json' -p='[{"op": "add", "path": "/spec/template/spec/volumes/0", "value": {"name": "nvidia-config", "configMap": {"name": "nvidia-device-plugin-config"}}},{"op": "add", "path": "/spec/template/spec/containers/0/volumeMounts/0", "value": {"mountPath": "/etc/nvidia", "name": "nvidia-config"}}]'
    ```
    The `nvidia-device-plugin` pod in the `kube-system` namespace will restart.


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


3.  **Verify Time-Slicing**: After a minute, check that the node reports 4 allocatable GPUs.

    ```bash
    kubectl get node minikube -o=jsonpath='{.status.allocatable.nvidia\.com/gpu}'
    ```
    **Expected output:** `4`

---

### Step 3: Deploy Monitoring Components

1.  **Install DCGM Exporter**: This daemonset will collect and expose detailed GPU metrics.

    ```bash
    kubectl apply -f dcgm-exporter.yaml
    ```
    *Note: The default `dcgm-exporter.yaml` should work with Minikube, but if you encounter issues, you may need to adjust the `hostPath` for the `libnvidia` volume.*

2.  **Add Prometheus Helm Repository**:

    ```bash
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
    helm repo update
    ```

3.  **Install Kube-Prometheus-Stack**: This installs Prometheus and Grafana. The values file configures Prometheus to scrape metrics from `dcgm-exporter`.

    ```bash
    helm upgrade --install kube-prometheus-stack prometheus-community/kube-prometheus-stack -f kube-prometheus-stack-values.yaml
    ```

---

### Step 4: Deploy and Configure the Application

1.  **Build and Push Your Docker Image**:
    Ensure you have rebuilt and pushed the `docker.io/aunchagaonkar/video-compressor` image after making the code changes to the frontend and backend to display the pod name.

2.  **Deploy the Video Compressor**: Apply the manifest to create the Deployment and the LoadBalancer Service.

    ```bash
    kubectl apply -f video-compressor-deployment.yaml
    ```

3.  **Create the Prometheus Rule**: This rule creates the custom metric `video_compressor_gpu_avg` that the HPA will use.

    ```bash
    kubectl apply -f video-compressor-prometheusrule.yaml
    ```

4.  **Install Prometheus Adapter**: This adapter exposes the custom metric from Prometheus to the Kubernetes custom metrics API.

    ```bash
    helm upgrade --install prometheus-adapter prometheus-community/prometheus-adapter --set prometheus.url="http://kube-prometheus-stack-prometheus.default.svc.cluster.local"
    ```

5.  **Verify Custom Metric API**: Wait a minute and check that the metric is available.

    ```bash
    kubectl get --raw /apis/custom.metrics.k8s.io/v1beta1 | jq -r . | grep video_compressor_gpu_avg
    ```
    You should see an entry for `video_compressor_gpu_avg`.

6.  **Create the HorizontalPodAutoscaler (HPA)**: This is the final piece that connects the metric to the deployment's scale.

    ```bash
    kubectl apply -f video-compressor-hpa.yaml
    ```

---

### Step 5: Test the Scaling Demo

1.  **Get Application URL**: Since we are using Minikube, get the URL for the service. This command will open the application in your browser.

    ```bash
    minikube service video-compressor-svc
    ```

2.  **Watch the HPA**: In a separate terminal, watch the HPA status. It will update every 15-30 seconds.

    ```bash
    kubectl get hpa video-compressor-hpa -w
    ```
    Initially, the `TARGETS` will show `<unknown>/10` until the metric is scraped, then `0/10`.

3.  **Generate GPU Load**:
    - In the browser window that opened, upload a video file.
    - Click "Compress Video".
    - The compression will start on one of the pods, generating GPU load.

4.  **Observe Scaling**:
    - Look at the terminal watching the HPA. The `TARGETS` value will rise above `0`.
    - When the average utilization (`TARGETS`) exceeds `10`, the HPA will increase the `REPLICAS` count from 2 to 3, and then to 4.
    - You can also watch the pods being created: `kubectl get pods -l app=video-compressor -w`

5.  **Test Load Balancing**:
    - Open a new incognito browser window and navigate to the same URL.
    - The request may be served by a different pod. The UI will show the name of the pod serving you (e.g., `Served by Pod: video-compressor-xxxx-yyyy`).

6.  **Observe Scale Down**:
    - Once the compression job finishes, GPU utilization will drop to 0.
    - The HPA will wait for the `scaleDown` stabilization window (300 seconds) before reducing the replica count back to 2.