# 🌸 SAORI — Discord Integration Engine & SRE Bot

Motor de integración oficial de **SAORI** para Discord. Proporciona asistencia de IA autónoma, soporte inteligente mediante formularios obligatorios (*Discord Modals*), moderación preventiva, auditoría en tiempo real, auto-roles y estadísticas sincronizadas de Minecraft.

---

## 🚀 Características Principales

- **🧠 Inteligencia Autónoma y Chat Multimodal:** Integración con el núcleo de SAORI para respuestas inteligentes, síntesis de voz (TTS), reconocimiento de audio (STT) y generación de imágenes.
- **🎫 Sistema de Tickets con Modals Obligatorios:** Formularios emergentes estructurados (*Bugs, Pérdida de Ítems, Compras, Dudas, Postulación y Denuncias Confidenciales*) para evitar mensajes fragmentados.
- **🛡️ Escudo Anti-Ataques y Seguridad:**
  - *Anti-Flood & Rate Limiting:* Control de flujo por usuario para mensajes, botones e interacciones.
  - *Anti-Phishing & Malicious Links:* Detección y eliminación automática de enlaces fraudulentos o IP loggers.
  - *Anti-Mass Mentions (Anti-Raid):* Bloqueo inmediato de intentos de mención masiva.
  - *Input Sanitization:* Sanitización de caracteres nulos y prevención de inyecciones en prompts.
- **✨ Normalización de Apodos (Small Caps) & Auto-Sufijos de Staff:**
  - Conversión automática de apodos a la tipografía canónica (*Small Caps*).
  - Normalización de fuentes Unicode góticas/distorsionadas.
  - Asignación dinámica de sufijos de Staff (`- ᴀᴅᴍɪɴ`, `- ᴍᴏᴅ`, `- ʙᴜɪʟᴅᴇʀ`, etc.) según los roles del usuario.
- **📊 Estadísticas en Vivo (Discord + Minecraft):**
  - Conteo de miembros y usuarios reales.
  - Ping en tiempo real a servidores de Minecraft para mostrar jugadores conectados.
- **🎭 Auto-Roles Inteligentes:**
  - Asignación y remoción de roles por reacción (Plataformas, Modalidades, Notificaciones, Género y Países).

---

## 🛠️ Requisitos Previos

- Node.js >= 18.0.0
- Docker y Docker Compose (opcional para despliegue en contenedores)
- Un bot de Discord configurado en el [Discord Developer Portal](https://discord.com/developers/applications) con los siguientes **Privileged Gateway Intents**:
  - `Server Members Intent`
  - `Message Content Intent`

---

## ⚙️ Instalación y Puesta en Marcha

### 1. Clonar el repositorio y configurar variables:
```bash
cp .env.example .env
```
Edita `.env` y completa tus credenciales y los IDs de canales de tu servidor.

### 2. Instalación local:
```bash
npm install
npm start
```

### 3. Despliegue con Docker Compose:
```bash
docker compose up -d --build
```

---

## 🔒 Variables de Entorno (.env)

| Variable | Descripción |
| :--- | :--- |
| `DISCORD_BOT_TOKEN` | Token secreto del bot de Discord. |
| `GUILD_ID` | ID del servidor de Discord. |
| `OWNER_DISCORD_ID` | ID del dueño / administrador principal. |
| `AI_DAEMON_URL` | URL del endpoint de IA de SAORI (`http://127.0.0.1:8089/chat`). |
| `CHANNEL_*` | IDs de los canales de texto, voz, auditoría y tickets del servidor. |
| `STATS_*` | IDs de los canales donde se muestran las estadísticas en tiempo real. |

---

## 📄 Licencia

Desarrollado para el ecosistema de **DrakesCraft Network**. Todos los derechos reservados.
