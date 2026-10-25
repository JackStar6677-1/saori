# 🔒 Security Policy & Zero-Leak Architecture

## Reporting Security Vulnerabilities

If you discover a security vulnerability, private data exposure, or potential credential leak within SAORI, **do not open a public issue**. 

Please report vulnerabilities privately via email to:
**security@jackstar.dev** or through GitHub Security Advisories.

Reports are evaluated and acknowledged within 48 hours.

---

## 🛡️ Zero-Leak Core Principles

SAORI is built on sovereign clean-room software engineering standards:

1. **Zero Secret Persistence:**
   API keys, auth cookies, database passwords, and Bearer tokens are dynamically loaded from environment variables (`.env`). They are strictly excluded from git tracking, logs, and public interfaces.
2. **Structural Sanitization:**
   The `ObservatoryEventBus` automatically strips sensitive keys before writing events or telemetry to disk.
3. **Domain Isolation:**
   Internal production databases and physical host nodes remain isolated from public interaction gateways (Discord/WhatsApp).
4. **Boundary of Powers (Límite 6):**
   Destructive actions, database wipes, master credential rotation, and production deploys strictly require explicit human confirmation.
