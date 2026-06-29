#!/bin/bash
# Setup script for WSL/Linux environment
# Run this once to install all dependencies

set -e  # Exit on error

echo "🚀 Setting up rythmo-impro diarization service for WSL..."

# Check if running in WSL
if ! grep -q microsoft /proc/version 2>/dev/null && ! grep -q WSL /proc/version 2>/dev/null; then
    echo "⚠️  Warning: This doesn't appear to be WSL. Script will continue anyway."
fi

# Update package list
echo "📦 Updating package list..."
sudo apt-get update

# Install system dependencies
echo "📦 Installing system dependencies..."
sudo apt-get install -y \
    python3.10 \
    python3-pip \
    python3.10-venv \
    ffmpeg \
    libavcodec-dev \
    libavformat-dev \
    libavdevice-dev \
    libavutil-dev \
    libavfilter-dev \
    libswscale-dev \
    libswresample-dev \
    pkg-config \
    git

# Create virtual environment
echo "🐍 Creating Python virtual environment..."
if [ -d "venv" ]; then
    echo "Virtual environment already exists, skipping creation..."
else
    python3.10 -m venv venv
fi

# Activate virtual environment
echo "🐍 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "📦 Upgrading pip..."
pip install --upgrade pip

# Install dependencies from requirements.txt
# (includes PyTorch with CUDA 12.8 support)
echo "📦 Installing Python dependencies (including PyTorch with CUDA)..."
pip install -r requirements.txt

# Check for .env file
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo "Please create diarizer/.env with your Hugging Face token:"
    echo ""
    echo "HF_TOKEN=your_token_here"
    echo ""
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To use the diarization service:"
echo "1. Activate the virtual environment: source diarizer/venv/bin/activate"
echo "2. Run: ./diarizer/run-wsl.sh --input in/video.mp4 --output out/cues.json"
echo ""
echo "Or use the convenience script: ./diarizer/run-wsl.sh --input in/video.mp4 --output out/cues.json"
