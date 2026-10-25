#!/usr/bin/env bash
# =============================================================================
# SAORI KOKORO â€” Automated Framework Installer
# =============================================================================
set -e

echo "============================================================"
echo "  ðŸš€ Installing SAORI Kokoro Autonomous Framework"
echo "============================================================"

# 1. Verify Python >= 3.10
if ! command -v python3 &>/dev/null; then
    echo "â�Œ Error: Python 3 is not installed. Please install Python 3.10 or higher."
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)

if [ "$PY_MAJOR" -lt 3 ] || [ "$PY_MINOR" -lt 10 ]; then
    echo "â�Œ Error: Python 3.10+ required. Found $PY_VER."
    exit 1
fi
echo "âœ“ Python $PY_VER detected."

# 2. Setup Virtual Environment
VENV_DIR=".venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "ðŸ“¦ Creating virtual environment in $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel --quiet

# 3. Install SAORI in editable mode
echo "âš™ï¸�  Installing SAORI CLI and dependencies..."
pip install -e . --quiet

# 4. Initialize .env if missing
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "âœ“ Created .env from .env.example template."
    fi
fi

# 5. Run diagnostic
echo ""
saori doctor

echo "============================================================"
echo "  ðŸŽ‰ SAORI installation complete!"
echo "  To start, activate the environment:"
echo "    source .venv/bin/activate"
echo "    saori init      # To configure your preferred LLM provider"
echo "    saori doctor    # To verify your connection"
echo "    saori chat      # To test conversational SRE"
echo "============================================================"
