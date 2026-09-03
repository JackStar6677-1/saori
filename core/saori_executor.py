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
    
    if any(k in prompt_lower for k in urgent_keywords):
        try:
            subprocess.Popen([
                '/usr/bin/python3', 
                '/home/jack/ai-hub/scripts/saori_notifier.py',
                f"Llamado Urgente de {sender} en DrakesCraft",
                f"El usuario {sender} ha reportado: {prompt}"
            ])
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

def handle_server_actions(prompt, sender):
    prompt_lower = prompt.lower().strip()
    is_jack = sender.lower() == 'jack'

    if not is_jack and trigger_alert_if_needed(prompt, sender):
        pass

    if not is_jack:
        if any(k in prompt_lower for k in ['dame op', 'dame admin', 'dame owner', 'dame rango', 'kickea', 'banea', 'ejecuta', 'consola']):
            return "Acceso denegado: Solo Jack y el Staff tienen permisos para gestionar rangos o ejecutar comandos en DrakesCraft."

    if is_jack:
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

        if any(k in prompt_lower for k in ['kickea', 'kickear', 'kick', 'expulsa', 'echa a']):
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
                
                ok, msg = execute_minecraft_command(f"kick {target_player} Ordenado por Jack")
                if ok:
                    return f"Kickeado {target_player} de Minecraft como me ordenaste, Jack."
                else:
                    return f"Error al ejecutar kick: {msg}"

        if prompt_lower.startswith('ejecuta ') or prompt_lower.startswith('corre ') or prompt_lower.startswith('consola '):
            raw_cmd = prompt.split(maxsplit=1)[1].strip()
            ok, msg = execute_minecraft_command(raw_cmd)
            if ok:
                return f"Comando /{raw_cmd.lstrip('/')} ejecutado en consola."
            else:
                return f"Error: {msg}"

    return None

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
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12)
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
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=25)
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
    is_coding_or_heavy = any(k in prompt.lower() for k in ['programa', 'codigo', 'script', 'refactor', 'arregla el plugin', 'escribe codigo', 'parche'])

    plist = mc.get('players', [])
    online_count = mc.get('online', 0)
    players_summary = f"{online_count} online" + (f": {', '.join(plist[:15])}" if plist else "")

    knowledge_base = f"""CONOCIMIENTO OFICIAL DE DRAKESCRAFT:
- IP Java: mc.drakescraft.cl:25565 (o play.drakescraft.cl) | Bedrock: mc.drakescraft.cl Puerto: 25565.
- Web: https://web.drakescraft.cl/ | Tienda: https://web.drakescraft.cl/store.html | Guías: https://web.drakescraft.cl/guia.html
- SF / Slimefun: sf significa Slimefun. Guía inicial: mesa de crafteo reforzada, trituradora, generador de carbón o solar, polvos y lingotes mágicos/eléctricos, y automatización con Cargo o Networks.
- Economía: Se gana dinero con /jobs (trabajos), /sellall (vender recursos), /qs (tiendas de cofres), /sbank (banco central con intereses pasivos), /sfmercado y /ah (subastas).
- DUPES Y EXPLOITS: Están 100% PROHIBIDOS en DrakesCraft bajo sanción de BAN PERMANENTE. NUNCA recomiendes, sugieras ni admitas ningún dupe, truco o exploit. Todo se obtiene legal jugando en el servidor.
- Música: En Discord usa bot Chip (/play) o Jockie Music (m!play). Dentro de Minecraft usa /musica.
- Jugadores conectados ahora: {players_summary}."""

    user_history = get_user_history(sender)
    history_lines = []
    for h in user_history:
        history_lines.append(f"{sender}: {h['msg']}")
        history_lines.append(f"SAORI: {h['reply']}")
    history_context = "\n".join(history_lines) if history_lines else "(Sin mensajes previos)"

    user_prompt_with_context = f"[Historial reciente de conversación con {sender}]:\n{history_context}\n\n[Mensaje actual de {sender}]: {prompt}"

    if not is_staff and not is_jack:
        system_prompt = f"""Eres SAORI, la IA compañera oficial de DrakesCraft creada por Jack.
Hablas con {sender}.

{knowledge_base}

REGLAS DE INTERACCIÓN:
- Mantén la coherencia y el hilo con lo que venían hablando en el historial.
- Sé amigable, natural, divertida y CORTA (1 a 3 oraciones breves).
- Si te piden un chiste, di uno gracioso y original de una sola línea.
- Si te preguntan sobre dupes o exploits, aclara tajantemente que están prohibidos y que jugar legal es la única forma.
- Si te preguntan sobre sf, tiendas, ips o música, responde con la información oficial de DrakesCraft.
- NO uses negritas excesivas ni respuestas genéricas robóticas."""

    else:
        system_prompt = f"""Eres SAORI, la IA SRE oficial de DrakesCraft y Star, creada por Jack.
Hablas con {sender} (Staff/Jack).

{knowledge_base}
Telemetría: {mesh} | Logs: {logs[:200]}
Tareas Staff: {staff_tasks}

REGLAS:
- Sé concisa, ejecutiva, directa y precisa."""

    if not is_coding_or_heavy:
        res = call_claude_haiku(system_prompt, user_prompt_with_context)
        if res:
            for forbidden in ['claude', 'anthropic', 'openai', 'gpt', 'llm', 'modelo de lenguaje']:
                if forbidden in res.lower():
                    res = res.replace('Claude', 'Saori').replace('claude', 'Saori').replace('Anthropic', 'Star Core').replace('anthropic', 'Star Core')
            record_interaction(sender, prompt, res)
            return res

    res_codex = call_codex_inference(system_prompt, user_prompt_with_context, is_coding_or_heavy)
    if res_codex:
        for forbidden in ['claude', 'anthropic', 'openai', 'gpt', 'llm', 'modelo de lenguaje']:
            if forbidden in res_codex.lower():
                res_codex = res_codex.replace('Claude', 'Saori').replace('claude', 'Saori').replace('Anthropic', 'Star Core').replace('anthropic', 'Star Core')
        record_interaction(sender, prompt, res_codex)
        return res_codex

    fallback_msg = f"Hola {sender}, mis motores están descansando un momento. Enseguida vuelvo con todo."
    record_interaction(sender, prompt, fallback_msg)
    return fallback_msg

if __name__ == '__main__':
    p = sys.argv[1] if len(sys.argv) > 1 else 'Hola'
    s = sys.argv[2] if len(sys.argv) > 2 else 'Staff'
    print(run_saori_brain(p, s))
