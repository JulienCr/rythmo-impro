#!/bin/bash
# Convenience script to run diarization in WSL
# Automatically activates venv and loads .env

set -e  # Exit on error

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Check if virtual environment exists
if [ ! -d "$SCRIPT_DIR/venv" ]; then
    echo "❌ Virtual environment not found!"
    echo "Please run setup-wsl.sh first:"
    echo "   cd diarizer && ./setup-wsl.sh"
    exit 1
fi

# Check if .env exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "❌ .env file not found!"
    echo "Please create diarizer/.env with your Hugging Face token:"
    echo ""
    echo "HF_TOKEN=your_token_here"
    echo ""
    exit 1
fi

# Activate virtual environment
source "$SCRIPT_DIR/venv/bin/activate"

# Load environment variables from .env
set -a  # Automatically export all variables
source "$SCRIPT_DIR/.env"
set +a

# PyTorch 2.6+ compatibility: Disable weights-only loading for trusted model checkpoints
# This allows loading of pyannote/WhisperX models that contain library-specific classes
# See: https://github.com/m-bain/whisperX/issues/1304
export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1

# Add cuDNN libraries from venv to library path
# PyTorch 2.8+ installs cuDNN as a pip package, but we need to ensure it's found at runtime
export LD_LIBRARY_PATH="$SCRIPT_DIR/venv/lib/python3.10/site-packages/nvidia/cudnn/lib:${LD_LIBRARY_PATH}"

# Run the Python script with all arguments passed through
python "$SCRIPT_DIR/main.py" "$@"
