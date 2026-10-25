# ðŸ› ï¸� SAORI KOKORO â€” Installation & Quickstart Guide

This guide walks you through setting up and running **SAORI Kokoro** on Linux, macOS, and Windows.

---

## ðŸ“‹ Prerequisites

- **Python 3.10+** (Python 3.11 or 3.12 recommended).
- **Git**.
- **SQLite 3** (included with standard Python).
- At least **one** supported AI provider:
  - Local **Ollama** (Free, zero API keys required).
  - Or an API key for **Anthropic**, **OpenAI**, **Google Gemini**, or any **OpenAI-Compatible** endpoint.

---

## âš¡ 1-Minute Automated Setup (Linux / macOS)

Run the included automated installer:

```bash
git clone https://github.com/JackStar6677-1/saori.git
cd saori
chmod +x install.sh
./install.sh
```

The script will:
1. Verify your Python version.
2. Create and activate a clean `.venv` virtual environment.
3. Install SAORI CLI in editable mode (`pip install -e .`).
4. Generate `.env` from template.
5. Run `saori doctor` to verify environment health.

---

## ðŸ–¥ï¸� Manual Installation (All Platforms)

### Step 1: Clone the Repository
```bash
git clone https://github.com/JackStar6677-1/saori.git
cd saori
```

### Step 2: Create a Virtual Environment
- **Linux / macOS:**
  ```bash
  python3 -m venv .venv
  source .venv/bin/activate
  ```
- **Windows (PowerShell):**
  ```powershell
  python -m venv .venv
  .\.venv\Scripts\Activate.ps1
  ```

### Step 3: Install SAORI
```bash
pip install --upgrade pip setuptools wheel
pip install -e .
```

To install optional terminal UI tools (Textual / Rich):
```bash
pip install -e ".[tui]"
```

---

## âš™ï¸� Initial Configuration

Run the interactive setup wizard:

```bash
saori init
```

The wizard will prompt you to pick your primary provider:
1. **Local Ollama** (e.g. `llama3.2`, `qwen2.5-coder`, `mistral`)
2. **Anthropic Claude** (`ANTHROPIC_API_KEY`)
3. **OpenAI** (`OPENAI_API_KEY`)
4. **Google Gemini** (`GEMINI_API_KEY`)
5. **OpenAI-Compatible** (`OPENAI_COMPATIBLE_BASE_URL` - vLLM, DeepSeek, LocalAI)

Alternatively, copy the example file manually and edit:
```bash
cp .env.example .env
nano .env
```

---

## ðŸ©º System Verification

Verify that your system, storage, and AI providers are properly connected:

```bash
saori doctor
```

Example output:
```text
============================================================
  ðŸ©º  SAORI DIAGNOSTIC DOCTOR
============================================================
  [âœ“] Python Version: 3.12.3 (Requires >= 3.10)
  [âœ“] SQLite WAL Engine: Available
  [âœ“] State Storage: ~/.local/state/saori (Writable)

  AI Provider Connectivity & Discovery:
    â€¢ OLLAMA     : âœ“ CONNECTED (18 ms)
    â€¢ ANTHROPIC  : âœ“ CONNECTED (340 ms)
    â€¢ OPENAI     : âšª NOT CONFIGURED (No key/endpoint)
    â€¢ GEMINI     : âšª NOT CONFIGURED (No key/endpoint)
------------------------------------------------------------
  ðŸŽ‰ System is healthy and ready for autonomous SRE operations!
============================================================
```

---

## ðŸ’¬ First Chat Interaction

Test interactive conversational SRE:

```bash
saori chat
```

---

## ðŸ”­ Launching the Neural Observatory

To launch the real-time telemetry and flight recorder dashboard:

```bash
saori observatory --host 127.0.0.1 --port 8089
```

Open `http://127.0.0.1:8089` in your browser to view:
- Live Agent Swarm Health & Resource Consumption.
- Flight Recorder Black-Box Traces & Causal Replay.
- Stratified Event Log with Secret Sanitization.

---

## ðŸ�³ Docker Deployment

You can run SAORI in a self-contained container using Docker Compose:

```bash
cp .env.example .env
# Edit .env with your credentials
docker compose up -d --build
```
