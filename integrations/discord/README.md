# 🐺 S.A.O.R.I. Discord SRE & Community Bot

> **Server Autonomous Operations & Reliability Intelligence**  
> Componente oficial de Discord para la red **DrakesCraft Network** y el servidor comunitario **NEXO**.

![License: Private](https://img.shields.io/badge/License-Private-red.svg)
![Node: >=22.0.0](https://img.shields.io/badge/Node.js-v22-green.svg)
![Discord.js: v14.17.3](https://img.shields.io/badge/discord.js-v14.17.3-blue.svg)
![API REST: :8095](https://img.shields.io/badge/REST_API-Port_8095-purple.svg)
![Architecture: Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)

---

## 📖 Descripción General

**SAORI Discord** es el núcleo de automatización, orquestación y atención interactiva de la red DrakesCraft. Construido sobre `discord.js v14` y Node.js 22, integra telemetría de servidores en tiempo real, gestión de tickets guiada por modales dinámicos, puente de administración con Minecraft (Pterodactyl API), moderación jerárquica, generación multimedia con IA y una API REST protegida para comunicación bidireccional con el clúster central (Star / Nexus).

---

## 🏛️ Arquitectura del Sistema

```
                  ┌──────────────────────────────────────────────┐
                  │          DISCORD CLIENTS & USERS             │
                  └──────────────────────┬───────────────────────┘
                                         │ Gateway (v10) / WebSockets
                                         ▼
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                         SAORI DISCORD BOT (Node.js 22)                       │
   │                                                                              │
   │  ┌────────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
   │  │   Slash Commands (/)   │  │   Ticket Modals Hub   │  │   Audit Engine  │  │
   │  │   - 53 Comandos        │  │   - 6 Formularios     │  │   - Logs & Prevl │  │
   │  └────────────────────────┘  └───────────────────────┘  └─────────────────┘  │
   │  ┌────────────────────────┐  ┌───────────────────────┐  ┌─────────────────┐  │
   │  │   NEXO Legacy Guild    │  │   Voice & Streaming   │  │  Pterodactyl    │  │
   │  │   - Estado Aislado     │  │   - yt-dlp / opus     │  │  - Consola / Log│  │
   │  └────────────────────────┘  └───────────────────────┘  └─────────────────┘  │
   │                                                                              │
   │  ┌────────────────────────────────────────────────────────────────────────┐  │
   │  │              API REST INTERNA (:8095 / Bearer SHA-256)                 │  │
   │  │    /health · /api/status · /api/community · /api/irp/approval-request  │  │
   │  └────────────────────────────────────────────────────────────────────────┘  │
   └──────────┬───────────────────────────┬───────────────────────────────┬───────┘
              │ HTTP                      │ HTTP                          │ Pterodactyl API
              ▼                           ▼                               ▼
     ┌─────────────────┐         ┌─────────────────┐             ┌─────────────────┐
     │   AI Daemon     │         │ Mission Control │             │ Servidor Dallas │
     │  (Cerebro SRE)  │         │  (HUD / Nexus)  │             │  (Minecraft MC) │
     └─────────────────┘         └─────────────────┘             └─────────────────┘
```

---

## 🌟 Módulos y Funcionalidades Principales

### 1. 📋 Menú Hub & Comandos de Jugador

- **`/smenu` (o `!smenu`)**: Centro de control visual con Select Menus interactivos:
  - ⚡ *Slimefun & Guías:* Acceso directo a documentación de tecnología y aleaciones.
  - 🏝️ *Modalidades:* survival, OneBlock, SkyBlock, Clásico y PvP.
  - 🛡️ *Protecciones:* Guías de parcelas, menas de protección (`/ps`) y pala de oro.
  - 🛒 *Rangos y Tienda:* Catálogo de rangos Dioses del Olimpo y beneficios VIP.
  - 📜 *Normativas:* Reglas oficiales y sanciones.
- **`/sperfil` / `/smiperfil`**: Ficha de perfil de usuario con roles de plataforma (☕ Java / 📱 Bedrock), modalidades favoritas, rol más alto y antigüedad.
- **`/sstaff`**: Radar en vivo del equipo administrativo. Muestra presencia (🟢 En línea, 🟡 Ausente, 🔴 Ocupado, ⚪ Desconectado) clasificado por rangos (Dueños, Administradores, Desarrolladores, Moderadores, Builders, Helpers).
- **`/stps` / `/stats`**: Telemetría en vivo del host, memoria, procesador y directiva a `/tps` in-game.
- **`/sonline`**: Consulta en tiempo real a la API de Minecraft con lista de jugadores conectados.
- **`/sclaim` / `/svotar`**: Guías interactivas con embeds ilustrativos para reclamación de tierras y enlaces de votación diaria.
- **`/sredes`, `/sweb`, `/stienda`, `/sguia`, `/sreglas`**: Directorio de enlaces oficiales y reglamentos.
- **`/sreencarnar`**: Protocolo de seguridad para reencarnaciones de prestigio con confirmación de 2 pasos.

---

### 2. 🎫 Sistema de Tickets con Modales Dinámicos

Los tickets se gestionan desde el canal oficial mediante botones interactivos que despliegan ventanas modales nativas de Discord (`ModalBuilder`):

| ID Modal | Título del Formulario | Campos Solicitados | Destino & Permisos |
|---|---|---|---|
| `modal_ticket_perdida` | 📦 Pérdida de Ítems / Rollback | Nick MC, Modalidad, Ítems perdidos, Circunstancia, Pruebas | Staff + Triaje Trinidad SRE |
| `modal_ticket_bug` | 🐛 Reporte de Bug o Error | Nick MC, Modalidad, Resumen, Detalle paso a paso, Pruebas | Staff + Triaje Trinidad SRE |
| `modal_ticket_tienda` | 🛒 Soporte Tienda Tebex | Nick MC, Correo compra, ID Transacción, Paquete, Detalle | Staff + Notificación Directa |
| `modal_ticket_dudas` | ❓ Asistencia General | Nick, Modalidad/Tema, Explicación de la duda | Staff + Asistencia AI |
| `modal_ticket_postulacion`| 🛡️ Postulación a Staff | Edad/País, Nick/Tiempo, Rango, Experiencia, Motivación | Staff Directivo |
| `modal_ticket_denuncia` | ⚖️ Denuncia Confidencial | Nick propio, Acusado, Infracción, Relato, Pruebas | **Estricto:** Solo Jack y Admins |

#### Ciclo de Vida del Ticket:
1. El usuario completa el formulario y se genera un canal privado bajo la categoría oficial.
2. El bot asigna permisos de lectura/escritura únicamente al creador y al equipo autorizado.
3. Se despacha el ticket a la **Trinidad SRE** en Star si es de carácter técnico.
4. **SAORI** emite un saludo contextual inteligente personalizado según la solicitud.
5. Botón de cierre `btn_close_ticket` con diálogo de confirmación de 2 pasos y registro completo en el canal de auditoría.

---

### 3. 🛡️ Suite de Moderación & Jerarquía de Staff

El sistema implementa una jerarquía numérica inmutable para evitar abusos y escalada de privilegios:

```
[0] USER  ──▶  [20] HELPER  ──▶  [30] BUILDER  ──▶  [50] MOD  ──▶  [70] DEV  ──▶  [80] ADMIN  ──▶  [100] OWNER
```

#### Comandos de Moderación en Discord:
- `/swarn <usuario> <motivo>`: Advertencia formal por DM y registro en log.
- `/smute <usuario> <minutos> [motivo]`: Silenciamiento nativo (Timeout) de 1 a 40,320 minutos.
- `/skick <usuario> [motivo]`: Expulsión del servidor con notificación previa al usuario.
- `/sban <usuario> [motivo]`: Baneo definitivo (requiere nivel `ADMIN` o superior).
- `/sclear <cantidad>`: Purga por lotes de hasta 100 mensajes con registro en auditoría.
- `/slowmode <segundos>`: Control del enfriamiento del canal actual.
- `schan <rename|topic|slowmode|lock|unlock>`: Gestión rápida de canales sin abrir ajustes de Discord.
- `/shelpstaff`: Manual interactivo paginado para miembros del equipo.

#### Puente de Moderación hacia Minecraft (Pterodactyl API):
- `smckick <jugador> [motivo]`: Expulsar usuario in-game vía consola.
- `smcmute <jugador> [tiempo] [motivo]`: Silenciar usuario en el chat de Minecraft.
- `smcwarn <jugador> <motivo>`: Notificación de advertencia in-game y pantalla.
- `smcmsg <jugador> <mensaje>`: Mensaje privado oficial del Staff al jugador.
- `smcbroadcast <mensaje>`: Anuncio global a toda la red.
- `smcwhitelist <add|remove|list> [jugador]`: Gestión de lista blanca.
- `smcsave`: Ejecución inmediata de guardado forzado (`save-all`).
- `smcban <jugador> [motivo]`: Baneo in-game (exclusivo Administradores).
- `/smc <comando>`: Despacho arbitrario a consola (exclusivo Jack / Administradores).

---

### 4. 📜 Visor de Logs de Minecraft en Vivo

- **Paginación Interactiva:** Consulta en directo de `latest.log` de la consola de Minecraft a través de la API de Pterodactyl.
- **Controles con Botones:** `⏮️ Primero`, `◀️ Anterior`, `▶️ Siguiente`, `🔄 Refrescar`.
- **Filtro de Búsqueda:** Búsqueda textual insensible a mayúsculas sobre los registros recientes.
- **Auditoría de Seguridad de Chats Privados:** Motor de supervisión forense para detectar patrones sospechosos en `/msg`, `/r`, `/whisper` y `/jack` respetando normativas de privacidad.

---

### 5. 🌐 API REST Interna (Puerto 8095)

SAORI Discord expone un servidor HTTP de baja latencia protegido para integración con paneles y agentes:

#### Políticas de Seguridad:
- **Autenticación Bearer:** Verificación de token en tiempo constante mediante digest SHA-256 (`crypto.timingSafeEqual`).
- **Firewall CIDR:** Filtrado estricto por IP de origen (Tailscale `100.64.0.0/10`, Docker `172.16.0.0/12`, redes privadas y localhost).
- **Límites de Tráfico:** Rate-limiting independiente para lecturas (120 req/min) y escrituras (30 req/min).
- **Protección de Body:** Límite de carga útil de 64 KB por solicitud para evitar ataques DoS de memoria.

#### Catálogo de Endpoints:

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/health` / `/` | No | Sonda de vida para orquestadores y monitoreo |
| `GET` | `/api/status` | Bearer | Estado del bot, latencia WS, uptime, miembros y canales |
| `GET` | `/api/community/overview` | Bearer | Estadísticas globales de canales de texto, voz, boosts y roles |
| `GET` | `/api/guild/roles` | Bearer | Listado completo de roles con IDs, nombres, colores y miembros |
| `GET` | `/api/suggestions` | Bearer | Consulta de propuestas comunitarias y balance de votos |
| `GET` | `/api/channel/:id/messages` | Bearer | Extracción de los últimos mensajes para paneles de supervisión |
| `POST`| `/api/announce` | Bearer | Publicación de anuncios oficiales con mención automática de rol |
| `POST`| `/api/message` | Bearer | Envío programático de mensajes enriquecidos a un canal |
| `POST`| `/api/irp/approval-request` | Bearer | **1-Click Rollback:** Genera una solicitud interactiva en Discord con botones de Aprobación/Rechazo para Jack |

---

### 6. 🤖 Inteligencia Artificial, Voz y Multimedia

- **IA Conversacional en Servidor:** Al interactuar en `#habla-con-saori` o mencionar al bot, SAORI procesa las consultas contra el demonio cognitivo local (`AI_DAEMON_URL`).
- **Respuesta en el Chat de Minecraft:** Detecta llamadas al Staff o a SAORI emitidas desde el juego a través de DiscordSRV y responde de forma contextual y educada.
- **Generación de Imágenes (`!imagen <prompt>`):** Integración con generador local (límite de 3 imágenes por hora por usuario).
- **Sintetizador de Voz (`!voz`, `/voz`):** Conversión de texto a habla y reproducción por canal de voz.
- **Reproductor de Música:** Soporte para YouTube y Spotify utilizando DisTube con soporte de streaming local (`ffmpeg` + `yt-dlp`).

---

### 7. 🕒 Automatizaciones de Comunidad

- **Horario Laboral de Jack (CLT):** Si un usuario menciona a Jack durante su jornada de trabajo (Lunes a Jueves 07:55-17:30, Viernes 07:55-16:35 CLT), SAORI reacciona con `🕒` y responde amablemente explicando su disponibilidad y guiándolo a los tickets de soporte.
- **Auto-Notificaciones:** Mapeo automático de canales de anuncios a sus respectivos roles para que las publicaciones del Staff notifiquen a los miembros sin necesidad de recordar los pings.
- **Votación de Sugerencias:** Al usar `/ssugerencia`, se publica un embed formal, se añaden reacciones `👍`/`👎` y se genera un hilo de debate de 24 horas automáticamente.
- **Normalización Tipográfica:** Filtra caracteres unicode decorativos y formatea nicks en Small Caps para preservar la estética institucional de DrakesCraft.
---

### 8. 🤖 Roster Oficial de Bots de DrakesCraft

El servidor de Discord cuenta con un ecosistema multi-bot coordinado donde cada bot cumple un rol específico:

| Bot | Prefijo / Acceso | Propósito & Capacidades |
|---|---|---|
| **XENON** | `xenon.bot` | Copias de seguridad de canales, roles y plantillas de estructura del servidor. |
| **IDLE MINER** | `/help` | Minijuego interactivo de minería para miembros de la comunidad. |
| **CHIP** | `/play`, `/help` | Bot de música oficial de alta fidelidad con slash commands. |
| **DRAKESCRAFT ︱ SAORI** | `s[comando]`, `/`, mención | Bot oficial de orquestación SRE, tickets, Minecraft in-game, telemetría y soporte. |
| **JOCKIE MUSIC** | `m!play`, `m!help` | Bot de música principal para salas de voz (`m!play <canción>`). |
| **JOCKIE MUSIC (1)** | `m!play`, `m!help` | Instancia secundaria de Jockie Music para canales de voz concurrentes. |
| **MUDAE** | `$help`, `$marry`, `$search` | Minijuego gacha de personajes de anime, manga y videojuegos. |
| **WICK** | `wickbot.com` | Guardián de seguridad antiraid, protección de permisos y automoderación estricta. |

---

### 9. 🎵 Suite de Música & Streaming

SAORI cuenta con un reproductor propio integrado vía `@distube/ytdl-core` y `yt-dlp`:

- `splay <canción o enlace>`: Reproduce pistas o playlists de Spotify / YouTube en el canal de voz actual.
- `sskip`: Avanza a la siguiente pista en cola.
- `spause` / `sresume`: Pausa o reanuda la reproducción.
- `squeue`: Muestra la lista de reproducción activa.
- `sstop`: Detiene la reproducción y desconecta el bot.

> **💡 Bots Alternativos:** En caso de alta concurrencia o de preferir bots dedicados, los usuarios disponen de **Jockie Music** (`m!play <canción>`) y **Chip** (`/play <canción>`).

---

### 10. 🛡️ Protocolo de Reinicio Seguro (SRE) & RBAC

Para erradicar pérdidas de inventario (#348/#362) y corrupción de mundos:
- Los reinicios **NUNCA** se ejecutan por comandos directos en el chat ni por `/restart30` en consola.
- Si un usuario común pide un reinicio, SAORI le informa que las intervenciones son coordinadas por Jack y el Staff.
- Si un miembro del Staff Administrador solicita un reinicio, SAORI le proporciona el estado actual (TPS y jugadores online) y las instrucciones del comando atómico en consola:
  ```bash
  python3 scripts/reinicio_seguro.py <segundos> "<motivo>" <agente>
  ```
  *(Requiere preflight SAORI, guardado forzado atómico vía `save-all` e `irp forcebackup all`, y desconexión segura).*

---

## 🚀 Instalación y Despliegue

### Requisitos Previos
- Docker y Docker Compose (o Node.js 22+ con ffmpeg y yt-dlp instalados)
- Token de Bot de Discord con los Privileged Gateway Intents activados:
  - `Server Members Intent`
  - `Message Content Intent`
  - `Presence Intent`

### 1. Clonar el Repositorio
```bash
git clone git@github.com:JackStar6677-1/saori-discord.git
cd saori-discord
```

### 2. Configurar Variables de Entorno
Copia la plantilla y edita tus valores:
```bash
cp .env.example .env
nano .env
```

### 3. Ejecutar con Docker Compose
```bash
# Construir imagen y levantar contenedor en segundo plano
docker compose up -d --build

# Verificar logs de inicio
docker compose logs -f saori-discord
```

### 4. Ejecutar en Modo Desarrollo (Local)
```bash
npm install
npm start
```

---

## 🛠️ Scripts Administrativos (`src/scripts/`)

El repositorio incluye herramientas de mantenimiento para el ecosistema NEXO:

- `normalize-nexo-members.js`: Normalización masiva y reanudable de apodos con rate-limit controlado.
- `pin-nexo-rules.js`: Publicación y anclaje de normativas oficiales y guías temáticas por canal.
- `polish-nexo.js`: Configuración visual de canales, descripciones y diseño de interfaz.
- `provision-nexo-stats.js`: Aprovisionamiento de canales de voz con estadísticas automáticas en vivo.
- `provision-nexo-audit.js`: Creación y configuración del canal de auditoría privado.
- `rebuild-legacy-guild.js`: Script de reconstrucción y provisionamiento con bandera destructiva `--apply`.
- `add-nexo-wellbeing.js` / `finish-nexo-theme-menu.js`: Aprovisionamiento de categorías temáticas de bienestar y ciencia.

---

## 🔒 Seguridad y Privacidad

- **No Publicar Secretos:** Este repositorio es privado. Ninguna clave API, token de Discord o credencial de Pterodactyl debe comitearse. Usa siempre variables de entorno.
- **Truth Gate:** Todas las entradas de usuario que interactúen con la consola de Minecraft están filtradas mediante expresiones regulares estrictas (`/^[a-zA-Z0-9_]{3,16}$/`) para erradicar cualquier posibilidad de inyección de comandos.

---

## 👤 Autor y Licencia

- **Desarrollador Principal:** Jack (`JackStar6677-1`)
- **Organización:** DrakesCraft Labs & Comunidad NEXO
- **Licencia:** Software Privado y Propietario. Todos los derechos reservados.

---

## ⚙️ Variables de entorno opcionales (pass2 2026-09-16)

Todas tienen fallback al valor que estaba hardcodeado, así que el bot arranca igual si no se definen. Se leen desde `/opt/stacks/saori-unified/.env` (montado por `env_file`). Nunca se imprimen ni se comitean tokens.

| Variable | Uso | Fallback |
|---|---|---|
| `NEXO_GUILD_ID` | Guild NEXO (`legacyGuild.js`) | `699391897369575476` |
| `DISCORD_OWNER_ID` / `OWNER_DISCORD_ID` | ID de Jack (se aceptan ambos nombres) | `493868699489665044` |
| `KIKA_DISCORD_ID` | Co-owner con acceso total | `684457729003356180` |
| `CHANNEL_MOD_LOGS` | Canal `#🚨・mod-logs` | `1539637396856111165` |
| `ROLE_STAFF_ID`, `ROLE_OWNER_ID`, `ROLE_HIGH_STAFF_ID`, `ROLE_ADMIN_ID`, `ROLE_PERMISOS_PLUS_ID`, `ROLE_DEV_ID`, `ROLE_MOD_ID`, `ROLE_HELPER_ID` | Roles de staff (jerarquía RBAC, permisos de tickets, ping `@STAFF`) | IDs actuales de DrakesCraft |
| `TICKET_BLACKLIST_USER_IDS` | Usuarios vetados de tickets (coma-separado, Sección 4) | `1267922444329418853` |
| `NEXO_AI_CHANNEL_KEYS` | Claves de `legacy-guild-state.json` (`channels.*`) donde Nexo responde con IA | `help,generalEs,saori` |
| `NEXO_AI_USER_COOLDOWN_MS` | Espera mínima por usuario entre respuestas IA en Nexo | `15000` |
| `AI_FAQ_URL` | Endpoint determinista `/faq` del daemon | derivado de `AI_DAEMON_URL` |

### IA en NEXO (acotada)

En NEXO el bot sigue siendo determinista (hilos de ayuda/ideas, nicks, stats). Desde pass2 además responde con IA **solo** cuando lo mencionan (`@SAORI`) o escriben `saori` en los canales `help`, `generalEs` o `saori`. Reutiliza el daemon `8089/chat` con `scope: "nexo"`: canon de comunidad (no es el servidor de Minecraft), sin acciones de servidor ni tickets, y solo puede enlazar `mc.drakescraft.cl` y `https://web.drakescraft.cl`. Aplica el mismo filtro humano-a-humano (`isHumanToHumanMessage`), anti-spam y un cooldown por usuario.

### Respuestas deterministas de guía

Antes de gastar IA, las preguntas cortas (≤ 12 palabras, no de Jack) se consultan en `POST 8089/faq` (`{prompt}` → `{hit, answer, url, id}`), que usa el catálogo curado `~/ai-hub/knowledge/drakescraft_hechos_manuales.json` y, si el usuario nombra el comando ("comando para home", "/sethome"), el catálogo verificado. Si hay acierto se responde el hecho + `📖 Guía: <url>`; si no, sigue el flujo normal. Toda respuesta de IA pasa por `normalizeGuideLine`, que deja la línea `📖 Guía: <url>` al final, limpia y clicable.
