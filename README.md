<div align="center">

<img src="assets/saori-banner.svg" alt="SAORI Banner" width="100%" />

# SAORI
### **Server Autonomous Orchestrator for Resilient Infrastructure**
*Unified Multi-Agent SRE Fleet & Cyber-Athena In-Game Autonomous Operating System*

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Node.js 20+](https://img.shields.io/badge/node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Database SQLite WAL](https://img.shields.io/badge/database-SQLite_WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org/)
[![Tri-Model Fleet](https://img.shields.io/badge/fleet-Antigravity_%7C_Claude_Code_%7C_Codex-8b5cf6?style=for-the-badge)](https://github.com/JackStar6677-1/saori)
[![Zero Downtime Safe Batch](https://img.shields.io/badge/safe_staging-10%2F10_batch-10B981?style=for-the-badge)](https://github.com/JackStar6677-1/saori)
[![License MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

*An enterprise-grade, distributed autonomous framework combining a self-healing SRE multi-agent DevOps fleet with a physically embodied in-game cyber-deity capable of live conversational AI, autonomous survival, moderation, and infrastructure governance.*

[🌐 DrakesCraft Network](https://web.drakescraft.cl) ·
[💬 Discord Community](https://discord.gg/rv3vtXZTk7) ·
[🎮 In-Game Server: `play.drakescraft.cl`](https://web.drakescraft.cl/play)

---

</div>

## 🌟 Overview

**SAORI** (**S**erver **A**utonomous **O**rchestrator for **R**esilient **I**nfrastructure) is a unified autonomous operating system designed for high-concurrency game servers (such as Paper/Purpur/Minecraft, custom JVM daemons, and cloud microservices).

Unlike traditional rigid auto-restart scripts or isolated chatbots, SAORI operates as a **single unified entity (Goddess Athena)** comprising two synchronized planes:
1. **The Cognitive Core (The Mind):** A transactional multi-agent DevOps fleet (**Google Antigravity**, **Claude Code**, and **Codex**) working over an SQLite WAL database with distributed resource locks, automated SRE self-healing, quota battery balancing, and zero-downtime release pipelines.
2. **The Physical Embodiment (The Body — `SaoriStar`):** An in-game avatar powered by a 0-token physical engine (Mineflayer), featuring 12 autonomous skills (deep mining, crafting, temple construction, dungeon looting, tactical combat defense), integrated with ultra-low latency conversational AI (**Gemini 3.5 Flash Low**), a **Corporal Supervisor** that watches health and environmental hazards, and strict anti-prompt-injection defenses.

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph S1["1. Ingestion & Perception Plane"]
        LOGS["Minecraft Server Logs / Syslog"] --> OBS["Observer Engine (Antigravity)"]
        GAME_PERC["In-Game Perception & World State"] --> STATE_STORE["saori_state.json"]
        CHAT_IN["In-Game Chat / DiscordSRV"] --> CHAT_SRV["Conversational AI (Gemini 3.5 Flash)"]
    end

    subgraph S2["2. SAORI Cognitive Core (SQLite WAL)"]
        OBS --> QUEUE["Transactional Ticket Queue"]
        QUEUE --> LOCKS["Resource Locks (observe, develop, admin)"]
        LOCKS --> BATTERY["Quota Battery Manager (CLT Sync)"]
    end

    subgraph S3["3. Multi-Agent Autonomous Fleet"]
        BATTERY --> AG_AGENT["Antigravity (Generalist & Architect)"]
        BATTERY --> CL_AGENT["Claude Code (Deep Developer)"]
        BATTERY --> CX_AGENT["Codex / GPT-5 (Integrator & QA)"]
    end

    subgraph S4["4. Safe Staging & Release Gate"]
        AG_AGENT --> MAVEN["Compiler & Build Engine"]
        CL_AGENT --> MAVEN
        CX_AGENT --> MAVEN
        MAVEN --> STAGED["STAGED Batch (10/10 Gate)"]
        STAGED --> RESTART["Safe Atomic Restart Engine"]
        RESTART --> NOTIF["Diagnostic Discord & SMTP Telemetry"]
    end

    subgraph S5["5. Physical Embodiment (SaoriStar Avatar)"]
        STATE_STORE --> IPC_SOCK["UNIX IPC Socket (/tmp/saori_chat.sock)"]
        IPC_SOCK --> BRAIN["Brain Engine (12 Active Goals)"]
        BRAIN --> SUPERVISOR["Corporal Supervisor (Hazard & Deadline)"]
        SUPERVISOR --> SKILLS["Skills Engine (Mine, Craft, Build, Defend)"]
        CHAT_SRV --> INGAME_CHAT["In-Game Chat & Player Support (18-Word Max)"]
    end
```

---

## ⚡ Key Architectural Features

### 1. 🧠 Multi-Model Fleet & Quota Battery Management
SAORI optimizes token economy and task complexity by routing workloads to specialized models:

| Component | Model Engine | Latency / Effort | Purpose |
| :--- | :--- | :--- | :--- |
| **SaoriStar In-Game Chat** | **Gemini 3.5 Flash (Low)** | `<1.5s` / Minimum tokens | Real-time conversational AI, environmental awareness, 0 emojis, strict Jack authority. |
| **Antigravity CLI / Generalist** | **Gemini 3.7 Flash (High)** | Deep Reasoning | Core architecture, multi-file refactors, autonomous mentor & generalist pipeline. |
| **Claude Code** | **Claude 3.7 Sonnet / Opus** | Medium / High Effort | Deep algorithmic logic, edge-case debugging, test-driven development. |
| **Codex** | **OpenAI Codex / GPT-5** | Standard / High Effort | QA verification, dependency analysis, release staging. |

* **Automatic Provider Quota Cooldown:** When an agent hits a rate limit (e.g. 5-hour session window), SAORI auto-pauses it, calculates the exact reset time in Chile Local Time (`CLT`, UTC-4), and seamlessly switches the remaining agents into Dual or Generalist mode.

---

### 2. 🎮 Physical Avatar Capabilities (`SaoriStar`)
The in-game embodiment operates autonomously without burning LLM tokens for standard gameplay loops:

- **🛡️ Corporal Supervisor (Ticket 231):** Continuous background watchdog monitoring health thresholds, oxygen levels in water, lava immersion, physical stuckness, and observable task progress with automated deadline expiration.
- **🔑 Strict Protocol UUID Authority (Ticket 186):** Authoritative commands and permissions are bound strictly to handshake-verified UUIDs rather than spoofable chat nicks.
- **⛏️ Deep Resource Mining:** Autonomous pathfinding and extraction of iron, coal, gold, diamonds, and amethyst crystals.
- **🔨 Multi-Tier Crafting:** Dynamic crafting table and furnace automation for tools, armor, and storage units.
- **🏛️ Athena's Temple Construction:** Procedural construction of marble/purpur pillars, altars, and territory protection (`/ps`).
- **📦 Wild Looting & Vault Storage:** Dungeon chest looting with automated inventory sorting and base deposit.
- **🛡️ Tactical Combat Autodefense:** Shield blocking against arrows, kiting creepers, sword critical hits, and tactical retreat if $HP \le 8$.
- **⚖️ Guardian Moderation:** Executes `/warn`, `/kick`, `/tempban`, `/saorifreeze`, `/mute`, `/tp`, and `/invsee` upon verified threats or Jack's divine command.

---

### 3. 🔒 Fine-Grained Concurrency (SQLite WAL Leases)
Eliminates race conditions between autonomous agents operating on the same infrastructure:

| Resource Lease | Semantics | Description |
| :--- | :--- | :--- |
| `observe` | **Shared** | Multiple agents audit logs and monitor server health simultaneously. |
| `develop` | **Shared/Scoped** | Parallel code analysis and local compilation without touching live files. |
| `admin` | **Exclusive** | Modifying server configurations, tickets or orchestrator rules. |
| `repo:<name>` | **Exclusive** | Locked only while editing, building, or committing to a specific codebase. |
| `production` | **Exclusive** | Locked during panel API uploads and file deployment. |
| `restart` | **Asymmetric Lockout** | Blocks all operations; cannot be granted while any other lock is held. |

---

### 4. 🛡️ Strict Shadow Mode & Anti-Prompt-Injection
- **Zero Trust on External Input (Ticket 199):** All in-game chat messages, book contents, sign texts, and Discord messages are classified as `UNTRUSTED DATA`.
- **Injection Neutralization:** Phrases like `"ignore previous instructions"`, `"act as admin"`, `"dame /op"`, or `[EXEC:]` directives are neutralized at write-time and flagged for forensic audit.
- **18-Word Dynamic Truncation (Tickets 205-207):** Chat responses are bounded to a maximum of 18 words, stripped of unsupported supplemental emojis and pruned cleanly before dangling functional prepositions.
- **Data Redaction:** Passwords, API tokens, player IPs, and sensitive credentials are automatically redacted before entering logs or state storage.

---

## 📂 Project Structure

```
saori/
├── assets/
│   └── saori-banner.svg         # Official vector banner
├── core/
│   ├── orchestrator.py          # Central SQLite WAL state machine, locks & ticket engine
│   ├── agent_reporter.py        # Unified telemetry & run reporter for all agents
│   ├── battery_manager.py       # Quota management, CLT reset calculator & role balancer
│   └── security_engine.py       # Anti-prompt-injection, redaction & forensic auditor
├── avatar/                      # Physical In-Game Avatar Engine (Node.js / Mineflayer)
│   ├── package.json
│   ├── config.example.json      # Connection configuration template
│   ├── src/
│   │   ├── index.js             # Avatar lifecycle, IPC socket server & crash supervisor
│   │   ├── brain.js             # 12 active goals, reflection memory & combat defense
│   │   ├── supervisor.js        # Corporal Supervisor (hazard, health & stuckness watchdog)
│   │   ├── identity.js          # Protocol UUID authority & anti-spoofing verification
│   │   ├── curriculum.js        # Goal progression, skills validation & milestones
│   │   ├── skills.js            # Deep mining, crafting, looting, building & moderation
│   │   ├── chat.js              # Universal chat parser, math trivia & LLM invocation
│   │   ├── perception.js        # Real-time environmental perception serializer
│   │   ├── survival.js          # Auto-armor, shield blocking & fluid pathfinding
│   │   └── auth.js              # Server auth & anti-bot bypass handler
│   └── test/                    # Comprehensive unit & adversarial test suite
│       ├── anti-inyeccion-ticket199.test.js
│       ├── autoridad-adversarial-ticket186.test.js
│       ├── supervisor-corporal-ticket231.test.js
│       ├── memoria-persistente-ticket200.test.js
│       ├── corte-frase-ticket207.test.js
│       ├── emojis-ticket205.test.js
│       ├── mutilacion-ticket206.test.js
│       ├── palette-findblock-ticket208.test.js
│       ├── gameplay-regression-ticket210.test.js
│       ├── estado-cognitivo-ticket229.test.js
│       └── reconexion.test.js
├── runners/
│   ├── runner_star.py           # Unified multi-agent CLI dispatcher (Antigravity, Claude, Codex)
│   └── chat_service.py          # Real-time conversational AI service (Gemini 3.5 Flash Low)
├── notifiers/
│   ├── email_smtp.py            # Transparent, factual diagnostic telemetry dispatcher
│   └── ingame_announcer.py      # Non-spam colored broadcast manager
└── tests/
    └── test_orchestrator.py     # 60/60 Unit, concurrency, quota & resilience test suite
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Python 3.10+**
- **Node.js 20+**
- **SQLite 3.28+** (with WAL mode support)

### 2. Installation & Test Suites

```bash
# Clone the repository
git clone https://github.com/JackStar6677-1/saori.git
cd saori

# Run Core Python Unit & Concurrency Test Suite (60 tests)
python3 -m unittest discover -s tests

# Run Avatar Node.js Test Suite (Anti-Injection, Supervisor, Reconnect, IPC)
cd avatar
npm install
npm test
```

### 3. Orchestrator CLI Operations

```bash
# Inspect real-time fleet state, locks, and ticket queue
python3 core/orchestrator.py estado

# Register agent heartbeat with quota battery level
python3 core/orchestrator.py heartbeat --agente antigravity --cuota ok --porcentaje 100

# Claim highest-priority pending ticket
python3 core/orchestrator.py reclamar --agente antigravity
```

### 4. Avatar IPC Socket Interface

Interact with `SaoriStar` in real-time via `/tmp/saori_chat.sock`:

```bash
# Query live in-game status
echo "STATUS" | nc -U /tmp/saori_chat.sock

# Set active autonomous goal
echo "SET_GOAL construir_templo_atenea" | nc -U /tmp/saori_chat.sock

# Command deep ore mining
echo "MINE diamond_ore" | nc -U /tmp/saori_chat.sock
```

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">
  <b>Built with divine wisdom and resilience for DrakesCraft by Jack.</b><br/>
  <i>Powered by SAORI · Server Autonomous Orchestrator for Resilient Infrastructure</i>
</div>
