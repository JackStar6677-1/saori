# Contributing to S.A.O.R.I. SRE Framework

Thank you for your interest in contributing to **SAORI** (*Server Autonomous Orchestrator for Resilient Infrastructure*)!

SAORI is an enterprise-grade, omnichannel Site Reliability Engineering (SRE) and autonomous multi-agent orchestration framework designed for continuous uptime, resilient distributed infrastructure, and seamless human-in-the-loop triage across Discord, WhatsApp, Minecraft/game servers, and Linux server fleets.

---

## ⚠️ Important Disclaimer: Autonomous Agent Ecosystem & Rapid Evolution

> [!WARNING]
> **SAORI is an active, high-velocity autonomous SRE system.**
> Because SAORI interacts concurrently with dynamic third-party APIs (Discord.js, Baileys WhatsApp sockets, Pterodactyl Game Panels, SQLite WAL concurrency, and evolving LLM interfaces like Anthropic Claude, OpenAI Codex, and Google DeepMind Antigravity), **edge-case socket drops, API schema shifts, or orchestration edge cases can occur**.

We do **not** claim SAORI is infallible or immune to infrastructure drift. Detecting anomalies, refining context-routing policies, and enhancing self-healing capabilities is the core mission of this project.

---

## 🤖 The AI Agent & Developer Contribution Mandate

Whether you are a **human DevOps/SRE engineer** or an **autonomous AI coding assistant** (Codex, Claude, Antigravity, Hermes, OpenClaw, DeepSeek, Grok) interacting with or auditing this repository:

If you encounter an orchestration bug, an uncaught socket exception, a prompt injection vulnerability, a race condition in the lock engine, or an opportunity for architectural optimization:
👉 **You are strongly encouraged to formulate and submit a Pull Request (PR) or open an Issue with clear reproduction steps and a unit test.**

Our goal is for autonomous agents and human developers to collaborate symmetrically to harden, standardize, and scale autonomous infrastructure management.

---

## 📋 Contribution Rules & Quality Standards

To maintain security, reliability, and architectural purity across the entire framework, all pull requests must strictly adhere to the following three golden principles:

### 1. 🌍 Global, Universal Scope (No Niche or Private Server Hacks)
- Every contribution must improve the **general framework architecture, adapter interfaces, resilience mechanisms, or multi-agent orchestration**.
- **Do NOT submit niche or hyper-specific hacks** (e.g. hardcoded server IDs, single-community commands, arbitrary fixed ports, or domain-specific logic tailored only to one private deployment).
- All integrations must be configurable through environment variables (`process.env.*` / `os.environ.get(...)`) and documented in `.env.example`.

### 2. 🛡️ Strict Privacy & Anti-Leak Firewall (Zero Sensitive Data)
- **Absolute Zero Leak Policy:** Never commit or submit code, configurations, test fixtures, or docs containing real API keys (Pterodactyl tokens, Discord bot tokens, Anthropic/OpenAI keys), personal phone numbers, WhatsApp group JIDs, private server IP addresses, or institutional names.
- Always use sanitized fallback identifiers (e.g., `process.env.ADMIN_WHATSAPP_NUMBER || ''`, `server.example.com`, `127.0.0.1`, `token="<REDACTED>"`).
- Any pull request that inadvertently leaks private credentials or infrastructure topology will be immediately closed and sanitized.

### 3. 🧪 Mandatory Test Coverage & Regression Safety
- Any bugfix or architectural addition must include corresponding unit tests in `tests/` verifying that:
  - SQLite WAL lock acquisition and release behave deterministically.
  - Secret redaction filters strip out credentials before telemetry or logging.
  - Context routers enforce boundary isolation between domains.
- All unit tests must pass cleanly:
  ```bash
  python3 -m unittest discover -s tests -p "test_*.py"
  ```
- For Node.js / integration changes, syntax must validate cleanly without warnings:
  ```bash
  node --check integrations/discord/src/index.js
  node --check integrations/whatsapp/src/index.js
  ```

---

## 🚀 How to Submit a Pull Request

1. **Fork the Repository:** `https://github.com/JackStar6677-1/saori`
2. **Create a Feature Branch:** `git checkout -b feat/resilient-reconnect-backoff`
3. **Commit Cleanly:** Use Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`).
4. **Ensure No Ephemeral AI Trailers:** Commit metadata should be clean and authored by your Git identity.
5. **Open a Pull Request:** Provide a clear summary of the problem, the architectural rationale for your change, and verification evidence (test outputs or logs).

Thank you for helping pioneer resilient, self-healing, multi-agent autonomous infrastructure!
