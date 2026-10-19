# AWS EC2 Infrastructure Setup Guide

This document outlines the step-by-step procedure to provision and configure the AWS infrastructure for running the vLLM inference engine on an NVIDIA L40S GPU.

---

## 1. Request GPU Service Quota

New and sandbox AWS accounts have a default quota of 0 vCPUs for GPU instances. You must request a quota increase prior to launching the instance.

1. In the AWS Management Console, search for and open **Service Quotas**.
2. Select **Amazon Elastic Compute Cloud (Amazon EC2)**.
3. Search for the quota named:
   `Running On-Demand G and VT instances`
4. Click **Request quota increase**.
5. Set the requested quota value to at least **8 vCPUs** (1x `g6e.2xlarge` uses 8 vCPUs).
6. Submit the request. Approval typically takes between 15 minutes and a few hours.

---

## 2. Configure Security Group (Firewall Rules)

Create a dedicated Security Group in your target VPC:

1. Navigate to **EC2 > Security Groups > Create security group**.
2. Name: `vllm-inference-sg`
3. Description: `Security group for internal vLLM inference endpoint and SSH administration`
4. Inbound rules:
   - **Rule 1 (SSH Access):**
     - Type: `SSH` (Port 22)
     - Source: `My IP` or Corporate VPN CIDR range. Do NOT allow `0.0.0.0/0`.
   - **Rule 2 (vLLM API Access):**
     - Type: `Custom TCP` (Port 8000)
     - Source: Corporate VPN CIDR range or office network CIDR.
5. Outbound rules:
   - Default: All traffic allowed (`0.0.0.0/0`) to allow downloading model weights from Hugging Face and container images from Docker registries.

---

## 3. Provision the EC2 Instance

1. Navigate to **EC2 > Instances > Launch instances**.
2. **Name:** `openweight-vllm-prod`
3. **Application and OS Images (AMI):**
   - Search in the Community AMIs or AWS Marketplace for:
     `Deep Learning OSS Nvidia Driver AMI GPU PyTorch (Ubuntu 22.04)`
   - Note: Using this AMI avoids manual compilation of NVIDIA CUDA drivers and Docker toolkit.
4. **Instance Type:**
   - Select `g6e.2xlarge` (1x NVIDIA L40S 48GB GPU, 8 vCPUs, 64 GiB RAM).
5. **Key Pair:**
   - Select or generate an RSA key pair (e.g., `vllm-prod-key.pem`).
6. **Network Settings:**
   - Select your target VPC and Subnet.
   - Auto-assign public IP: `Enable` (or rely on corporate internal routing).
   - Firewall: Select the existing security group `vllm-inference-sg`.
7. **Configure Storage (Critical Step):**
   - Locate the Root volume configuration.
   - Change Size from default `30 GiB` to **`200 GiB`**.
   - Volume Type: **`gp3`**.
   - IOPS: `3000` (default).
   - Throughput: `125 MB/s` (default).
8. **Advanced Details (Optional but Recommended):**
   - **IAM instance profile:** Attach an IAM role with the policy `AmazonSSMManagedInstanceCore`.
   - Benefit: Enables connecting via AWS Systems Manager Session Manager directly from the browser without needing open SSH keys.
9. Click **Launch instance**.

---

## 4. Connect to the EC2 Instance

### Option A: AWS Systems Manager (SSM)
If the IAM role `AmazonSSMManagedInstanceCore` was attached:
1. In the EC2 Console, select the instance.
2. Click **Connect**.
3. Choose **Session Manager** and click **Connect**. A terminal window opens immediately in the browser.

### Option B: SSH via Terminal
From your terminal:
```bash
chmod 400 vllm-prod-key.pem
ssh -i vllm-prod-key.pem ubuntu@<INSTANCE-PUBLIC-IP>
```

---

## 5. Host Preparation & Deployment

Once connected to the instance:

### Step 1: Verify NVIDIA Driver
```bash
nvidia-smi
```
Expected output: Confirms NVIDIA L40S, 48GB VRAM, Driver version 550+, CUDA 12+.

### Step 2: Verify Docker and NVIDIA Container Toolkit
```bash
docker --version
docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi
```
If the Deep Learning AMI is used, this will succeed out of the box.

### Step 3: Clone Repository and Deploy
```bash
git clone https://github.com/alphastar-avi/OpenWeight-Fabric.git
cd OpenWeight-Fabric/deploy/aws-production

# Create persistent model storage directory on the 200GB EBS volume
sudo mkdir -p /data/model-cache
sudo chown -R $USER:$USER /data/model-cache

# Run the automated production startup script
./start.sh
```

---

## 6. Verification and Health Check

From your local developer machine (connected to corporate VPN):

```bash
# Check health
curl http://<INSTANCE-IP>:8000/health

# Check registered models
curl http://<INSTANCE-IP>:8000/v1/models

# Send test generation request
curl http://<INSTANCE-IP>:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-30b",
    "messages": [{"role": "user", "content": "Write a Go function for binary search."}],
    "max_tokens": 150
  }'
```

---

## 7. Note on FP8 Support (Hardware & vLLM Engine)

Full-speed FP8 inference requires alignment across both hardware and the inference engine:
1. **Hardware (GPU):** Requires NVIDIA Ada Lovelace (`sm_89`, e.g., L40S on `g6e`) or Hopper (`sm_90`). Older architectures (e.g., Ampere A10G on `g5`) lack native FP8 compute Tensor Cores and fall back to Marlin software dequantization (~16 tok/s vs 25–35+ tok/s).
2. **vLLM Engine Support:** vLLM v0.31.0+ natively compiles FlashInfer and Marlin FP8 kernels for `--kv-cache-dtype fp8` and `--quantization fp8`. Verify that the model checkpoint includes `q_scale` and `k_scale` calibration factors in its configuration to avoid uncalibrated attention warnings.

