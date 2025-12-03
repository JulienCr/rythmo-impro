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

# Run the Python script with all arguments passed through
python "$SCRIPT_DIR/main.py" "$@"
