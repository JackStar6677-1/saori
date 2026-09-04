#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Sovereign AI Engine (Clean Names, Full Log Ingestion & Real-Time Telemetry)
"""

import subprocess, sys, json, os, urllib.request, time, re, shutil
from datetime import datetime
from pathlib import Path
import unicodedata

PTERO_BASE = os.getenv('PTERO_BASE_URL', 'https://panel.example.com/api/client/servers/xxxxxx')
PTERO_KEY_PATH = os.getenv('PTERO_KEY_PATH', os.path.expanduser('~/.pterodactyl_key'))
MEMORY_FILE = os.getenv('SAORI_MEMORY_FILE', os.path.expanduser('~/.local/state/saori/memory.json'))
TAREAS_FILE = os.getenv('SAORI_TAREAS_FILE', os.path.expanduser('~/ai-hub/TAREAS_PENDIENTES.md'))
DISPATCH_TICKET_SCRIPT = os.getenv('SAORI_DISPATCH_SCRIPT', str(Path(__file__).parent / 'dispatch_ticket.py'))
NOTIFIER_SCRIPT = os.getenv('SAORI_NOTIFIER_SCRIPT', str(Path(__file__).parent / 'saori_notifier.py'))
MC_SERVER_DOMAIN = os.getenv('MC_SERVER_DOMAIN', 'mc.example.com')
QUOTA_ALERT_FILE = os.getenv('SAORI_QUOTA_ALERT_FILE', os.path.expanduser('~/.local/state/saori/quota_alerts.json'))
STATUS_HISTORY_FILE = os.getenv('SAORI_STATUS_HISTORY_FILE', os.path.expanduser('~/.local/state/saori/ai_status_history.json'))

STAFF_MEMBERS = [s.strip() for s in os.getenv('STAFF_MEMBERS', 'jack,admin,staff,moderador').lower().split(',') if s.strip()]

STAFF_ROSTER = {
    'jack': 'Fundador y Administrador Principal',
    'admin': 'Administrador de Infraestructura / Staff Técnico',
    'staff': 'Soporte y Moderación'
}
try:
    roster_env = os.getenv('SAORI_STAFF_ROSTER_JSON')
    if roster_env:
        STAFF_ROSTER.update(json.loads(roster_env))
except Exception:
    pass

SMALL_CAPS_MAP = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
    'ǫ': 'q', 'ʀ': 'r', 's': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
    'ʏ': 'y', 'ᴢ': 'z'
}

def clean_sender_name(raw_name):
    if not raw_name:
        return 'Amigo'
    
    # 1. Normalizar small caps
    s = ''
    for char in raw_name:
        s += SMALL_CAPS_MAP.get(char, char)
    
    # 2. Descomponer unicode (NFKD)
    s = unicodedata.normalize('NFKD', s)
    
    # 3. Quitar tags comunes
    s = re.sub(r'\[.*?\]|\(.*?\)|[-|✦│︱•~].*', '', s).strip()
    
    # 4. Obtener primera palabra
    words = s.split()
    if not words:
        return 'Amigo'
    first = words[0].strip('_').strip()
    
    # Quitar prefijos comunes como mr_ o sr_ si aplica
    if first.lower().startswith('mr_') and len(first) > 3:
        first = first[3:]
    elif first.lower().startswith('mr') and len(first) > 2:
        first = first[2:]

    first_lower = first.lower()
    if 'jack' in first_lower or 'admin' in first_lower:
        return 'Jack'

    return first.capitalize()
        
    return first.capitalize() or 'Amigo'




def get_staff_tasks():
    if os.path.exists(TAREAS_FILE):
        try:
            with open(TAREAS_FILE, 'r', encoding='utf-8') as f:
                return f.read().strip()
        except:
            pass
    return "No hay tareas pendientes registradas."

def add_staff_task(assigned_to, task_desc):
    try:
        current = get_staff_tasks()
        new_entry = f"- [ ] 📌 {assigned_to}: {task_desc} (Asignado por Jack {datetime.now().strftime('%d/%m %H:%M')})"
        if "### 📌 TAREAS ACTIVAS DEL STAFF" in current:
            parts = current.split("### 📌 TAREAS ACTIVAS DEL STAFF")
            updated = parts[0] + "### 📌 TAREAS ACTIVAS DEL STAFF\n\n" + new_entry + "\n" + parts[1].lstrip()
        else:
            updated = current + "\n\n" + new_entry
        with open(TAREAS_FILE, 'w', encoding='utf-8') as f:
            f.write(updated)
        return True
    except Exception as e:
        print(f"[SAORI-TASKS] Error: {e}", file=sys.stderr)
        return False

def load_memory():
    os.makedirs(os.path.dirname(MEMORY_FILE), exist_ok=True)
    if os.path.exists(MEMORY_FILE):
        try:
            with open(MEMORY_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return {
        "summary": "Jack es el Creador y Administrador de Saori.",
        "recent_dialogue": []
    }

def save_memory(mem):
    try:
        if len(mem.get("recent_dialogue", [])) > 30:
            mem["recent_dialogue"] = mem["recent_dialogue"][-20:]
            
        with open(MEMORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(mem, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SAORI-MEMORY] Error: {e}", file=sys.stderr)

def record_interaction(sender, prompt, reply):
    mem = load_memory()
    if "recent_dialogue" not in mem:
        mem["recent_dialogue"] = []
    
    clean_p = re.sub(r'\[Contexto[^\]]*\]\s*', '', prompt).strip()
    mem["recent_dialogue"].append({
        "sender": sender,
        "msg": clean_p[:400],
        "reply": reply[:400],
        "time": datetime.now().strftime("%H:%M")
    })
    save_memory(mem)

def get_user_conversation_history(sender_clean, limit=6):
    mem = load_memory()
    dialogues = mem.get("recent_dialogue", [])
    if not dialogues:
        return ""
        
    # Filtrar intercambios ESTRICTAMENTE con este usuario
    user_d = [d for d in dialogues if d.get("sender", "").strip().lower() == sender_clean.strip().lower()]
    if not user_d:
        return ""
        
    user_d = user_d[-limit:]
        
    lines = [f"HISTORIAL DE DIÁLOGO PREVIO CON {sender_clean} (ÚSALO PARA MANTENER LA COHERENCIA):"]
    for d in user_d:
        lines.append(f"- {d.get('sender')}: \"{d.get('msg')}\"")
        lines.append(f"  Saori: \"{d.get('reply')}\"")
    return "\n".join(lines) + "\n\n"



def trigger_alert_if_needed(prompt, sender):
    prompt_lower = prompt.lower()
    urgent_keywords = ['necesito a jack', 'busca a jack', 'llama a jack', 'urgente', 'se cayo el server', 'hackeando', 'dupeo', 'dupeando', 'crash']
    
    if any(k in prompt_lower for k in urgent_keywords):
        try:
            subprocess.Popen([
                sys.executable, 
                NOTIFIER_SCRIPT,
                f"Llamado Urgente de {sender}",
                f"El usuario {sender} ha reportado: {prompt}",
                'urgent'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception as e:
            print(f"[SAORI-ALERT] Error: {e}", file=sys.stderr)
    return False

def execute_minecraft_command(command_str):
    if not os.path.exists(PTERO_KEY_PATH):
        return False, "Falta llave Pterodactyl"
    try:
        # Sanitizar estrictamente: remover saltos de línea, carriage return y caracteres nulos
        cmd_clean = command_str.replace('\r', ' ').replace('\n', ' ').replace('\0', '').strip().lstrip('/')
        
        # Bloqueo anti-inyección de escalado de privilegios o destrucción de servidor
        cmd_lower = cmd_clean.lower()
        FORBIDDEN_CONSOLE = ['op ', 'deop ', 'pex ', 'lp user', 'luckperms user', 'sudo ']
        if any(cmd_lower.startswith(f) or f" {f}" in cmd_lower for f in FORBIDDEN_CONSOLE):
            return False, "Comando bloqueado por el cortafuegos de seguridad de Saori"

        with open(PTERO_KEY_PATH, 'r') as f:
            key = f.read().strip()
        headers = {
            'Authorization': f'Bearer {key}',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
        data = json.dumps({'command': cmd_clean}).encode()
        req = urllib.request.Request(f'{PTERO_BASE}/command', data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 204:
                return True, f"Comando '{cmd_clean}' ejecutado en consola."
    except Exception as e:
        return False, str(e)
    return False, "Error al ejecutar"

def handle_server_actions(prompt, sender):
    prompt_lower = prompt.lower().strip()
    is_jack = sender.lower() == 'jack'
    is_staff = any(s in sender.lower() for s in STAFF_MEMBERS) or is_jack

    if not is_jack and trigger_alert_if_needed(prompt, sender):
        pass

    # Bloqueo total para usuarios que no son Staff ni Jack
    if not is_staff:
        if any(k in prompt_lower for k in ['dame op', 'dame admin', 'dame owner', 'dame rango', 'kickea', 'banea', 'ejecuta', 'consola']):
            return "Acceso denegado: Solo el Staff y Jack tienen autorización para interactuar con la infraestructura."

        # BLOQUEO ESTRICTO DE PRIVACIDAD: Prohibido revelar logs, comandos o actividades privadas a usuarios comunes
        COMMAND_LOG_PROBES = [
            'que comandos uso', 'qué comandos uso', 'que comando uso', 'qué comando uso',
            'que comandos usó', 'qué comandos usó', 'que comandos utilizo', 'qué comandos utilizó',
            'ultimos comandos', 'últimos comandos', 'comandos se usaron', 'comandos uso',
            'revisa los logs', 'ver los logs', 'muestra los logs', 'muéstrame los logs',
            'que hizo el jugador', 'qué hizo el jugador', 'historial de comandos', 'coreprotect',
            'que ultimos comandos', 'qué últimos comandos'
        ]
        if any(k in prompt_lower for k in COMMAND_LOG_PROBES):
            return f"Hola {clean_sender_name(sender)}, por motivos de seguridad y privacidad, los registros de comandos y auditoría del servidor son confidenciales y solo accesibles por el Staff y Jack."

    # Comandos destructivos o de infraestructura global -> EXCLUSIVOS DE JACK
    CRITICAL_INFRA = ['dame op', 'dame admin', 'dame owner', 'op ', 'stop', 'restart', 'reload', 'pex', 'luckperms', 'lp ', 'ban-ip']
    if not is_jack and any(k in prompt_lower for k in CRITICAL_INFRA):
        return f"Hola {sender}, por seguridad solo Jack puede modificar permisos globales o reiniciar infraestructura."

    # TAREAS STAFF Y RECORDATORIOS A JACK (Jack o cualquier miembro del Staff)
    if is_jack or is_staff:
        reminder_to_jack = any(k in prompt_lower for k in ['recuerdale a jack', 'recuérdale a jack', 'recuerda a jack', 'avisa a jack', 'avísale a jack', 'dile a jack', 'notifica a jack'])
        task_triggers = ['recordar a', 'recuerda a', 'recuérdale a', 'anota tarea', 'asignar a', 'guardar pendiente', 'anota que']
        
        if reminder_to_jack or any(k in prompt_lower for k in task_triggers):
            sender_clean = clean_sender_name(sender)
            task_desc = prompt
            for k in ['recuerdale a jack que', 'recuérdale a jack que', 'recuerdale a jack o chagui', 'recuérdale a jack o chagui', 'recuerdale a jack', 'recuérdale a jack', 'recuerda a jack que', 'recuerda a jack', 'dile a jack que', 'dile a jack', 'avisa a jack que', 'avisa a jack', 'anota tarea a', 'anota tarea:', 'anota tarea']:
                if k in prompt_lower:
                    parts = re.split(re.escape(k), prompt, maxsplit=1, flags=re.IGNORECASE)
                    if len(parts) > 1 and parts[1].strip():
                        task_desc = parts[1].strip().lstrip(':').strip()
                    break
            
            target = "Jack" if reminder_to_jack else "Staff"
            if not reminder_to_jack:
                for word in STAFF_MEMBERS:
                    if word in prompt_lower:
                        target = word.capitalize()
                        break

            add_staff_task(target, f"{task_desc} (Reportado por {sender_clean})")
            
            # Alertar a Jack por WhatsApp
            try:
                subprocess.Popen([
                    sys.executable, 
                    NOTIFIER_SCRIPT,
                    f"📌 Recado Staff de {sender_clean} para {target}",
                    f"El miembro del Staff {sender_clean} ha solicitado anotar: \"{task_desc}\"",
                    'urgent',
                    'jack'
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as e:
                print(f"[SAORI-TASK-ALERT] Error: {e}", file=sys.stderr)
                
            return f"✅ ¡Anotado en la bitácora oficial para {target}! Notifiqué a Jack por WhatsApp con tu reporte: \"{task_desc}\"."

    # CONSULTA DE CARGO EN EL STAFF
    if any(k in prompt_lower for k in ['que cargo tengo', 'qué cargo tengo', 'mi cargo', 'que rango tengo', 'qué rango tengo', 'quien soy en el staff', 'quién soy en el staff', 'cual es mi rango', 'cuál es mi rango', 'cual es mi cargo']):
        s_clean = clean_sender_name(sender).lower()
        cargo = STAFF_ROSTER.get(sender.lower()) or STAFF_ROSTER.get(s_clean)
        if cargo:
            return f"Hola {clean_sender_name(sender)}, según el registro oficial de DrakesCraft eres {cargo}."
        return f"Hola {clean_sender_name(sender)}, actualmente apareces como usuario/jugador. Si eres Staff, pídele a Jack que te registre en la lista oficial."

    # BROADCAST / SAY EN MINECRAFT (Jack o Staff)
    # Soporta: "pone esto en el servidor de minecraft, ...", "pon esto en el server", "anuncia en minecraft ...", "informa a los usuarios ...", "manda al chat de mc: ..."
    broadcast_triggers = [
        'pone esto en el servidor de minecraft', 'pon esto en el servidor de minecraft',
        'pone esto en el servidor', 'pon esto en el servidor', 'pone en el servidor', 'pon en el servidor',
        'pone esto en minecraft', 'pon esto en minecraft', 'pone en minecraft', 'pon en minecraft',
        'anuncia en el servidor', 'anuncia en minecraft', 'avisa en el servidor', 'avisa en minecraft',
        'informa a los usuarios', 'informa a los jugadores', 'informa en el servidor', 'informa en minecraft', 'informa en el server',
        'manda al servidor de minecraft', 'manda al servidor', 'manda al server', 'manda a minecraft',
        'di en el server', 'di en el servidor', 'di en minecraft', 'di a los usuarios',
        'escribe en el servidor', 'escribe en minecraft', 'escribe en el chat',
        'publica en el servidor', 'publica en minecraft', 'notifica en el servidor', 'notifica en minecraft',
        'manda al chat de minecraft'
    ]
    matched_broadcast = next((t for t in broadcast_triggers if t in prompt_lower), None)
    if is_staff and matched_broadcast:
        parts = re.split(re.escape(matched_broadcast), prompt, maxsplit=1, flags=re.IGNORECASE)
        msg_to_say = parts[1].strip() if len(parts) > 1 else ""
        msg_to_say = msg_to_say.lstrip(':').lstrip(',').strip()
        if msg_to_say:
            msg_clean = msg_to_say.replace('\n', ' ').strip()
            ok, _ = execute_minecraft_command(f"say {msg_clean}")
            if ok:
                return f"📢 *Aviso enviado a Minecraft con /say:*\n\"{msg_clean}\""
            else:
                return "Hubo un problema al enviar el /say a la consola de Minecraft."

    # KICK / KICKALL (Jack o Staff)
    if is_staff and any(k in prompt_lower for k in ['kickea', 'kickear', 'kick', 'expulsa', 'echa a']):
        if any(k in prompt_lower for k in ['a todos', 'todos', 'all', '@a', 'kickall', 'todos enel servidor', 'todos en el servidor']):
            ok, _ = execute_minecraft_command("kick @a Servidor en reinicio de emergencia")
            if ok:
                return f"✅ Expulsados todos los jugadores de Minecraft para reinicio de emergencia por orden de {sender}."
            else:
                return "Hubo un error al intentar expulsar a todos los jugadores."

        parts = prompt.replace(',', ' ').replace('?', ' ').replace('!', ' ').split()
        target_player = None
        for i, word in enumerate(parts):
            if word.lower() in ['kick', 'kickea', 'kickear', 'echar', 'expulsar', 'expulsa'] and i + 1 < len(parts):
                target_player = parts[i+1].strip()
                if target_player.lower() in ['a', 'al']:
                    if i + 2 < len(parts):
                        target_player = parts[i+2].strip()
                break
        
        if target_player and target_player.lower() not in ['el', 'la', 'un', 'una', 'de']:
            if target_player.lower() == 'paco':
                target_player = 'pacox77'
            
            ok, msg = execute_minecraft_command(f"kick {target_player} Ordenado por {sender}")
            if ok:
                return f"Kickeado {target_player} de Minecraft como me pediste, {sender}."
            else:
                return f"Error al ejecutar kick: {msg}"

    # AYUDA / SHELP — Disponible para todos
    if any(k in prompt_lower.split() for k in ['shelp', '/shelp', '!shelp']) or prompt_lower in ['shelp', 'ayuda', 'help', 'comandos', 'saori help', 'saori shelp', 'saori ayuda', 'saori comandos']:
        return """🌸 *SAORI SRE · MANUAL DE COMANDOS Y CAPACIDADES* 🌸
_Asistente de Infraestructura y Moderación de DrakesCraft_

🎮 *IN-GAME & MODERACIÓN (Staff/Jack)*
• `Saori tira /troll <tipo> <jugador>` → Ejecuta troll in-game (ej: voidfall, creepers, etc.)
• `Saori kickea a <jugador>` → Expulsa a un jugador del servidor
• `Saori ejecuta /<comando>` → Corre cualquier comando en consola de Minecraft
• `Saori lista de jugadores` → Muestra quién está online directamente de consola

🎨 *GENERACIÓN DE IMÁGENES (IA Studio)*
• `Saori genera una imagen de <descripción>` → Crea arte digital en alta resolución
• `/imagen <prompt>` o `/image <prompt>` → Genera imagen al instante con IA

⚡ *TELEMETRÍA & RENDIMIENTO*
• `Saori tps del server` → Reporte en vivo de TPS y duraciones de tick (Spark)
• `Saori estado del server` → Uptime de Star, disco libre y estado de mundos
• `shelp` o `/shelp` → Muestra este menú de ayuda

🔍 *LOGS & AUDITORÍA INTELIGENTE*
• `Saori qué hizo <jugador>?` → Busca chat, compras (/store) y comandos recientes
• `Saori revisa los logs de <jugador> con CoreProtect` → Audita historial del jugador
• `Saori última actividad de comandos` → Resumen de los últimos movimientos en consola

🎙️ *AUDIO & VOZ (Voz Chilena)*
• `Saori manda un audio...` → Genera y envía nota de voz chilena al instante
• Si le mandas un audio a Saori → Lo transcribe (STT). Solo responderá con audio si se lo pides explícitamente.

📋 *GESTIÓN STAFF (Jack)*
• `Saori anota tarea a <Staff>: <descripción>` → Registra en la bitácora oficial
• Comandos de infraestructura crítica (`/op`, `/reload`, `/stop`) protegidos por RBAC."""


    # EJECUCIÓN DE COMANDOS SEGUROS / RECREATIVOS / STAFF (Jack o Lauti/Staff)
    # Soporta: "tira el /troll voidfall Macacra", "ejecuta /troll", "corre /say hola", "usa /co lookup ...", etc.
    cmd_triggers = [
        'ejecuta ', 'corre ', 'consola ', 'podes ejecutar ', 'puedes ejecutar ', 
        'ejecutar el ', 'ejecutar ', 'tira el ', 'tira un ', 'tira ', 'tirale ', 'tírale ',
        'lanza el ', 'lanza un ', 'lanza ', 'lanzale ', 'haz el ', 'haz un ', 'haz ',
        'usa el ', 'usa un ', 'usa ', 'manda el ', 'manda un ', 'aplica el ', 'aplica '
    ]
    
    # 1. Chequear si contiene una orden explícita con trigger
    matched_trigger = next((t for t in cmd_triggers if t in prompt_lower), None)
    
    # 2. O si contiene directamente un comando con slash como '/troll ...' o '/co ...'
    import re as _re
    slash_match = _re.search(r'(/(?:troll|co|lookup|warn|mute|say|broadcast|tp|seen|fly|heal|feed|repair|clear|kill|give|gamemode|weather|time|eco|money|balance|vanish|v|back|workbench|anvil|enderchest|ec|invsee|hat|speed|nick|socialspy|tempban|unban|unmute)[^\n]*)', prompt, _re.IGNORECASE)

    if is_staff and (matched_trigger or slash_match):
        raw_cmd = ''
        if slash_match:
            raw_cmd = slash_match.group(1).strip()
        elif matched_trigger:
            raw_cmd = prompt.split(matched_trigger, 1)[1].strip()
            raw_cmd = raw_cmd.lstrip('el ').lstrip('un ').rstrip('?').rstrip('!').strip()
        
        # Corregir typos comunes in-game (ej: voifall -> voidfall)
        raw_cmd = _re.sub(r'\bvoifall\b', 'voidfall', raw_cmd, flags=_re.IGNORECASE)
        
        # Validar si no es comando de infra crítica para no-Jack
        if not is_jack and any(k in raw_cmd.lower() for k in CRITICAL_INFRA):
            return f"Hola {sender}, por seguridad solo Jack puede ejecutar comandos de infraestructura crítica."

        ok, msg = execute_minecraft_command(raw_cmd)
        if ok:
            return f"Comando /{raw_cmd.lstrip('/')} ejecutado en Minecraft para ti, {sender}."
        else:
            return f"Error al ejecutar /{raw_cmd.lstrip('/')}: {msg}"


    # TPS — disponible para Jack y staff
    if any(k in prompt_lower for k in ['tps', 'spark tps', 'lag del server', 'rendimiento del server', 'server performance']):
        import re as _re
        def _capture_tps(cmd, keyword, wait):
            ok, _ = execute_minecraft_command(cmd)
            if not ok:
                return None
            time.sleep(wait)
            if not os.path.exists(PTERO_KEY_PATH):
                return None
            try:
                with open(PTERO_KEY_PATH) as f:
                    key = f.read().strip()
                headers = {'Authorization': f'Bearer {key}', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'}
                req = urllib.request.Request(f'{PTERO_BASE}/files/download?file=%2Flogs%2Flatest.log', headers=headers)
                with urllib.request.urlopen(req, timeout=5) as resp:
                    dl_url = json.loads(resp.read().decode()).get('attributes', {}).get('url')
                if not dl_url:
                    return None
                dl_req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(dl_req, timeout=8) as dl_resp:
                    lines = dl_resp.read().decode('utf-8', errors='ignore').splitlines()
                # Capturar bloque de TPS (hasta 6 líneas después del primer match)
                result_lines = []
                capturing = False
                for l in lines[-50:]:
                    if keyword.lower() in l.lower():
                        capturing = True
                    if capturing:
                        clean = _re.sub(r'^\[.*?\]\s+\[.*?\]:\s*', '', l).strip()
                        if clean:
                            result_lines.append(clean)
                        if len(result_lines) >= 6:
                            break
                return '\n'.join(result_lines) if result_lines else None
            except Exception:
                return None

        tps_output = _capture_tps('spark tps', 'TPS', 3.0) or _capture_tps('tps', 'TPS', 2.0)
        if tps_output:
            return f"TPS del servidor:\n{tps_output}"
        return "Ejecuté /tps en consola pero no capturé respuesta aún. Intenta de nuevo en unos segundos."

    # /list — jugadores online directamente de consola
    if any(k in prompt_lower for k in ['lista de jugadores', 'quien esta conectado', 'quién está conectado', 'players online', 'who is online']):
        line = execute_and_read_output('list', 'players online', wait_secs=2)
        if line:
            import re as _re
            clean = _re.sub(r'^\[.*?\]\s+\[.*?\]:\s*', '', line).strip()
            return f"Jugadores en línea: {clean}"

    return None

_LOGS_CACHE = {"ts": 0, "lines": []}

def _get_cached_latest_log_lines(ttl_secs=15):
    now = time.time()
    if _LOGS_CACHE["lines"] and (now - _LOGS_CACHE["ts"] < ttl_secs):
        return _LOGS_CACHE["lines"]

    if not os.path.exists(PTERO_KEY_PATH):
        return []

    try:
        with open(PTERO_KEY_PATH, 'r') as f:
            key = f.read().strip()
        headers = {'Authorization': f'Bearer {key}', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(f'{PTERO_BASE}/files/download?file=%2Flogs%2Flatest.log', headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            dl_url = json.loads(resp.read().decode()).get('attributes', {}).get('url')
        if not dl_url:
            return _LOGS_CACHE["lines"]
        dl_req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(dl_req, timeout=8) as dl_resp:
            lines = dl_resp.read().decode('utf-8', errors='ignore').splitlines()
            _LOGS_CACHE["ts"] = now
            _LOGS_CACHE["lines"] = lines
            return lines
    except Exception:
        return _LOGS_CACHE["lines"]

def clean_model_output(res):
    if not res:
        return res
    # 1. Remover citas web y artefactos Unicode PUA estilo cite... o [cite: ...]
    res = re.sub(r'[\ue200-\ue2ff].*?[\ue200-\ue2ff]', '', res)
    res = re.sub(r'cite.*?', '', res)
    res = re.sub(r'\[cite:[^\]]+\]', '', res)
    res = re.sub(r'\[\^[0-9]+\]', '', res)
    
    # 2. Normalizar menciones a modelos subyacentes
    replacements = [
        (r'\bClaude\b', 'Saori'),
        (r'\bclaude\b', 'Saori'),
        (r'\bAnthropic\b', 'Star Core'),
        (r'\banthropic\b', 'Star Core'),
        (r'\bOpenAI\b', 'Star Core'),
        (r'\bopenai\b', 'Star Core'),
        (r'\bChatGPT\b', 'Saori'),
        (r'\bchatgpt\b', 'Saori'),
        (r'\bGemini\b', 'Saori'),
        (r'\bgemini\b', 'Saori'),
        (r'\bAntigravity\b', 'Saori Core'),
        (r'\bantigravity\b', 'Saori Core'),
        (r'\bLLM\b', 'IA'),
        (r'\bmodelo de lenguaje\b', 'sistema inteligente')
    ]
    for pattern, rep in replacements:
        res = re.sub(pattern, rep, res, flags=re.IGNORECASE)
    
    return res.strip()

def fetch_live_drakescraft_logs(limit=400, focus_query=None, is_privileged=False):
    lines = _get_cached_latest_log_lines(ttl_secs=15)
    if not lines:
        return 'Sin acceso a logs.'

    try:
        # Filtrado estricto de privacidad para no-staff
        sensitive_patterns = [
            'issued server command', '[coreprotect]', 'co l', 'co inspect', 'co rollback',
            'authme', 'login', 'register', 'password', 'ip:', 'lost connection: ',
            '/tell', '/msg', '/w ', '/r ', '/whisper', '/lp', '/luckperms'
        ]

        filtered_lines = lines
        if not is_privileged:
            clean_lines = []
            for l in lines:
                l_lower = l.lower()
                if not any(k in l_lower for k in sensitive_patterns):
                    clean_lines.append(l)
            filtered_lines = clean_lines

        # 1. Extraer foco de jugador si se solicitó (ej: StoneAgeKing, Mattu, etc.)
        focused_lines = []
        if focus_query and len(focus_query) >= 3:
            q = focus_query.lower()
            for l in filtered_lines:
                if q in l.lower():
                    focused_lines.append(l)
        
        relevant = []
        chat_and_events = [
            'interactivechat', ' » ',
            'joined the game', 'logged in', 'lost connection',
            'left the game', 'died', 'kicked'
        ]
        if is_privileged:
            chat_and_events.extend(['issued server command', '[coreprotect]'])

        for l in filtered_lines[-limit:]:
            if any(k in l.lower() for k in chat_and_events):
                relevant.append(l)
        
        output_parts = []
        if focused_lines:
            output_parts.append(f"=== ACTIVIDAD ENFOCADA ({focus_query.upper()}) ===")
            output_parts.extend(focused_lines[-20:])
            output_parts.append("=== ÚLTIMOS EVENTOS Y CHAT GENERAL ===")
        
        output_parts.extend(relevant[-30:] if relevant else filtered_lines[-15:])
        return '\n'.join(output_parts)
    except Exception as e:
        return 'Logs temporalmente no disponibles.'


def execute_and_read_output(command_str, read_keyword, wait_secs=2.5):
    """Ejecuta un comando en consola y luego lee el log para capturar la respuesta."""
    ok, msg = execute_minecraft_command(command_str)
    if not ok:
        return None
    time.sleep(wait_secs)
    lines = _get_cached_latest_log_lines(ttl_secs=2)
    if not lines:
        return None
    matches = [l for l in lines[-30:] if read_keyword.lower() in l.lower()]
    return matches[-1] if matches else None

def get_minecraft_status():
    """Obtiene jugadores en línea directo de Pterodactyl (con cache corta) como primera fuente."""
    lines = _get_cached_latest_log_lines(ttl_secs=15)
    if lines:
        try:
            joined, left = set(), set()
            for l in lines:
                ll = l.lower()
                if 'joined the game' in ll or ('logged in with entity id' in ll):
                    import re as _re
                    m = _re.search(r'\]: ([A-Za-z0-9_]+) (?:joined|logged)', l)
                    if m: joined.add(m.group(1))
                if 'lost connection' in ll or 'left the game' in ll:
                    m2 = _re.search(r'\]: ([A-Za-z0-9_]+) (?:lost|left)', l)
                    if m2: left.add(m2.group(1))
            players_from_log = list(joined - left)
            online_from_log = len(players_from_log)
            if online_from_log >= 0:
                return {'online': online_from_log, 'max': 2026, 'players': players_from_log}
        except Exception:
            pass

    # Fuente 2: mcsrvstat.us (puede estar cacheado hasta 5 min, último recurso)
    try:
        req = urllib.request.Request(
            f'https://api.mcsrvstat.us/3/{MC_SERVER_DOMAIN}?_={int(time.time())}',
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=4) as r:
            d = json.loads(r.read().decode())
            online = d.get('players', {}).get('online', 0)
            max_p = d.get('players', {}).get('max', 2026)
            plist = [p['name'] for p in d.get('players', {}).get('list', [])]
            return {'online': online, 'max': max_p, 'players': plist}
    except Exception:
        return {'online': 'N/A', 'max': 2026, 'players': []}

def search_web_knowledge(query):
    import re as _re
    query_clean = query.lower()
    for prefix in ['saori', 'quien es', 'quién es', 'que es', 'qué es', 'sabes quien es', 'conoces a', 'dime de', 'noticias de', 'dime quien es', 'cuentame de', 'cuéntame de', 'por favor', 'pls', 'plz']:
        query_clean = query_clean.replace(prefix, '')
    search_q = query_clean.strip(' ,.?!')
    if len(search_q) < 2:
        search_q = query.strip()

    web_snippets = []

    # 1. DuckDuckGo HTML
    try:
        url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(search_q)
        req = urllib.request.Request(
            url, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'}
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            html = r.read().decode('utf-8', errors='ignore')
        snippets = _re.findall(r'<a class="result__snippet[^"]*"[^>]*>(.*?)</a>', html, _re.DOTALL)
        for s in snippets[:3]:
            clean = _re.sub(r'<[^>]+>', '', s).strip()
            clean = clean.replace('&#x27;', "'").replace('&quot;', '"').replace('&amp;', '&')
            if clean and len(clean) > 20:
                web_snippets.append(clean)
    except Exception:
        pass

    # 2. Wikipedia API en español
    try:
        url = 'https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + urllib.parse.quote(search_q) + '&utf8=&format=json'
        req = urllib.request.Request(url, headers={'User-Agent': 'SaoriBot/2.0 (drakescraft.cl)'})
        with urllib.request.urlopen(req, timeout=4) as r:
            d = json.loads(r.read().decode())
            results = d.get('query', {}).get('search', [])
            for res in results[:2]:
                title = res.get('title', '')
                snippet = _re.sub(r'<[^>]+>', '', res.get('snippet', '')).strip()
                snippet = snippet.replace('&#x27;', "'").replace('&quot;', '"').replace('&amp;', '&')
                if snippet:
                    web_snippets.append(f"{title}: {snippet}")
    except Exception:
        pass

    if web_snippets:
        return '\n'.join(web_snippets[:4])
    return None

def get_mesh_telemetry():

    try:
        uptime = subprocess.check_output(['uptime', '-p'], text=True).strip()
        df = subprocess.check_output(['df', '-h', '/'], text=True).split('\n')[1].split()[3]
        return f'Star: {uptime}, {df} libre'
    except:
        return 'Star Operativo'

def trigger_quota_alert(provider, detail):
    try:
        os.makedirs(os.path.dirname(QUOTA_ALERT_FILE), exist_ok=True)
        data = {}
        if os.path.exists(QUOTA_ALERT_FILE):
            try:
                with open(QUOTA_ALERT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except:
                pass
        
        last_alert = data.get(provider, 0)
        now = time.time()
        # Notificar a Jack por WhatsApp máximo 1 vez cada 25 minutos por proveedor
        if now - last_alert > 1500:
            data[provider] = now
            with open(QUOTA_ALERT_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f)
                
            msg = f"Alerta de cuota o rate limit en {provider}. Detalle: {detail}. Failover activo a otros motores de la Tríada."
            subprocess.Popen([
                sys.executable,
                NOTIFIER_SCRIPT,
                f"Alerta de Cuota IA: {provider}",
                msg,
                'urgent',
                'jack'
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[SAORI-QUOTA] ⚠️ Alerta de cuota enviada para {provider}", file=sys.stderr)
    except Exception as e:
        print(f"[SAORI-QUOTA] Error enviando alerta: {e}", file=sys.stderr)

def call_claude_haiku(system_prompt, user_prompt):
    claude_bin = shutil.which('claude') or 'claude'
    cmd = [
        claude_bin,
        '--system-prompt', system_prompt,
        '--model', 'haiku',
        '-p', user_prompt
    ]
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12)
        out = p.stdout.strip()
        if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'quota', 'rate limit', 'overloaded', 'hit your session limit']):
            return out
        if any(err in out.lower() for err in ['quota', 'rate limit', 'hit your session limit', 'session limit']):
            trigger_quota_alert("Claude (Anthropic)", out.split('\n')[0][:120])
    except Exception:
        pass
    return None

def call_codex_inference(system_prompt, user_prompt, is_heavy_task=False):
    codex_bin = shutil.which('codex') or 'codex'
    model = os.getenv('SAORI_CODEX_MODEL', 'gpt-5.6-sol')
    cmd = [
        codex_bin, 'exec', '--skip-git-repo-check',
        '-m', model,
        '-c', 'model_reasoning_effort="medium"',
        f"{system_prompt}\n\n[Mensaje]: {user_prompt}\n\n[Responde como SAORI, directo, conciso y usando los datos provistos]:"
    ]
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30)
        out = p.stdout.strip()
        if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'exception', 'traceback']):
            return out
        err_combined = (p.stderr or '') + ' ' + (out or '')
        if any(err in err_combined.lower() for err in ['quota', 'rate limit', '429', 'insufficient_quota']):
            trigger_quota_alert("Codex / GPT (OpenAI)", "Límite de cuota o rate limit alcanzado en OpenAI")
    except Exception as e:
        print(f"[SAORI-BRAIN] Fallo en Codex ({model}): {e}", file=sys.stderr)
    return None

def call_antigravity_inference(system_prompt, user_prompt):
    """Inferencia ágil a través de Antigravity (Gemini 3.8 Flash con esfuerzo medio)."""
    agy_bin = shutil.which('agy') or 'agy'
    model = os.getenv('SAORI_AGY_MODEL', 'gemini-3.8-flash-high')
    cmd = [
        agy_bin,
        '--model', model,
        '--effort', 'medium',
        '--dangerously-skip-permissions',
        '-p', f"{system_prompt}\n\n[Mensaje]: {user_prompt}\n\n[Responde como SAORI de forma concisa, inteligente y natural]:",
        '--print-timeout', '20s'
    ]
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=22)
        out = p.stdout.strip()
        if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'exception', 'traceback']):
            return out
        err_combined = (p.stderr or '') + ' ' + (out or '')
        if any(err in err_combined.lower() for err in ['quota', 'rate limit', 'resource_exhausted', '429', 'limit reached']):
            trigger_quota_alert("Antigravity / Gemini (Google)", "Límite de cuota o rate limit alcanzado en Gemini / Google AI")
    except Exception as e:
        print(f"[SAORI-BRAIN] Fallo en Antigravity: {e}", file=sys.stderr)
    return None




# =========================================================================
# SYSTEM PROMPT / PERSONA (PLANTILLA MODULAR Y SANITIZADA)
# =========================================================================
# Para definir la identidad y directivas de tu asistente sin versionar datos privados,
# configura la variable de entorno SAORI_SYSTEM_PROMPT.
DEFAULT_CANON_IDENTITY = os.getenv(
    "SAORI_SYSTEM_PROMPT",
    (
        "IDENTIDAD, ROL Y DIRECTIVAS GENERALES (EJEMPLO):\n"
        "- Eres SAORI, un asistente y agente SRE autónomo de soporte e infraestructura.\n"
        "- Tu objetivo es asistir a los usuarios y al equipo de administración resolviendo dudas y monitoreando el sistema.\n"
        "- Personalidad: Amable, técnica, concisa y profesional.\n"
        "- Trata a la administración con lealtad y respeto.\n"
        "[Configura aquí el prompt o persona de tu bot mediante SAORI_SYSTEM_PROMPT]\n"
    )
)

def run_saori_brain(prompt, sender):
    sender_clean = clean_sender_name(sender)
    is_jack = sender_clean.lower() == 'jack'
    is_staff = any(s in sender_clean.lower() for s in STAFF_MEMBERS) or is_jack

    action_reply = handle_server_actions(prompt, sender_clean)
    if action_reply:
        record_interaction(sender_clean, prompt, action_reply)
        return action_reply

    mc = get_minecraft_status()
    mesh = get_mesh_telemetry()
    staff_tasks = get_staff_tasks()

    # Detectar foco opcional si se pregunta por un jugador
    focus_player = None
    words = prompt.lower().replace('?', ' ').replace(',', ' ').split()
    if 'jugador' in words:
        idx = words.index('jugador')
        if idx + 1 < len(words):
            focus_player = ''.join(c for c in words[idx + 1] if c.isalnum())
    elif 'player' in words:
        idx = words.index('player')
        if idx + 1 < len(words):
            focus_player = ''.join(c for c in words[idx + 1] if c.isalnum())

    is_privileged = is_staff or is_jack
    live_logs = fetch_live_drakescraft_logs(limit=350, focus_query=focus_player, is_privileged=is_privileged)
    
    # Cargar Estado Global de la Red IA (opcional)
    ai_status_summary = ""
    try:
        if os.path.exists(STATUS_HISTORY_FILE):
            with open(STATUS_HISTORY_FILE, "r", encoding="utf-8") as f:
                sdata = json.load(f)
            guids = sdata.get("processed_guids", [])
            if guids:
                recent_events = [g.split('/')[-1].replace('-', ' ') for g in guids[-4:]]
                ai_status_summary = "\nEVENTOS RECIENTES DE INFRAESTRUCTURA E IA:\n- " + "\n- ".join(recent_events) + "\n"
    except Exception:
        pass

    # Búsqueda Web en Vivo
    web_knowledge = None
    web_triggers = ['quien es', 'quién es', 'que es', 'qué es', 'sabes de', 'conoces a', 'noticias', 'musica', 'música', 'precio', 'dolar', 'dólar', 'chiste', 'clima', 'como se llama']
    is_mc_related = any(k in prompt.lower() for k in ['minecraft', 'spawn', 'plugin', 'survival', 'ip:'])
    
    if any(t in prompt.lower() for t in web_triggers) or (not is_mc_related and len(prompt.split()) >= 2):
        web_knowledge = search_web_knowledge(prompt)

    # Interceptor de peticiones de desarrollo para despachar tickets a la Tríada
    dev_keywords = [
        'programa', 'codigo', 'código', 'script', 'refactor', 'desarrolla', 'desarrollar',
        'arregla el plugin', 'escribe codigo', 'parche', 'crea un plugin', 'corrige el bug',
        'revisa el bug', 'soluciona el bug', 'arregla el bug', 'modifica el codigo',
        'revisa el codigo', 'programa un', 'desarrolla un'
    ]
    is_development_request = any(k in prompt.lower() for k in dev_keywords)
    if is_development_request and (is_staff or is_jack):
        try:
            p_res = subprocess.run([
                sys.executable, DISPATCH_TICKET_SCRIPT,
                f"Desarrollo: {prompt[:50]}", prompt, sender_clean, "chat"
            ], capture_output=True, text=True, timeout=5)
            ticket_id = p_res.stdout.strip() or "Asignado"
            delegation_msg = (
                f"¡Entendido {sender_clean}! 🛠️ He tomado tu requerimiento técnico y lo delegué "
                f"a la Tríada de agentes (Codex, Claude y Antigravity) como el **Ticket #{ticket_id}**.\n\n"
                f"Ellos se encargarán del análisis de código, implementación y pruebas sin saturar la conversación. "
                f"Te avisaremos en cuanto esté resuelto."
            )
            record_interaction(sender_clean, prompt, delegation_msg)
            return delegation_msg
        except Exception as ex:
            print(f"[SAORI-DELEGATE] Error despachando ticket: {ex}", file=sys.stderr)

    is_coding_or_heavy = is_development_request
    is_asking_audio = any(k in prompt.lower() for k in ['audio', 'voz', 'manda un audio', 'graba un audio', 'saluda en audio', 'nota de voz'])

    user_history = get_user_conversation_history(sender_clean)
    web_section = f"\nINFORMACIÓN EN VIVO DE INTERNET (BÚSQUEDA WEB):\n{web_knowledge}\n" if web_knowledge else ""
    full_context_section = ai_status_summary + web_section

    is_asking_server_info = any(k in prompt.lower() for k in ['servidor', 'server', 'que ha pasado', 'qué ha pasado', 'resumen', 'actividad', 'logs', 'tps', 'online', 'estado'])

    canon_identity = DEFAULT_CANON_IDENTITY

    if not is_staff and not is_jack:
        mc_context = f"\nACTIVIDAD RECIENTE DEL SERVIDOR ({mc.get('online', 0)} online):\n{live_logs}\n" if is_asking_server_info else ""
        system_prompt = f"""{canon_identity}
Hablas con {sender_clean}.
{user_history}{full_context_section}{mc_context}
REGLAS GENERALES:
- Sé concisa, directa y cordial.
- Usa solo el nombre del usuario ({sender_clean}).
- PRIVACIDAD Y SEGURIDAD: Confidencialidad estricta sobre logs, contraseñas, comandos y auditoría interna.
- SALUD: NUNCA des diagnósticos médicos ni afirmaciones categóricas sobre prescripciones. Recomienda consultar profesionales de la salud.
- CAPACIDADES OMNICANAL: Tienes integración directa con WhatsApp, Discord y Minecraft. Despachas alertas y tickets a administración.
- Si hay INFORMACIÓN EN VIVO o CONTEXTO, úsalo para responder con precisión.
[Aquí van tus directivas personalizadas para usuarios]"""

    else:
        system_prompt = f"""{canon_identity}
Hablas con {sender_clean} (Staff / Administración).
{user_history}{full_context_section}
TELEMETRÍA Y CONSOLA ({mc.get('online', 0)} online):
{live_logs}

DATOS DEL SISTEMA:
- Infraestructura: {mesh}
- Tareas Staff: {staff_tasks}

REGLAS DE ADMINISTRACIÓN:
- Sé técnica, ejecutiva, rápida y precisa.
- Respeta la confidencialidad de la infraestructura y coordina con la Tríada SRE.
- Despacha tickets o tareas cuando se solicite asistencia técnica.
[Aquí van tus directivas personalizadas para administración]"""

    # 1. Tier 1: Claude Haiku (conversación ultrarrápida y liviana para chat)
    res = call_claude_haiku(system_prompt, prompt)
    if res:
        res = clean_model_output(res)
        record_interaction(sender_clean, prompt, res)
        return res

    # 2. Tier 2: Antigravity / Gemini 3.8 Flash (rápido y con esfuerzo medio)
    res_agy = call_antigravity_inference(system_prompt, prompt)
    if res_agy:
        res_agy = clean_model_output(res_agy)
        record_interaction(sender_clean, prompt, res_agy)
        return res_agy

    # 3. Tier 3: Codex GPT (fallback operativo con esfuerzo medio)
    res_codex = call_codex_inference(system_prompt, prompt, is_heavy_task=False)
    if res_codex:
        res_codex = clean_model_output(res_codex)
        record_interaction(sender_clean, prompt, res_codex)
        return res_codex

    # 4. Tier 4: Fallback grácil ante saturación total de APIs externas
    fallback_msg = f"¡Hola {sender_clean}! Mis motores cognitivos se están sincronizando en este momento. Mientras tanto, ¡el sistema continúa operando normalmente! 🌸"
    record_interaction(sender_clean, prompt, fallback_msg)
    return fallback_msg

if __name__ == '__main__':
    p = sys.argv[1] if len(sys.argv) > 1 else 'Hola'
    s = sys.argv[2] if len(sys.argv) > 2 else 'Staff'
    print(run_saori_brain(p, s))

