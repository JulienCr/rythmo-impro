# CUDA-enabled base for faster GPU processing
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set Python 3.10 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1
RUN update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

# Set working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt .

# Install PyTorch with CUDA support first
RUN pip install --no-cache-dir torch==2.0.1 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cu118

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY main.py .

# Environment variables (HF_TOKEN must be provided at runtime)
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/tmp/huggingface

# Create volume mount points
VOLUME ["/in", "/out"]

# Set entrypoint
ENTRYPOINT ["python", "/app/main.py"]
