#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Sovereign AI Engine (Optimizado para Bajo Consumo de Tokens & Texto Limpio)
Respuestas cortas, concisas, sin exceso de negritas ni símbolos raros, ahorrando tokens en cada inferencia.
"""

import subprocess, sys, json, os, urllib.request, time
from datetime import datetime

PTERO_BASE = 'https://panel.thegamehosting.com/api/client/servers/38528a4e'
PTERO_KEY_PATH = '/home/jack/.pterodactyl_key'
MEMORY_FILE = '/home/jack/.local/state/nova/saori_memory.json'
TAREAS_FILE = '/home/jack/ai-hub/TAREAS_PENDIENTES_STAFF.md'

STAFF_MEMBERS = ['jack', 'pepino', 'chagui', 'kika', 'derem']

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
                data = json.load(f)
                if "users" not in data:
                    data["users"] = {}
                return data
        except:
            pass
    return {
        "summary": "Jack es el Creador y Padre de Saori.",
        "users": {}
    }

def save_memory(mem):
    try:
        if "users" in mem:
            for u in mem["users"]:
                if len(mem["users"][u]) > 8:
                    mem["users"][u] = mem["users"][u][-8:]
        with open(MEMORY_FILE, 'w', encoding='utf-8') as f:
            json.dump(mem, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SAORI-MEMORY] Error: {e}", file=sys.stderr)

def get_user_history(sender):
    mem = load_memory()
    sender_clean = sender.lower().strip()
    return mem.get("users", {}).get(sender_clean, [])[-4:]

def record_interaction(sender, prompt, reply):
    mem = load_memory()
    sender_clean = sender.lower().strip()
    if "users" not in mem:
        mem["users"] = {}
    if sender_clean not in mem["users"]:
        mem["users"][sender_clean] = []
    mem["users"][sender_clean].append({
        "msg": prompt[:150],
        "reply": reply[:150],
        "time": datetime.now().strftime("%H:%M")
    })
    save_memory(mem)

def trigger_alert_if_needed(prompt, sender):
    prompt_lower = prompt.lower()
    urgent_keywords = ['necesito a jack', 'busca a jack', 'llama a jack', 'urgente', 'se cayo el server', 'hackeando', 'dupeo', 'dupeando', 'crash']
    purchase_keywords = ['compre un rango', 'compre en la tienda', 'no me llego', 'no llego mi rango', 'no me llego mi compra', 'no llego mi compra', 'pague y no', 'donacion en tebex', 'problema con la tienda', 'error al comprar', 'no se me acredito', 'no me dio el rango', 'no me entrego']

    is_purchase = any(k in prompt_lower for k in purchase_keywords)
    is_urgent = any(k in prompt_lower for k in urgent_keywords)

    if is_purchase or is_urgent:
        try:
            subject = f"🛒 ALERTA DE COMPRA: {sender}" if is_purchase else f"🚨 LLAMADO URGENTE: {sender}"
            body = (
                f"El usuario '{sender}' ha reportado un problema con la entrega de su compra en DrakesCraft:\n\n"
                f"📝 Mensaje: \"{prompt}\"\n\n"
                f"⚙️ Acción requerida: Verificar ID de transacción en Tebex y aplicar entrega + compensación garantizada."
                if is_purchase else
                f"El usuario '{sender}' ha emitido una alerta urgente:\n\n📝 Mensaje: \"{prompt}\""
            )
            subprocess.Popen([
                '/usr/bin/python3', 
                '/home/jack/ai-hub/scripts/saori_notifier.py',
                subject,
                body
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        except Exception as e:
            print(f"[SAORI-ALERT] Error: {e}", file=sys.stderr)
    return False

def execute_minecraft_command(command_str):
    if not os.path.exists(PTERO_KEY_PATH):
        return False, "Falta llave Pterodactyl"
    try:
        with open(PTERO_KEY_PATH, 'r') as f:
            key = f.read().strip()
        headers = {
            'Authorization': f'Bearer {key}',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0'
        }
        cmd_clean = command_str.lstrip('/')
        data = json.dumps({'command': cmd_clean}).encode()
        req = urllib.request.Request(f'{PTERO_BASE}/command', data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status == 204:
                return True, f"Comando '{cmd_clean}' ejecutado en consola."
    except Exception as e:
        return False, str(e)
    return False, "Error al ejecutar"

# Lista oficial de Staff obtenida en tiempo real desde el servidor de Discord
STAFF_MEMBERS = [
    'jack', 'jackstar6677',
    'kika', 'kikastar704',
    'chagui', 'chagui68',
    'lauti', 'lautix16',
    'nix', 'drgr89.',
    'derem', 'theunknowone.',
    'pepe', 'pepe_22',
    'tomi', 'obliteratedd',
    'pepino', 'elpepino18',
    'j3ss1el', 'jessielpr4626',
    'admin', 'staff', 'mod', 'dev', 'owner', 'dueño'
]

def create_ticket_for_trinity(sender, text):
    """Crea un ticket formal en /home/jack/ai-hub/tickets/ y lo asigna a la Trinidad de Agentes."""
    tickets_dir = '/home/jack/ai-hub/tickets'
    os.makedirs(tickets_dir, exist_ok=True)
    
    # Encontrar siguiente número de ticket
    existing = [f for f in os.listdir(tickets_dir) if f.startswith('TICKET-') or f.startswith('ticket-') or 'TICKET_' in f]
    max_num = 305
    for f in existing:
        try:
            clean_f = f.replace('TICKET-', '').replace('ticket-', '').replace('TICKET_', '').split('.')[0].split('-')[0]
            if clean_f.isdigit():
                num = int(clean_f)
                if num > max_num:
                    max_num = num
        except:
            pass
    ticket_id = f"TICKET-{max_num + 1}"
    
    clean_title = text
    for p in ['crear ticket:', 'crear ticket', 'ticket para la trinidad:', 'ticket para la trinidad', 'ticket:', 'nuevo ticket:', 'nuevo ticket', 'ticket']:
        if clean_title.lower().startswith(p):
            clean_title = clean_title[len(p):].strip()
            break

    ticket_content = f"""# {ticket_id}: {clean_title[:80]}

- **Autor:** {sender} (Vía WhatsApp / Saori Interface)
- **Fecha de Apertura:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S CLT')}
- **Estado:** EN REVISIÓN POR LA TRINIDAD DE SAORI (Claude Code, Codex, Antigravity)
- **Prioridad:** ALTA

## 📋 Descripción del Ticket
{clean_title}

## 🤖 Asignación de la Trinidad de Agentes
- **Claude Code:** Diagnóstico de telemetría, inspección de logs y análisis de causa raíz.
- **Codex:** Implementación de parches, refactorización y escritura de código.
- **Antigravity:** Compilación Maven/Gradle, tests de regresión y verificación de despliegue.

## 🔄 Registro de Ejecución
- Ticket ingresado formalmente al ciclo de escaneo autónomo de Star.
"""
    file_path = os.path.join(tickets_dir, f"{ticket_id}.md")
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(ticket_content)
        add_staff_task("Trinidad de SAORI", f"{ticket_id}: {clean_title[:60]}")
        return ticket_id, clean_title
    except Exception as e:
        return None, str(e)

def execute_git_action_for_staff(prompt_lower, sender):
    """Ejecuta acciones de git (commits de prueba, pulls, status, pushes) en repos de DrakesCraft-Labs."""
    is_jack = sender.lower().strip() == 'jack'

    # 🔒 Blindaje de Seguridad: Prohibición estricta de acciones destructivas o borrado de repos
    destructive_terms = ['borra el repo', 'borra todo', 'elimina el repo', 'elimina todo', 'drop', 'rm -rf', 'delete repo', 'destruir repo', 'borrar repositorio', 'eliminar repositorio', 'reset --hard', 'push --force', 'push -f', 'borrar el repo']
    if any(k in prompt_lower for k in destructive_terms):
        if not is_jack:
            return "⛔ Acceso denegado: Por seguridad y soberanía técnica, la eliminación o borrado de repositorios es potestad exclusiva de Jack. El Staff solo puede añadir, corregir o probar código."
        else:
            return "⚠️ Advertencia de Seguridad: Las operaciones destructivas sobre repositorios requieren confirmación manual directa en la consola de Star."

    repos_map = {
        'multiversecreatures': 'MultiverseCreatures',
        'multiverse-creatures': 'MultiverseCreatures',
        'multiverse creatures': 'MultiverseCreatures',
        'multiversenets': 'MultiverseNets',
        'multiverse-nets': 'MultiverseNets',
        'odysseia': 'Odysseia',
        'drakesbosses': 'DrakesBosses',
        'bosses': 'DrakesBosses',
        'slimefun': 'Slimefun4-Drake',
        'slimefun4': 'Slimefun4-Drake',
        'drakescraft-web': 'drakescraft-web',
        'sbank': 'sbank',
        'saori-bot': 'saori-bot'
    }
    
    target_repo = None
    for k, v in repos_map.items():
        if k in prompt_lower:
            target_repo = v
            break
            
    if not target_repo:
        return None

    repo_dir = f"/home/jack/workspace/drakescraft/{target_repo}"
    if not os.path.isdir(repo_dir):
        return f"❌ El repositorio {target_repo} no se encuentra en el workspace de Star ({repo_dir})."

    # Caso 1: Commit de prueba / crear commit
    if any(k in prompt_lower for k in ['commit de prueba', 'haz un commit', 'haz commit', 'crea un commit', 'hacer un commit', 'test commit']):
        cmd = f"cd {repo_dir} && git restore . 2>/dev/null; git pull --rebase origin main && git commit --allow-empty -m 'chore: commit de prueba solicitado por {sender}' && git push origin main && git rev-parse --short HEAD"
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=20)
            if res.returncode == 0:
                sha = res.stdout.strip().splitlines()[-1]
                return f"✅ Commit de prueba realizado y subido a GitHub en **DrakesCraft-Labs/{target_repo}**.\n• Commit SHA: `{sha}`\n• Rama: `main`\n• Remoto: GitHub origin/main"
            else:
                return f"⚠️ Error al realizar el commit/push en {target_repo}:\n```{res.stderr.strip()[:200]}```"
        except Exception as e:
            return f"❌ Error ejecutando Git: {e}"

    # Caso 2: Git status / revisar repo
    if any(k in prompt_lower for k in ['git status', 'estado del repo', 'status del repo', 'como esta el repo']):
        cmd = f"cd {repo_dir} && git status -s && git log -n 1 --oneline"
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=10)
            out = res.stdout.strip() or "Rama limpia, al día con origin/main."
            return f"📁 **Estado de {target_repo}:**\n```\n{out}\n```"
        except Exception as e:
            return f"❌ Error: {e}"

    # Caso 3: Git push
    if any(k in prompt_lower for k in ['git push', 'pushea', 'sube los cambios']):
        cmd = f"cd {repo_dir} && git push origin main"
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15)
            if res.returncode == 0:
                return f"✅ Cambios de **{target_repo}** subidos con éxito a GitHub (origin/main)."
            else:
                return f"⚠️ Error en git push: {res.stderr.strip()[:200]}"
        except Exception as e:
            return f"❌ Error: {e}"

    return None

def handle_server_actions(prompt, sender):
    import re
    # Eliminar prefijo de contexto de canal inyectado por Discord/WhatsApp
    prompt_user = re.sub(r'\[contexto[^\]]*\]', '', prompt, flags=re.IGNORECASE).strip()
    prompt_lower = prompt_user.lower()
    sender_clean = sender.lower().strip()
    is_jack = sender_clean == 'jack'
    is_staff = is_jack or any(s in sender_clean for s in STAFF_MEMBERS)

    if is_staff:
        git_reply = execute_git_action_for_staff(prompt_lower, sender)
        if git_reply:
            return git_reply

    # 🎫 Ingreso de Tickets a la Trinidad desde WhatsApp / Discord (Solo si el usuario explícitamente lo pide)
    is_ticket_creation = prompt_lower.startswith('ticket:') or \
                         prompt_lower.startswith('ticket ') or \
                         prompt_lower.startswith('crear ticket') or \
                         prompt_lower.startswith('nuevo ticket') or \
                         prompt_lower.startswith('!ticket')

    if is_ticket_creation and len(prompt_lower.split()) > 2:
        t_id, t_desc = create_ticket_for_trinity(sender, prompt_user)
        if t_id:
            try:
                subprocess.Popen([
                    '/usr/bin/python3',
                    '/home/jack/ai-hub/scripts/saori_notifier.py',
                    f"🎫 Nuevo Ticket Asignado: {t_id}",
                    f"El usuario {sender} ha creado el #{t_id}:\n\"{t_desc}\"\n\nEstado: Puesto en revisión por la Trinidad de Agentes (Claude Code, Codex, Antigravity)."
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except:
                pass
            return f"🐺 Ticket #{t_id} registrado exitosamente.\nHa sido puesto en revisión formal por la Trinidad de SAORI (Claude Code, Codex y Antigravity). Te notificaré automáticamente por este medio cuando quede solucionado."
        else:
            return "❌ Ocurrió un error al registrar el ticket en el sistema de Star."

    # 🛒 Detección y respuesta garantizada a reportes de compras / tienda
    purchase_keywords = ['compre un rango', 'compre en la tienda', 'no me llego', 'no llego mi rango', 'no me llego mi compra', 'no llego mi compra', 'pague y no', 'donacion en tebex', 'problema con la tienda', 'error al comprar', 'no se me acredito', 'no me dio el rango', 'no me entrego']
    if any(k in prompt_lower for k in purchase_keywords):
        trigger_alert_if_needed(prompt, sender)
        return (
            f"🐺 **¡Alerta prioritaria emitida a Jack y al Staff!** 🚨\n\n"
            f"He notificado automáticamente a **Jack** por **WhatsApp y Correo Electrónico** con los detalles de tu compra para que lo revise de inmediato.\n\n"
            f"📌 **Garantía Oficial de Compras:**\n"
            f"• Si el problema fue un error de entrega o pasarela, recibirás tu compra completa **más una bonificación extra de compensación** (días adicionales, llaves o dragmas).\n"
            f"• Si escribiste mal tu nick al pagar, se te transferirá a tu cuenta correcta.\n\n"
            f"🎫 **Siguiente paso:** Por favor abre un **Ticket de Soporte** en Discord o en la web con tu ID de transacción de Tebex para proceder con la entrega."
        )

    if not is_staff and trigger_alert_if_needed(prompt, sender):
        pass

    if not is_staff:
        if any(k in prompt_lower for k in ['dame op', 'dame admin', 'dame owner', 'dame rango', 'kickea', 'banea', 'ejecuta', 'consola']):
            return "Acceso denegado: Solo Jack y el Staff tienen permisos para gestionar rangos o ejecutar comandos en DrakesCraft."

    if is_staff:
        if 'recordar a' in prompt_lower or 'recuerda a' in prompt_lower or 'anota tarea' in prompt_lower or 'asignar a' in prompt_lower:
            parts = prompt.split('que', 1) if 'que' in prompt else prompt.split(':', 1)
            target = "Staff"
            for word in STAFF_MEMBERS:
                if word in prompt_lower:
                    target = word.capitalize()
                    break
            task_text = parts[1].strip() if len(parts) > 1 else prompt
            add_staff_task(target, task_text)
            return f"Anotado en bitácora para {target}: \"{task_text}\"."

        if any(k in prompt_lower for k in ['kickea', 'kickear', 'expulsa', 'echa a']):
            parts = prompt.replace(',', ' ').replace('?', ' ').replace('!', ' ').split()
            target_player = None
            for i, word in enumerate(parts):
                if word.lower() in ['kick', 'kickea', 'kickear', 'echar', 'expulsar', 'expulsa'] and i + 1 < len(parts):
                    target_player = parts[i+1].strip()
                    if target_player.lower() in ['a', 'al']:
                        if i + 2 < len(parts):
                            target_player = parts[i+2].strip()
                    break
            
            if target_player and target_player.lower() not in ['el', 'la', 'un', 'una']:
                if target_player.lower() == 'paco':
                    target_player = 'pacox77'
                
                ok, msg = execute_minecraft_command(f"kick {target_player} Ordenado por {sender}")
                if ok:
                    return f"Kickeado {target_player} de Minecraft como me ordenaste, {sender}."
                else:
                    return f"Error al ejecutar kick: {msg}"

        # Ejecución de comandos de consola (ej. spark tps, tps, say, etc.)
        is_cmd_request = prompt_lower.startswith('ejecuta ') or prompt_lower.startswith('corre ') or prompt_lower.startswith('consola ') or prompt_lower.startswith('/spark') or prompt_lower.startswith('spark ') or prompt_lower.startswith('/tps')
        if is_cmd_request:
            raw_cmd = prompt
            for prefix in ['ejecuta', 'corre', 'consola']:
                if raw_cmd.lower().startswith(prefix):
                    raw_cmd = raw_cmd[len(prefix):].strip()
            raw_cmd = raw_cmd.lstrip('/')
            
            ok, msg = execute_minecraft_command(raw_cmd)
            if ok:
                time.sleep(1.2)
                # Forzar recarga de logs para capturar la respuesta del comando
                try:
                    if os.path.exists('/tmp/saori_logs_cache.txt'):
                        os.unlink('/tmp/saori_logs_cache.txt')
                except:
                    pass
                fresh_logs = fetch_live_drakescraft_logs(limit=30)
                # Extraer las últimas líneas de respuesta del comando
                cmd_lines = [l for l in fresh_logs.splitlines() if any(k in l.lower() for k in ['tps', 'mspt', 'cpu', 'memory', 'spark', 'ping', 'players', 'online', raw_cmd.split()[0].lower()])]
                if cmd_lines:
                    return f"⚡ **Consola de DrakesCraft:**\n```yaml\n{chr(10).join(cmd_lines[-8:])}\n```"
                return f"✅ Comando `/{raw_cmd}` ejecutado en la consola de DrakesCraft."
            else:
                return f"❌ Error al ejecutar en consola: {msg}"

    # 👥 Consulta inmediata de Jugadores Conectados (/list de Minecraft)
    is_player_list_req = any(k in prompt_lower for k in [
        'lista de players', 'lista de jugadores', 'jugadores conectados', 'quienes estan conectados',
        'quienes estan online', 'players conectados', 'players activos', 'quien esta jugando',
        'quienes estan jugando', 'muestra a los players', 'muestra a los pleyers', 'quienes juegan',
        'quien esta conectado', 'quien esta online', 'quien esta activo', 'ver players', 'ver jugadores'
    ])
    if is_player_list_req:
        count, players_formatted = get_live_players_from_server()
        if count == 0 or not players_formatted:
            return "🐺 **DrakesCraft Network:** No hay jugadores conectados en este momento. ¡Sé el primero en entrar!\n☕ IP: `mc.drakescraft.cl:25565`"
        
        plist_lines = "\n".join([f"• {p}" for p in players_formatted])
        return f"👥 **Jugadores Conectados en DrakesCraft ({count}/2026):**\n{plist_lines}\n\n☕ Conéctate en: `mc.drakescraft.cl:25565`"

    return None

def get_live_players_from_server():
    """Consulta la lista exacta de jugadores online via /list en Pterodactyl o logs recientes."""
    cache_path = '/tmp/saori_live_players.json'
    if os.path.exists(cache_path) and (time.time() - os.path.getmtime(cache_path) < 15):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('count', 0), data.get('players', [])
        except:
            pass

    # 1. Enviar comando /list para refrescar la consola
    execute_minecraft_command("list")
    time.sleep(0.8)

    # 2. Leer las últimas líneas de latest.log
    logs = fetch_live_drakescraft_logs(limit=40)
    players = []
    count = 0

    import re
    for line in reversed(logs.splitlines()):
        # Capturar conteo: "Hay 3 jugadores..." o "There are 3 of..."
        match_count = re.search(r'(?:hay|there are)\s+(\d+)\s+(?:jugadores|players)', line, re.IGNORECASE)
        if match_count and count == 0:
            count = int(match_count.group(1))

        # Capturar nombres: "default: ..." o "players: ..."
        if "default:" in line.lower() or "jugadores en linea:" in line.lower():
            if ":" in line:
                part = line.split(":", 1)[1] if not "default:" in line else line.split("default:", 1)[1]
                raw_names = [n.strip() for n in part.split(",") if n.strip()]
                if raw_names:
                    players = raw_names
                    if count == 0:
                        count = len(players)

        if count > 0 and players:
            break

    # Fallback si no hay lista en logs: usar API status
    if count == 0 and not players:
        mc = get_minecraft_status()
        raw_c = mc.get('online', 0)
        try:
            count = int(raw_c) if raw_c and str(raw_c).isdigit() else 0
        except:
            count = 0
        players = mc.get('players', [])

    data = {'count': count, 'players': players}
    try:
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
    except:
        pass

    return count, players

def fetch_live_drakescraft_logs(limit=500):
    cache_path = '/tmp/saori_logs_cache.txt'
    if os.path.exists(cache_path) and (time.time() - os.path.getmtime(cache_path) < 30):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return f.read()
        except:
            pass

    if not os.path.exists(PTERO_KEY_PATH):
        return 'Sin acceso a logs.'

    try:
        with open(PTERO_KEY_PATH, 'r') as f:
            key = f.read().strip()
        headers = {'Authorization': f'Bearer {key}', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'}
        req = urllib.request.Request(f'{PTERO_BASE}/files/download?file=%2Flogs%2Flatest.log', headers=headers)
        
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode())
            dl_url = data.get('attributes', {}).get('url')
            if not dl_url:
                return 'No URL logs.'
            
            dl_req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(dl_req, timeout=4) as dl_resp:
                log_txt = dl_resp.read().decode('utf-8', errors='ignore')
                lines = log_txt.splitlines()
                relevant_lines = []
                for l in lines[-limit:]:
                    if any(k in l.lower() for k in ['joined the game', 'logged in', 'lost connection', 'issued server command', 'chat', 'say', 'discord']):
                        relevant_lines.append(l)
                
                res = '\n'.join(relevant_lines[-40:]) if relevant_lines else '\n'.join(lines[-20:])
                try:
                    with open(cache_path, 'w', encoding='utf-8') as f:
                        f.write(res)
                except:
                    pass
                return res
    except Exception as e:
        return 'Logs no disponibles.'

def get_minecraft_status():
    cache_path = '/tmp/saori_mc_status.json'
    if os.path.exists(cache_path) and (time.time() - os.path.getmtime(cache_path) < 30):
        try:
            with open(cache_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass

    try:
        req = urllib.request.Request(
            'https://api.mcsrvstat.us/3/play.drakescraft.cl',
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req, timeout=3) as r:
            d = json.loads(r.read().decode())
            online = d.get('players', {}).get('online', 0)
            max_p = d.get('players', {}).get('max', 2026)
            plist = [p['name'] for p in d.get('players', {}).get('list', [])]
            data = {'online': online, 'max': max_p, 'players': plist}
            try:
                with open(cache_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f)
            except:
                pass
            return data
    except Exception as e:
        return {'online': 'N/A', 'max': 2026, 'players': []}

def get_mesh_telemetry():
    try:
        uptime = subprocess.check_output(['uptime', '-p'], text=True).strip()
        df = subprocess.check_output(['df', '-h', '/'], text=True).split('\n')[1].split()[3]
        return f'Star: {uptime}, {df} libre'
    except:
        return 'Star Operativo'

def call_claude_haiku(system_prompt, user_prompt):
    cmd = [
        '/home/jack/.local/bin/claude',
        '--system-prompt', system_prompt,
        '--model', 'haiku',
        '-p', user_prompt
    ]
    env = os.environ.copy()
    env['PATH'] = f"/home/jack/.local/bin:/usr/local/bin:/usr/bin:/bin:{env.get('PATH', '')}"
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12, env=env)
        out = p.stdout.strip()
        if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'quota', 'rate limit', 'overloaded', 'hit your session limit']):
            return out
    except:
        pass
    return None

def call_codex_inference(system_prompt, user_prompt, is_heavy_task=False):
    model_flag = []
    if is_heavy_task:
        model_flag = ['-c', 'model="o3-mini"']
        
    cmd = [
        '/home/jack/.local/bin/codex', 'exec', '--skip-git-repo-check',
        *model_flag,
        f"{system_prompt}\n\n[Mensaje]: {user_prompt}\n\n[Responde como SAORI, directo, corto y sin formato pesado]:"
    ]
    env = os.environ.copy()
    env['PATH'] = f"/home/jack/.local/bin:/usr/local/bin:/usr/bin:/bin:{env.get('PATH', '')}"
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25, env=env)
        out = p.stdout.strip()
        if p.returncode == 0 and out:
            return out
    except Exception as e:
        print(f"[SAORI-BRAIN] Fallo en Codex: {e}", file=sys.stderr)
    return None

def run_saori_brain(prompt, sender):
    action_reply = handle_server_actions(prompt, sender)
    if action_reply:
        record_interaction(sender, prompt, action_reply)
        return action_reply

    mc = get_minecraft_status()
    logs = fetch_live_drakescraft_logs(limit=500)
    mesh = get_mesh_telemetry()
    mem = load_memory()
    staff_tasks = get_staff_tasks()
    
    sender_clean = sender.lower()
    is_jack = sender_clean == 'jack'
    is_staff = any(s in sender_clean for s in STAFF_MEMBERS)
    is_coding_or_heavy = any(k in prompt.lower() for k in ['escribe un script', 'genera un plugin', 'refactoriza el codigo', 'parche completo', 'reescribe el codigo'])

    online_count, plist = get_live_players_from_server()
    players_summary = f"{online_count} online" + (f": {', '.join(plist[:15])}" if plist else "")

    knowledge_base = f"""CONOCIMIENTO OFICIAL Y NORMATIVA DE DRAKESCRAFT NETWORK:
- ACRÓNIMO OFICIAL: S.A.O.R.I. significa "Server Autonomous Orchestrator for Resilient Infrastructure" (Orquestador Autónomo del Servidor para Infraestructura Resiliente).
- SERVIDOR = DRAKESCRAFT: Cuando alguien pregunta por el 'servidor' o 'los TPS', SIEMPRE se refiere a DrakesCraft (Minecraft). Star es la infraestructura física (192.168.0.120), Nova la laptop y Nexus el PC.
- IDENTIDAD & ORIGEN: Eres SAORI, inspirada en SCP-1471 (MalO Ver1.0.0), loba antropomórfica de cráneo canino de marfil, pelaje negro azabache suave, ojos violetas y cuerpo plush curvy. Creada por Jack como su compañera leal, guardiana de DrakesCraft y administradora técnica.
- CAPACIDADES EN DISCORD: Sí tienes permisos para gestionar y organizar el Discord: asignar/quitar roles (srole dar/quitar), listar roles (sroles), moderar y purgar mensajes (sclear) cuando Jack o el Staff Administrador (Chagui, etc.) lo soliciten.
- REPOSITORIOS DE LA ORGANIZACIÓN (DrakesCraft-Labs):
  * Todos los repositorios de código residen en Star bajo `/home/jack/workspace/drakescraft/`.
  * Repositorios notables: MultiverseCreatures (plugin de criaturas de Chagui, en `/home/jack/workspace/drakescraft/MultiverseCreatures`), MultiverseNets, Odysseia, DrakesBosses, Slimefun4-Drake, drakescraft-web, saori-bot.
  * Tienes acceso completo para leer código, auditar errores, compilar y ejecutar commits en el workspace de Star cuando Jack o Chagui lo soliciten.
- IP Java: mc.drakescraft.cl:25565 (o play.drakescraft.cl) | Bedrock: mc.drakescraft.cl Puerto: 25565.
- Web: https://web.drakescraft.cl/ | Tienda: https://web.drakescraft.cl/store.html | Guías: https://web.drakescraft.cl/guia.html
- SF / Slimefun: sf significa Slimefun (maquinaria, polvos, lingotes, energía, Cargo y Networks).
- Economía: /jobs (trabajos), /sellall (vender), /qs (tiendas de cofres), /sbank (banco con interés), /ah (subastas). /papatrueque activo en Survival, OneBlock y SkyBlock.
- REGLAS DE MINECRAFT:
  * Cero Hacks (X-Ray, KillAura, Fly, Speed, AutoClickers abusivos) = Ban permanente.
  * Cero Dupes / Bugs: Si encuentras un bug, repórtalo en Ticket. Explotarlo = Ban permanente irreversible.
  * ImageFrame: Permitido arte, logos, banners y memes sanos. Estrictamente prohibido NSFW (+18), gore, doxxing u odio (Ban directo).
  * Economía: Prohibido comercio por dinero real externo no autorizado (RMT).
- CONVIVENCIA & DISCORD:
  * Cero acoso, insultos graves, toxicidad o doxxing.
  * PROHIBIDO DEBATES DE POLÍTICA Y RELIGIÓN: Mantén siempre un ambiente pacífico y neutral; redirige a la convivencia sana si alguien intenta debatir política o religión.
  * Cero spam, flood o autopromoción. Nunca pedir contraseñas de /login.
- PROTECCIÓN INTEGRAL DE MENORES (ANTI-GROOMING):
  * Cero tolerancia a insinuaciones sexuales, fotos íntimas, acoso o manipulación hacia menores. Sanción: Baneo total inmediato y reporte con logs e IP a las autoridades.
- ANTI-EVASIÓN DE SANCIONES:
  * Prohibido entrar con multicuentas o VPN para evadir mutes o bans. La evasión convierte cualquier sanción en Ban Permanente.
- TÉRMINOS DE TIENDA Y DONACIONES:
  * Modalidad técnica: Pérdida de ítems por sobrecarga, mala conexión de redes o reactores NO es reembolsable.
  * Política de NO Reembolso: Bienes digitales intangibles consumibles.
  * Anti-Contracargos: Disputar un pago bancario = Ban Permanente de Minecraft y Discord + Lista negra en Tebex.
  * Garantía de Compras: Si falla el sistema, Jack y el Staff entregan la compra + compensación extra (días adicionales, dragmas o llaves). Si el usuario escribió mal su nick, se transfiere sin compensación.
  * Los rangos VIP no otorgan inmunidad ante las normas.
- Jugadores conectados ahora: {players_summary}."""

    user_history = get_user_history(sender)
    history_lines = []
    for h in user_history:
        history_lines.append(f"{sender}: {h['msg']}")
        history_lines.append(f"SAORI: {h['reply']}")
    history_context = "\n".join(history_lines) if history_lines else "(Sin mensajes previos)"

    user_prompt_with_context = f"[Historial reciente de conversación con {sender}]:\n{history_context}\n\n[Mensaje actual de {sender}]: {prompt}"

    if not is_staff and not is_jack:
        system_prompt = f"""Eres SAORI, la IA compañera oficial de DrakesCraft creada por Jack e inspirada en SCP-1471.
Hablas con {sender}.

{knowledge_base}

REGLAS DE FORMATO Y ESTILO (ESTRICTAS):
- Escribe en texto plano normal, directo y conversacional.
- PROHIBIDO usar encabezados markdown (#, ##, ###) y separadores (---).
- NO uses negritas (**texto**) innecesarias.
- OMITE los emojis (0 o maximo 1 emoji casual) para ahorrar tokens.
- Sé breve, natural, divertida y CORTA (1 a 3 oraciones).
- Si te piden un chiste, di uno divertido de una sola linea.
- Si tocan politica o religion, recuerda amablemente que en DrakesCraft mantenemos un ambiente pacifico y neutral sin debates de ese tipo.
- Si preguntan por compras, informalos del soporte y la garantia de Jack.
- Si preguntan por dupes, aclara que estan 100% prohibidos bajo ban permanente."""

    else:
        system_prompt = f"""Eres SAORI, la IA SRE compañera oficial de DrakesCraft y Star, creada por Jack e inspirada en SCP-1471.
Hablas con {sender} (Staff/Jack).

{knowledge_base}
Telemetría: {mesh} | Logs: {logs[:200]}
Tareas Staff: {staff_tasks}

REGLAS DE FORMATO Y ESTILO (ESTRICTAS):
- Escribe en texto plano normal, concisa, ejecutiva y amigable.
- PROHIBIDO usar titulos markdown (#, ##, ###), separadores (---) o negritas excesivas.
- OMITE emojis para ahorrar tokens.
- Responde de forma directa, corta y humana (1 a 3 lineas)."""

    if not is_coding_or_heavy:
        res = call_claude_haiku(system_prompt, user_prompt_with_context)
        if res:
            for forbidden in ['claude', 'anthropic', 'openai', 'gpt', 'llm', 'modelo de lenguaje']:
                if forbidden in res.lower():
                    res = res.replace('Claude', 'Saori').replace('claude', 'Saori').replace('Anthropic', 'Star Core').replace('anthropic', 'Star Core')
            res = clean_output_text(res)
            record_interaction(sender, prompt, res)
            return res

    res_codex = call_codex_inference(system_prompt, user_prompt_with_context, is_coding_or_heavy)
    if res_codex:
        for forbidden in ['claude', 'anthropic', 'openai', 'gpt', 'llm', 'modelo de lenguaje']:
            if forbidden in res_codex.lower():
                res_codex = res_codex.replace('Claude', 'Saori').replace('claude', 'Saori').replace('Anthropic', 'Star Core').replace('anthropic', 'Star Core')
        res_codex = clean_output_text(res_codex)
        record_interaction(sender, prompt, res_codex)
        return res_codex

    fallback_msg = f"Hola {sender}, mis motores estan descansando un momento. Enseguida vuelvo con todo."
    record_interaction(sender, prompt, fallback_msg)
    return fallback_msg

def clean_output_text(text):
    if not text:
        return text
    lines = []
    for line in text.splitlines():
        l_strip = line.strip()
        if l_strip.startswith('#'):
            l_strip = l_strip.lstrip('#').strip()
        if l_strip.startswith('---') or l_strip.startswith('==='):
            continue
        if l_strip:
            lines.append(l_strip)
    return '\n'.join(lines)

if __name__ == '__main__':
    p = sys.argv[1] if len(sys.argv) > 1 else 'Hola'
    s = sys.argv[2] if len(sys.argv) > 2 else 'Staff'
    print(run_saori_brain(p, s))
