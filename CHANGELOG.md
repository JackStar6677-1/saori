# 📝 CHANGELOG — SAORI Framework

All notable changes to the SAORI open-source framework will be documented in this file.
This project adheres to [Semantic Versioning](https://semver.org/).

---

## [2.0.0-kokoro] - 2026-10-25

### 🌸 Major Architectural Unification: Kokoro Kernel & Neural Observatory

#### 🧠 Kokoro Central Cognitive Kernel
- **Canonical Identity (`kokoro/identity.py`):** Unified identity contracts, 6 invariant rules, and sub-1.2KB token-compressed prompt injection.
- **Autonomy Matrix A0–A4 (`kokoro/governance.py`):** Formal permission boundaries distinguishing read-only analysis (A0), routine recovery (A1), reversible improvements (A2), supervised production actions (A3 / Límite 6), and critical containment (A4).
- **Persistent Episodic Memory (`kokoro/autobiography.py`):** Automatic local SQLite WAL database initialization (`~/.local/state/saori/memory.db`) with fallback synchronization to external MCP/REST services.

#### 🌐 Universal Multi-Provider AI Adapters (`kokoro/adapters/`)
- Native adapters for:
  - **Local Ollama:** 100% private, zero-token-cost local LLMs with dynamic model discovery.
  - **Anthropic Claude:** Direct REST integration with Sonnet 3.5, Haiku 3.5, and Opus 3.
  - **OpenAI:** Direct integration with GPT-4o, GPT-4o-mini, and o3-mini.
  - **Google Gemini:** Integration with Gemini 2.0 Flash and 1.5 Pro via REST.
  - **OpenAI-Compatible:** Universal support for vLLM, DeepSeek, LocalAI, OpenCode, and Groq.
- **Circuit Breakers & Dynamic Fallback:** Automatic failover chain preventing thread starvation on rate limits or API outages.

#### 🔭 Neural Observatory & Black Box Flight Recorder (`kokoro/observatory/`)
- **Deterministic Flight Recorder:** Causal tracing (`TRIGGER`, `CONTEXT`, `MODEL`, `TOOL`, `RESULT`) and instant Markdown post-mortem generation (`saori flight --replay <id>`).
- **Stratified Event Retention:** Tiered TTL and count ceilings (telemetry 24h/1k, operations 7d/3k, decisions 30d/10k, incidents 90d/10k) with strict 30 MB disk storage cap.
- **Live SRE Web Dashboard:** PWA dark UI monitoring agent process PIDs, CPU ticks, memory RSS, and recent flight spans.
- **Secret Sanitization:** Automatic regex and structural dictionary redaction of tokens and keys.

#### 🧬 Protocol ANOMALY (AST-0001) Cognitive Self-Learning (`kokoro/anomaly/`)
- **Dynamic Self-Model:** Introspective health score calculation (0–100) reflecting agent liveness and open frictions.
- **Scientific Hypothesis Engine:** Formal conjecture formulation with explicit falsification criteria.
- **Simulation Lab:** Ephemeral sandboxed experiments with automatic post-run cleanup.
- **Meta-Learning:** Baseline vs. Challenger comparison requiring $\ge 15\%$ gain and zero invariant breaches before promoting learnings.

#### 💻 Unified CLI & Packaging
- New `saori` command line tool with `status`, `doctor`, `init`, `chat`, `observatory`, `flight`, and `anomaly` subcommands.
- Standard Python packaging (`setup.py`, `pyproject.toml`) and 1-minute automated installer (`install.sh`).
- Zero private credentials, zero hardcoded IPs, and clean `.env.example` template.
