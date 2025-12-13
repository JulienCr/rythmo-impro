#!/bin/bash
# Wrapper script for vocal removal
# Activates venv and calls remove-vocals.py

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

# Activate virtual environment
source "$SCRIPT_DIR/venv/bin/activate"

# Load environment variables from .env if it exists (not required for vocal removal)
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -a
    source "$SCRIPT_DIR/.env"
    set +a
fi

# PyTorch 2.6+ compatibility: Disable weights-only loading for trusted model checkpoints
export TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD=1

# Add cuDNN libraries from venv to library path
export LD_LIBRARY_PATH="$SCRIPT_DIR/venv/lib/python3.10/site-packages/nvidia/cudnn/lib:${LD_LIBRARY_PATH}"

# Run the Python script with all arguments passed through
python "$SCRIPT_DIR/remove-vocals.py" "$@"
