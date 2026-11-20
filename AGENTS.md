# Engineering Standards for AI Agents & Automated Contributors (AGENTS.md)

This document establishes the binding engineering guidelines for any **Autonomous Agent**, **LLM-assisted developer**, or **Automated CI/CD Workflow** submitting issues, pull requests, or code reviews to the **S.A.O.R.I.** repository.

---

## 🧭 Core Principles

1. **Human Ownership & Accountability**:
   Automated agents and AI models do not hold legal or technical accountability. The human author whose credentials push the code or open the PR assumes **full responsibility** for the correctness, performance, security, and maintenance of the changes.

2. **Transparent Disclosure**:
   In accordance with open source best practices, contributors must explicitly disclose the involvement of AI agents or LLMs in the PR description:
   ```markdown
   ### 🤖 AI Assistance Disclosure
   - Tools used: [e.g., Claude Code, Cursor, Copilot, Custom Agent]
   - Human verification: Fully reviewed, locally compiled, and all unit tests passed.
   ```

3. **Zero AI Slop & Anti-Hallucination Policy**:
   PRs containing any of the following will be **immediately closed without review, marked as spam, and may result in a contributor block**:
   * Hallucinated Python packages, fake SDK methods, or fabricated Discord/WhatsApp API schemas.
   * "Plumbing without water": empty boilerplate files, dummy implementations, or unneeded scaffolding.
   * Unrequested refactoring of working SRE/orchestration code without functional or performance justification.
   * Broken imports, syntax errors, or unhandled exceptions.
   * Circular, repetitive LLM apologies in issue or review threads.

---

## 🧪 Verification & Evidence Requirement

Every PR submitted to SAORI with AI assistance **must include verifiable evidence of local execution**:

* **Python Runtime & Linting**:
  - Code must pass `ruff check .` or `flake8` cleanly without syntax or import errors.
  - Formatted cleanly with `black .` or standard PEP8.
* **Concurrency & Safety**:
  - SQLite database access must strictly respect WAL mode and existing connection pooling/locks.
  - Asynchronous functions (`async def`) must not perform blocking synchronous I/O.
* **Deterministic Reproduction**:
  - Bug fixes must include reproduction steps or unit test asserting the fix.

---

## 🚫 Forbidden AI Behaviors

* **Unsolicited Mass PRs**: Automated bots opening batch PRs without maintainer pre-approval.
* **Credential or Token Leakage**: Never commit simulated or real API tokens, session cookies, or phone numbers.
* **Review Spam**: Posting automated LLM code reviews on PRs unless specifically invited by the repository maintainers.

---

## 🏛️ Code of Conduct Compliance

All interactions generated or facilitated by AI tools must strictly adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Hostile, entitled, or automated spam responses will lead to immediate repository-level and organization-level blocking.
