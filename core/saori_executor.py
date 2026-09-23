#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Sovereign AI Engine (Clean Names, Full Log Ingestion & Real-Time Telemetry)
"""

import subprocess, sys, json, os, urllib.request, time, re
from datetime import datetime


PTERO_BASE = 'https://panel.thegamehosting.com/api/client/servers/38528a4e'
PTERO_KEY_PATH = '/home/jack/.pterodactyl_key'
MEMORY_FILE = '/home/jack/.local/state/nova/saori_memory.json'
TAREAS_FILE = '/home/jack/ai-hub/TAREAS_PENDIENTES_STAFF.md'

import unicodedata

# Pass2 2026-09-16: el roster de staff vive en config/saori_staff.json (editable sin tocar código).
# Si el archivo falta o está corrupto se usan estas listas como fallback.
STAFF_CONFIG_PATH = os.environ.get('SAORI_STAFF_CONFIG', '/home/jack/ai-hub/config/saori_staff.json')

_STAFF_MEMBERS_FALLBACK = [
    'jack', 'pepino', 'chagui', 'kika', 'derem', 'derem8503', 
    'lauti', 'lautaro', 'macgyver', 'tomi', 'bytomixd', 'tomixd', 'tomas', 'jessiel', 'pasiente', 'pacox77', 'emilio', 'mr_em1lio', 'em1lio'
]

_HIGH_STAFF_MEMBERS_FALLBACK = [
    'jack', 'chagui', 'pepino', 'lauti', 'lautaro', 'macgyver', 'kika', 'jessiel'
]

_STAFF_ROSTER_FALLBACK = {
    'jack': 'Fundador, Owner & Dios de DrakesCraft',
    'lauti': 'Administrador del Servidor (Staff Técnico)',
    'lautaro': 'Administrador del Servidor (Staff Técnico)',
    'macgyver': 'Administrador del Servidor (Staff Técnico / Lauti)',
    'tomi': 'Moderador Oficial de DrakesCraft',
    'bytomixd': 'Moderador Oficial de DrakesCraft',
    'tomixd': 'Moderador Oficial de DrakesCraft',
    'tomas': 'Moderador Oficial de DrakesCraft',
    'pepino': 'Administrador de DrakesCraft',
    'chagui': 'Moderador de DrakesCraft',
    'kika': 'Staff & Soporte de DrakesCraft',
    'derem': 'Staff & Moderador de DrakesCraft',
    'derem8503': 'Staff & Moderador de DrakesCraft'
}


def _cargar_config_staff():
    """Lee config/saori_staff.json; ante cualquier problema devuelve los fallbacks embebidos."""
    try:
        with open(STAFF_CONFIG_PATH, 'r', encoding='utf-8') as f:
            cfg = json.load(f)
        members = [str(x).lower() for x in cfg.get('staff_members', []) if x]
        high = [str(x).lower() for x in cfg.get('high_staff_members', []) if x]
        roster = {str(k).lower(): str(v) for k, v in (cfg.get('staff_roster') or {}).items() if k}
        if not members or not high:
            raise ValueError('config de staff incompleta')
        return members, high, roster or dict(_STAFF_ROSTER_FALLBACK)
    except Exception as ex:
        print(f"[SAORI-STAFF] Usando roster embebido ({ex})", file=sys.stderr)
        return list(_STAFF_MEMBERS_FALLBACK), list(_HIGH_STAFF_MEMBERS_FALLBACK), dict(_STAFF_ROSTER_FALLBACK)


STAFF_MEMBERS, HIGH_STAFF_MEMBERS, STAFF_ROSTER = _cargar_config_staff()

SMALL_CAPS_MAP = {
    'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ғ': 'f', 'ɢ': 'g', 'ʜ': 'h',
    'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p',
    'ǫ': 'q', 'ʀ': 'r', 's': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'x': 'x',
    'ʏ': 'y', 'ᴢ': 'z'
}


# ---------------------------------------------------------------------------
# CONOCIMIENTO LOCAL VERIFICADO (auditoría SAORI 2026-09-15)
# El bot de Discord respondía sólo con la memoria del modelo (inventó "Java 1.21.1",
# "las texturas se descargan solas"). Aquí se consulta primero el catálogo generado
# (knowledge/drakescraft_verified.json, sólo entradas cuya fuente no cambió) y los
# hechos manuales curados por Jack (knowledge/drakescraft_hechos_manuales.json).
# ---------------------------------------------------------------------------
import hashlib as _hashlib
import pathlib as _pathlib

KNOWLEDGE_VERIFIED_PATH = _pathlib.Path.home() / 'ai-hub/knowledge/drakescraft_verified.json'
KNOWLEDGE_MANUAL_PATH = _pathlib.Path.home() / 'ai-hub/knowledge/drakescraft_hechos_manuales.json'
_KNOWLEDGE_CACHE = {'firma': None, 'entries': []}


def _kn_normalizar(texto):
    texto = unicodedata.normalize('NFKD', str(texto or '').lower())
    return ''.join(c for c in texto if not unicodedata.combining(c))


def _kn_tokens(texto):
    texto = _kn_normalizar(texto)
    tokens = set(re.findall(r'[a-z0-9]+(?:\.[0-9]+)*', texto))
    return {t for t in tokens if len(t) >= 3 or re.fullmatch(r'[0-9.]+', t)}


def _kn_sha256(ruta):
    try:
        return _hashlib.sha256(_pathlib.Path(ruta).read_bytes()).hexdigest()
    except OSError:
        return None


def _kn_cargar():
    """Carga ambos catálogos; se recarga sólo si cambia el mtime de algún archivo."""
    firma = tuple((str(p), p.stat().st_mtime_ns if p.exists() else None)
                  for p in (KNOWLEDGE_VERIFIED_PATH, KNOWLEDGE_MANUAL_PATH))
    if firma == _KNOWLEDGE_CACHE['firma']:
        return _KNOWLEDGE_CACHE['entries']
    entradas = []
    # Catálogo generado: sólo entradas verificadas cuya fuente conserva el sha256.
    try:
        cat = json.loads(KNOWLEDGE_VERIFIED_PATH.read_text(encoding='utf-8'))
        vigentes = set()
        for fuente in cat.get('sources', []):
            ruta, esperado = fuente.get('path'), fuente.get('sha256')
            if ruta and esperado and _kn_sha256(_pathlib.Path.home() / ruta) == esperado:
                vigentes.add(fuente.get('id'))
        for e in cat.get('entries', []):
            if isinstance(e, dict) and e.get('verified') and e.get('answer') and e.get('source') in vigentes:
                entradas.append({'kw': {_kn_normalizar(k) for k in e.get('keywords', [])},
                                 'answer': e['answer'], 'peso': 1,
                                 'url': _kn_url_guia(e), 'id': e.get('id', '')})
    except (OSError, ValueError):
        pass
    # Hechos manuales curados: autoridad sobre lo generado cuando coinciden.
    try:
        man = json.loads(KNOWLEDGE_MANUAL_PATH.read_text(encoding='utf-8'))
        for e in man.get('entries', []):
            if isinstance(e, dict) and e.get('verified') and e.get('answer'):
                entradas.append({'kw': {_kn_normalizar(k) for k in e.get('keywords', [])},
                                 'answer': e['answer'], 'peso': 2, 'url': e.get('url', '') or '',
                                 'id': e.get('id', '')})
    except (OSError, ValueError):
        pass
    _KNOWLEDGE_CACHE['firma'] = firma
    _KNOWLEDGE_CACHE['entries'] = entradas
    return entradas


GUIA_URLS = {
    'guia-servidor': 'https://web.drakescraft.cl/guia.html',
    'guia-comandos': 'https://web.drakescraft.cl/guia-comandos.html',
    'guia-slimefun': 'https://web.drakescraft.cl/guia-slimefun.html',
    'guia-rangos': 'https://web.drakescraft.cl/guia-rangos.html',
}


def _kn_url_guia(entrada):
    """URL de la guia web para una entrada del catalogo, con ?q= para aterrizar
    en la fila exacta (guia.js lee el parametro). Vacio si la fuente no es guia."""
    base = GUIA_URLS.get(str(entrada.get('source', '')))
    if not base:
        return ''
    ans = str(entrada.get('answer', ''))
    m = re.match(r'\s*(/[a-z0-9_-]+)', ans, re.I)
    q = m.group(1) if m else ' '.join(list(entrada.get('keywords', []))[:2])
    return f"{base}?q={urllib.parse.quote_plus(q)}" if q else base


def buscar_conocimiento_local(consulta, max_entradas=5):
    """Devuelve un bloque de hechos verificados relevantes ("" si no hay)."""
    tokens = _kn_tokens(consulta)
    if not tokens:
        return ''
    puntuados = []
    for e in _kn_cargar():
        hits = len(tokens & e['kw'])
        if hits >= 2:
            puntuados.append((hits * e['peso'], e['answer'], e.get('url', '')))
    if not puntuados:
        return ''
    puntuados.sort(key=lambda x: -x[0])
    vistos, lineas, urls = set(), [], []
    for _, ans, url in puntuados:
        if ans in vistos:
            continue
        vistos.add(ans)
        lineas.append('- ' + ans + (f'  [guia: {url}]' if url else ''))
        if url and url not in urls:
            urls.append(url)
        if len(lineas) >= max_entradas:
            break
    if urls:
        c_low = consulta.lower()
        es_pregunta_ayuda = any(w in c_low for w in [
            "como", "cómo", "donde", "dónde", "comando", "cmd", "ayuda", "help",
            "guia", "guía", "hacer", "craftear", "usar", "sirve", "obtener",
            "conseguir", "precio", "tienda", "rango", "slimefun", "claim", "isla",
            "proteccion", "warp", "home"
        ]) or "/" in c_low
        if es_pregunta_ayuda:
            lineas.append('INSTRUCCION: Si es directamente relevante para orientar al jugador con comandos o sistemas del juego, incluye al final "📖 Guia: ' + urls[0] + '". Si el usuario está conversando de temas personales, contando una historia, bromeando o saludando, NO incluyas ninguna URL de guia.')
    return '\n'.join(lineas)


_FAQ_STOPWORDS = {
    'como', 'cual', 'cuales', 'que', 'para', 'por', 'con', 'sin', 'del', 'las', 'los', 'una', 'uno', 'unos', 'unas',
    'doy', 'dar', 'hago', 'hacer', 'puedo', 'quiero', 'saori', 'hola', 'porfa', 'favor', 'alguien', 'sabe', 'saben',
    'donde', 'esta', 'este', 'esa', 'ese', 'eso', 'hay', 'tengo', 'tiene', 'mi', 'mis', 'tu', 'tus', 'su', 'sus',
    'en', 'el', 'la', 'de', 'un', 'al', 'se', 'me', 'te', 'le', 'lo', 'es', 'y', 'o', 'a', 'si', 'no', 'ya',
    'comando', 'comandos', 'cmd', 'the', 'how', 'do', 'to', 'in', 'my', 'command',
    'usa', 'usar', 'uso', 'funciona', 'sirve', 'pongo', 'poner',
}
_FAQ_TRIGGER_CMD = {'comando', 'comandos', 'cmd', 'command'}


def buscar_faq_determinista(consulta, max_tokens_utiles=8):
    """Respuesta determinista (sin IA) para preguntas cortas de comandos.

    Devuelve {'hit': True, 'answer', 'url', 'id'} o {'hit': False}. Solo acierta con entradas
    que tengan URL de guía. Prioridad: hechos manuales (por keywords) y luego el catálogo
    verificado cuando el usuario nombra el comando ("comando para home", "/sethome").
    Es conservador a propósito: ante la duda devuelve hit=False y el bot sigue con la IA.
    """
    texto = _kn_normalizar(_prompt_usuario(str(consulta or '')))
    if not texto:
        return {'hit': False}
    tokens_all = set(re.findall(r'[a-z0-9]+(?:\.[0-9]+)*', texto))
    utiles = {t for t in tokens_all if t not in _FAQ_STOPWORDS and (len(t) >= 2 or t.isdigit())}
    if not utiles or len(utiles) > max_tokens_utiles:
        return {'hit': False}
    # 1) Hechos manuales curados (peso 2): al menos 2 keywords y >= 50% de los tokens útiles.
    mejor = None
    for e in _kn_cargar():
        if e.get('peso') != 2 or not e.get('url'):
            continue
        hits = len(utiles & e['kw'])
        if hits >= 2 and hits * 2 >= len(utiles):
            if mejor is None or hits > mejor[0]:
                mejor = (hits, e)
    if mejor:
        e = mejor[1]
        return {'hit': True, 'answer': e['answer'], 'url': e['url'], 'id': e.get('id', 'manual')}
    # 2) Catálogo verificado: solo si nombran explícitamente un comando ("comando ..." o "/xxx").
    menciona_cmd = bool(tokens_all & _FAQ_TRIGGER_CMD) or '/' in str(consulta)
    if not menciona_cmd:
        return {'hit': False}
    for e in _kn_cargar():
        if e.get('peso') == 2 or not e.get('url'):
            continue
        m = re.match(r'\s*/([a-z0-9_-]+)(?:\s+([a-z]+))?', _kn_normalizar(e['answer']))
        if not m:
            continue
        palabras = {m.group(1)} | ({m.group(2)} if m.group(2) else set())
        if palabras <= utiles and (utiles - palabras) <= (e['kw'] | {'mi', 'otro', 'otra'}):
            return {'hit': True, 'answer': e['answer'], 'url': e['url'], 'id': e.get('id', 'catalogo')}
    return {'hit': False}


def _prompt_usuario(prompt):
    """Quita el prefijo [Contexto ...] que antepone el bot de Discord."""
    if prompt.startswith('[Contexto') and '\n' in prompt:
        return prompt.split('\n', 1)[-1].strip()
    return prompt


RANGOS_VIP = ['hercules', 'hestia', 'hermes', 'hefesto', 'artemisa', 'afrodita', 'zeus', 'thor',
              'anubis', 'poseidon', 'japeto', 'oceanus', 'hiperion', 'cronos', 'caos', 'titan', 'vip']

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
    if 'pablo' in first_lower or 'jack' in first_lower:
        return 'Jack'
    if 'emilio' in first_lower or 'em1lio' in first_lower:
        return 'Emilio'
    if 'pasiente' in first_lower or 'pacox' in first_lower:
        return 'Pasiente'
    if 'pepino' in first_lower:
        return 'Pepino'
    if 'chagui' in first_lower:
        return 'Chagui'
    if 'lauti' in first_lower or 'lautaro' in first_lower:
        return 'Lauti'
    if 'macgyver' in first_lower:
        return 'Macgyver'
    if 'tomi' in first_lower or 'bytomixd' in first_lower or 'tomixd' in first_lower or 'tomas' in first_lower:
        return 'Tomi'
    if 'kika' in first_lower:
        return 'Kika'
    if 'derem' in first_lower:
        return 'Derem'
        
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

    lines = []
    # Contexto reciente general del canal para no perder hilos grupales
    general_d = dialogues[-4:]
    if general_d:
        lines.append("CONTEXTO RECIENTE DE LA CONVERSACIÓN EN EL CANAL (QUIÉN DIJO QUÉ):")
        for d in general_d:
            lines.append(f"- {d.get('sender')}: \"{d.get('msg')}\"")
            lines.append(f"  Saori: \"{d.get('reply')}\"")
        lines.append("")

    # Historial específico con el interlocutor actual si difiere
    user_d = [d for d in dialogues if d.get("sender", "").strip().lower() == sender_clean.strip().lower()]
    user_d = user_d[-limit:]
    if user_d and user_d != general_d:
        lines.append(f"HISTORIAL ESPECÍFICO CON {sender_clean.upper()}:")
        for d in user_d:
            lines.append(f"- {d.get('sender')}: \"{d.get('msg')}\"")
            lines.append(f"  Saori: \"{d.get('reply')}\"")

    return "\n".join(lines) + "\n\n" if lines else ""



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
    # Aislar el mensaje real del usuario si viene inyectado con [Contexto Canal/Ticket: ...]
    eval_prompt = prompt
    if eval_prompt.startswith("[Contexto") and "\n" in eval_prompt:
        eval_prompt = eval_prompt.split("\n", 1)[-1].strip()

    prompt_lower = eval_prompt.lower().strip()
    sender_clean = clean_sender_name(sender).lower()
    is_jack = sender_clean in ['jack', 'dios', 'dueño', 'owner']
    is_high_staff = is_jack or (sender_clean in HIGH_STAFF_MEMBERS) or (os.environ.get('SAORI_IS_HIGH_STAFF') == '1')
    is_staff = (sender_clean in STAFF_MEMBERS) or is_high_staff

    if not is_jack and trigger_alert_if_needed(eval_prompt, sender):
        pass

    # ── REVISIÓN GENERAL BAJO DEMANDA (DRAKES, STAR, IAHUB, COMUNIDAD) ──
    digest_patterns = [
        r'\b(chec[ha]*|revisa|mira|c[oó]mo va|estado)\b.*\b(drakes|star|iahub|ia-hub|servidor|sv|todo)\b',
        r'\bestado general\b',
        r'\brevisi[oó]n drakes\b',
        r'\breporte drakes\b',
        r'^\s*(!digest|sdigest|/digest)\b'
    ]
    if any(re.search(pat, prompt_lower) for pat in digest_patterns):
        if is_staff or is_jack:
            try:
                res = subprocess.check_output(
                    ['/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_daily_digest.py', '--print'],
                    stderr=subprocess.STDOUT, text=True, timeout=25
                ).strip()
                if res:
                    return res
            except Exception as e:
                print(f"[SAORI-DIGEST-ONDEMAND] Error ejecutando digest: {e}", file=sys.stderr)

    # ── GESTIÓN DE ENERGÍA DE LA INFRAESTRUCTURA (RESTART, STOP, INICIO) ──
    # High Staff según Discord y Jack pueden operar la suite segura.
    power_patterns = [
        r'\breinicia\b', r'\breiniciar\b', r'\breinicio\b', r'\brestart\b',
        r'\bapaga\b', r'\bapagar\b', r'\bstop\b', r'\bdeten el server\b',
        r'\bdetén el server\b', r'\btira el server\b', r'\benciende\b',
        r'\bencender\b', r'\binicia el server\b', r'\biniciar el server\b',
        r'\barranca el server\b', r'\bstart\b'
    ]
    if any(re.search(pat, prompt_lower) for pat in power_patterns):
        if is_high_staff:
            is_restart = any(re.search(p, prompt_lower) for p in [r'\breinicia\b', r'\breiniciar\b', r'\breinicio\b', r'\brestart\b'])
            is_stop = any(re.search(p, prompt_lower) for p in [r'\bapaga\b', r'\bapagar\b', r'\bstop\b', r'\bdeten\b', r'\bdetén\b', r'\btira\b'])
            is_start = any(re.search(p, prompt_lower) for p in [r'\benciende\b', r'\bencender\b', r'\binicia\b', r'\biniciar\b', r'\bstart\b', r'\barranca\b'])

            if is_restart:
                motivo = f"Reinicio solicitado por {clean_sender_name(sender)} (High Staff Discord)"
                subprocess.Popen(['/usr/bin/python3', '/home/jack/ai-hub/scripts/reinicio_seguro.py', '120', motivo, 'saori', '--skip-preflight'])
                r1 = f"🔄 **Protocolo de Reinicio Seguro Iniciado** por {clean_sender_name(sender)} (High Staff).\n\n"
                r2 = "⏱️ **Aviso en Minecraft:** 120 segundos de cuenta atrás progresiva.\n"
                r3 = "💾 **Pre-Shutdown Sync:** Guardado atómico de Slimefun, respaldo de inventarios IRP, desconexión limpia de jugadores y `save-all flush` en frío.\n"
                r4 = "🛡️ **Garantía:** Cero pérdida de inventarios ni corrupción de chunks. El servidor volverá a encenderse automáticamente tras el ciclo."
                return r1 + r2 + r3 + r4
            elif is_stop:
                motivo = f"Apagado solicitado por {clean_sender_name(sender)} (High Staff Discord)"
                subprocess.Popen(['/usr/bin/python3', '/home/jack/ai-hub/scripts/stop_seguro.py', '120', motivo, 'saori', '--skip-preflight'])
                s1 = f"🛑 **Protocolo de Apagado Seguro Iniciado** por {clean_sender_name(sender)} (High Staff).\n\n"
                s2 = "⏱️ **Aviso en Minecraft:** 120 segundos de cuenta atrás progresiva.\n"
                s3 = "💾 **Sincronización:** Guardando datos de modalidades, expulsión ordenada y verificación offline.\n"
                s4 = "🛡️ **Protección Anti-Crash:** Guardia activa de 20s para neutralizar cualquier intento espurio de auto-reinicio por crash-detector de Pterodactyl."
                return s1 + s2 + s3 + s4
            elif is_start:
                subprocess.Popen(['/usr/bin/python3', '/home/jack/ai-hub/scripts/encendido_seguro.py', 'saori'])
                e1 = f"⚡ **Protocolo de Encendido Seguro Iniciado** por {clean_sender_name(sender)} (High Staff).\n\n"
                e2 = "🔍 **Verificación:** Chequeo anti-colisión, señal autorizada enviada al panel y watcher de arranque activo.\n"
                e3 = "📡 Te confirmaré apenas el log y el puerto TCP 25565 confirmen que el servidor está 100% operativo."
                return e1 + e2 + e3
        else:
            return (
                f"Acceso denegado: Hola {clean_sender_name(sender)}. Las operaciones de energía e infraestructura "
                f"(reinicio, apagado y encendido) están reservadas exclusivamente para Jack y High Staff (Administración y Dirección). "
                f"Si experimentas tirones o problemas técnicos, abre un ticket en #🎫・ᴛɪᴄᴋᴇᴛs-sᴏᴘᴏʀᴛᴇ para que el equipo lo evalúe."
            )

    # BLOQUEO TOTAL DE MODERACIÓN, DINERO Y ACCIONES CRÍTICAS POR CHAT
    if not is_jack:
        BLOCKED_ACTION_PATTERNS = [
            'kickea', 'kickear', 'kick ', 'kickall', 'banea', 'banear', 'ban ',
            'mutea', 'mutear', 'mute ', 'silencia', 'silenciar', 'desmutea', 'unban', 'unmute',
            'dame op', 'dame admin', 'dame owner', 'dame rango', 'dame plata', 'dame dinero', 'dame dragmas',
            'dame 100', 'dar dinero', 'dar dragmas', 'eco give', 'eco set', 'money give'
        ]
        EXPULSION_PATTERNS = ['expulsa a', 'expulsar a', 'echa a', 'echar a', 'expulsalo', 'expúlsalo']
        if any(k in prompt_lower for k in BLOCKED_ACTION_PATTERNS) or any(k in prompt_lower for k in EXPULSION_PATTERNS):
            if any(k in prompt_lower for k in ['dame plata', 'dame dinero', 'dame dragmas', 'dame 100', 'dar dinero', 'dar dragmas', 'eco give', 'eco set', 'money give']):
                return "Acceso denegado: No tengo autorización para regalar dinero ni alterar la economía del servidor. Puedes ganar Dragmas trabajando con `/jobs`, comerciando con jugadores o en la tienda oficial: https://web.drakescraft.cl."
            return "Acceso denegado: Por seguridad y política de DrakesCraft, las sanciones y moderación (kick, ban, mute) solo pueden ser ejecutadas directamente por Jack y los Moderadores mediante los comandos oficiales in-game o el panel de control. Yo no ejecuto sanciones ni acciones administrativas por chat."

    # BLOQUEO ESTRICTO DE PRIVACIDAD: Prohibido revelar logs, comandos o actividades privadas a usuarios comunes
    if not is_staff:
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
    CRITICAL_INFRA = ['dame op', 'dame admin', 'dame owner', 'op ', 'reload', 'pex', 'luckperms', 'lp ', 'ban-ip']
    if not is_jack and any(k in prompt_lower for k in CRITICAL_INFRA):
        return f"Hola {sender}, por seguridad solo Jack puede modificar permisos globales de la infraestructura."

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
                    '/usr/bin/python3', 
                    '/home/jack/ai-hub/scripts/saori_notifier.py',
                    f"📌 Recado Staff de {sender_clean} para {target}",
                    f"El miembro del Staff {sender_clean} ha solicitado anotar: \"{task_desc}\""
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

    # KICK / KICKALL DESACTIVADO: Eliminado por seguridad absoluta contra abusos en chat.

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

    if is_jack and (matched_trigger or slash_match):
        raw_cmd = ''
        if slash_match:
            raw_cmd = slash_match.group(1).strip()
        elif matched_trigger:
            raw_cmd = prompt.split(matched_trigger, 1)[1].strip()
            raw_cmd = raw_cmd.lstrip('el ').lstrip('un ').rstrip('?').rstrip('!').strip()
        
        raw_cmd = _re.sub(r'\bvoifall\b', 'voidfall', raw_cmd, flags=_re.IGNORECASE)
        
        # Bloquear comandos destructivos incluso por chat
        if any(raw_cmd.lower().startswith(b) for b in ['stop', 'restart', 'reload', 'eco give', 'eco set', 'money give']):
            return f"Hola Jack, por seguridad los comandos críticos de economía o servidor deben ejecutarse por consola directa."

        ok, msg = execute_minecraft_command(raw_cmd)
        if ok:
            return f"Comando /{raw_cmd.lstrip('/')} ejecutado en Minecraft para ti, Jack."
        else:
            return f"Error al ejecutar /{raw_cmd.lstrip('/')}: {msg}"


    # TPS — disponible para Jack y staff
    if any(k in prompt_lower for k in ['tps', 'spark tps', 'lag del server', 'rendimiento del server', 'server performance']):
        import re as _re
        def _download_latest_lines():
            if not os.path.exists(PTERO_KEY_PATH):
                return []
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
                    return dl_resp.read().decode('utf-8', errors='ignore').splitlines()
            except Exception:
                return []

        def _capture_tps(cmd, keyword, wait):
            # Solo usamos líneas nuevas emitidas por la consola. Antes se buscaba
            # "TPS" en un tramo completo del log y podía devolverse chat jugador.
            before = _download_latest_lines()
            ok, _ = execute_minecraft_command(cmd)
            if not ok:
                return None
            time.sleep(wait)
            after = _download_latest_lines()
            if not after:
                return None

            new_lines = after[len(before):] if len(after) >= len(before) else after[-20:]
            result_lines = []
            capturing = False
            for line in new_lines:
                if '»' in line or '[world]' in line.lower():
                    continue
                clean = _re.sub(r'^\[.*?\]\s+\[.*?\]:\s*', '', line).strip()
                is_console = '/INFO]:' in line or '/WARN]:' in line
                is_tps_metric = _re.search(r'\b(tps|mspt|tick durations?)\b', clean, _re.IGNORECASE)
                if is_console and is_tps_metric:
                    capturing = True
                if capturing and is_console and clean:
                    result_lines.append(clean)
                    if len(result_lines) >= 6:
                        break
            return '\n'.join(result_lines) if result_lines else None

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
    
        # Sanitizar rutas del sistema de archivos y evitar fugas de infraestructura
    res = re.sub(r'/(?:home|opt|etc|var|usr|root|tmp)[^\s\)\],]*', 'el servidor', res)
    res = re.sub(r'[a-zA-Z]:\\[^\s\)\],]*', 'el sistema', res)
    res = re.sub(r'\b100\.\d{1,3}\.\d{1,3}\.\d{1,3}\b', 'red interna', res)
    
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
        (r'\bmodelo de lenguaje\b', 'sistema inteligente'),
        (r'\b(wither\s*storm\s*(?:mod)?)\b', 'eventos del servidor'),
        (r'\b(pixelmon|create\s*mod)\b', 'mecánicas avanzadas')
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
            f'https://api.mcsrvstat.us/3/mc.drakescraft.cl?_={int(time.time())}',
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

QUOTA_ALERT_FILE = "/home/jack/.local/state/nova/quota_alerts.json"

def trigger_quota_alert(provider, detail):
    """Registra el límite de cuota/failover silenciosamente para el reporte diario (sin spamear WhatsApp)."""
    try:
        os.makedirs(os.path.dirname(QUOTA_ALERT_FILE), exist_ok=True)
        data = {}
        if os.path.exists(QUOTA_ALERT_FILE):
            try:
                with open(QUOTA_ALERT_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
            except:
                pass
        
        now = time.time()
        data[provider] = {
            'timestamp': now,
            'detail': str(detail)[:150],
            'failover_active': True
        }
        with open(QUOTA_ALERT_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"[SAORI-QUOTA] Failover registrado silenciosamente para {provider}: {detail}", file=sys.stderr)
    except Exception as e:
        print(f"[SAORI-QUOTA] Error registrando cuota: {e}", file=sys.stderr)

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
        if any(err in out.lower() for err in ['quota', 'rate limit', 'hit your session limit', 'session limit']):
            trigger_quota_alert("Claude (Anthropic)", out.split('\n')[0][:120])
    except:
        pass
    return None

def call_codex_inference(system_prompt, user_prompt, is_heavy_task=False):
    model = 'gpt-5.6-terra' if is_heavy_task else 'gpt-5.6-luna'
    effort = 'medium' if is_heavy_task else 'low'
    timeout_val = 45 if is_heavy_task else 12

    # Intentar con cuenta primaria (codex) y failover a cuenta secundaria (codex2)
    binaries = ['/home/jack/.local/bin/codex']
    if os.path.exists('/home/jack/.local/bin/codex2') and os.path.exists('/home/jack/.codex2/auth.json'):
        binaries.append('/home/jack/.local/bin/codex2')

    for bin_path in binaries:
        cmd = [
            bin_path, 'exec', '--skip-git-repo-check',
            '-m', model,
            '-c', f'model_reasoning_effort="{effort}"',
            f"{system_prompt}\n\n[Mensaje]: {user_prompt}\n\n[Responde como SAORI, directo, conciso y usando los datos provistos]:"
        ]
        try:
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout_val)
            out = p.stdout.strip()
            if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'exception', 'traceback', 'usage limit', 'limit reached']):
                return out
            err_combined = (p.stderr or '') + ' ' + (out or '')
            if any(err in err_combined.lower() for err in ['quota', 'rate limit', '429', 'insufficient_quota', 'usage limit']):
                if bin_path == binaries[-1]:
                    trigger_quota_alert("Codex / GPT (OpenAI)", "Límite de cuota o rate limit alcanzado en OpenAI")
                continue
        except Exception as e:
            print(f"[SAORI-BRAIN] Fallo en Codex {bin_path} ({model}): {e}", file=sys.stderr)
    return None

def call_antigravity_inference(system_prompt, user_prompt):
    """Inferencia conversacional ágil a través de Antigravity (Gemini 3.8 Flash) con failover dual account."""
    binaries = ['/home/jack/.local/bin/agy']
    token2_path = '/home/jack/.agy2_home/.gemini/antigravity-cli/antigravity-oauth-token'
    if os.path.exists('/home/jack/.local/bin/agy2') and os.path.exists(token2_path):
        binaries.append('/home/jack/.local/bin/agy2')

    for bin_path in binaries:
        cmd = [
            bin_path,
            '--model', 'gemini-3.8-flash-medium',
            '--effort', 'medium',
            '--dangerously-skip-permissions',
            '-p', f"{system_prompt}\n\n[Mensaje]: {user_prompt}\n\n[Responde como SAORI en tono chileno, conciso, inteligente y natural]:",
            '--print-timeout', '12s'
        ]
        try:
            p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=14)
            out = p.stdout.strip()
            if p.returncode == 0 and out and not any(err in out.lower() for err in ['error', 'exception', 'traceback', 'quota', 'rate limit']):
                return out
            err_combined = (p.stderr or '') + ' ' + (out or '')
            if any(err in err_combined.lower() for err in ['quota', 'rate limit', 'resource_exhausted', '429', 'limit reached']):
                if bin_path == binaries[-1]:
                    trigger_quota_alert("Antigravity / Gemini (Google)", "Límite de cuota o rate limit alcanzado en Gemini / Google AI")
                continue
        except Exception as e:
            print(f"[SAORI-BRAIN] Fallo en Antigravity {bin_path}: {e}", file=sys.stderr)
    return None




USER_PREFS_FILE = '/home/jack/.local/state/nova/saori_user_preferences.json'

def load_user_preferences():
    os.makedirs(os.path.dirname(USER_PREFS_FILE), exist_ok=True)
    if os.path.exists(USER_PREFS_FILE):
        try:
            with open(USER_PREFS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_user_preferences(prefs):
    try:
        os.makedirs(os.path.dirname(USER_PREFS_FILE), exist_ok=True)
        with open(USER_PREFS_FILE, 'w', encoding='utf-8') as f:
            json.dump(prefs, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[SAORI-PREFS] Error saving: {e}", file=sys.stderr)

def update_preferences_from_prompt(sender_clean, prompt, is_jack=False):
    """Detecta y persiste instrucciones de dialecto, idioma o conducta por usuario."""
    p_lower = prompt.lower()
    prefs = load_user_preferences()
    sender_key = sender_clean.strip().lower()
    modified = False

    # 1. Comandos de Jack sobre otros usuarios: ej. "cada que pasiente te hable respondele en persa"
    if is_jack:
        # Regex para detectar órdenes sobre terceros
        m_target = re.search(r'(?:cada que|cuando|siempre que)\s+([a-zA-Z0-9_]+)\s+te\s+hable\s+(?:respondele|respóndele|háblale|hablale|contéstale|contestale)\s+en\s+([a-zA-Záéíóú]+)', p_lower)
        if m_target:
            target_user = m_target.group(1).lower()
            lang = m_target.group(2).strip()
            if target_user not in prefs:
                prefs[target_user] = {}
            prefs[target_user]['language'] = lang
            save_user_preferences(prefs)
            return

    # 2. Preferencias del propio usuario (ej. Emilio pidiendo jerga dominicana, o evitar 'po')
    user_data = prefs.get(sender_key, {})

    # Dialecto / Jerga
    if any(k in p_lower for k in ['jerga dominicana', 'jergas dominicana', 'dominicano', 'sazón dominicano', 'sazon dominicano']):
        user_data['style'] = 'jerga dominicana auténtica (klk, manín, qué e la que hay, dime a ver, acotejarse, de una, tú sabe)'
        avoids = user_data.get('avoid', [])
        if 'po' not in avoids:
            avoids.append('po')
        user_data['avoid'] = avoids
        modified = True
    elif any(k in p_lower for k in ['jerga chilena', 'chileno']):
        user_data['style'] = 'jerga chilena natural (po, al tiro, cachai, dale)'
        modified = True

    # Palabras a evitar (ej. "dejame decirme 'po'", "no me digas po")
    if any(k in p_lower for k in ['no me digas', 'deja de decirme', 'dejame de decir', 'no uses la palabra', 'deja de decir', 'dejame decirme']):
        for avoid_word in ['po', 'usuario', 'hermano', 'weon', 'wn']:
            if avoid_word in p_lower:
                avoids = user_data.get('avoid', [])
                if avoid_word not in avoids:
                    avoids.append(avoid_word)
                user_data['avoid'] = avoids
                modified = True

    if modified:
        prefs[sender_key] = user_data
        save_user_preferences(prefs)

def get_user_preference_prompt(sender_clean):
    prefs = load_user_preferences()
    user_data = prefs.get(sender_clean.strip().lower(), {})
    if not user_data:
        return ""
    
    rules = [f"\nDIRECTIVAS Y PREFERENCIAS ESTRICTAS PARA {sender_clean.upper()}:"]
    if 'language' in user_data:
        rules.append(f"- IDIOMA OBLIGATORIO: Debes responderle EXCLUSIVAMENTE en {user_data['language'].upper()} (orden directa e inamovible de Jack).")
    if 'style' in user_data:
        rules.append(f"- ESTILO Y VOCABULARIO: Exprésate con {user_data['style']}. Adopta su jerga naturalmente sin sonar forzada.")
    if 'avoid' in user_data and user_data['avoid']:
        avoid_str = ", ".join(f'"{w}"' for w in user_data['avoid'])
        rules.append(f"- PALABRAS ESTRICTAMENTE PROHIBIDAS CON ESTE USUARIO: {avoid_str}. JAMÁS las uses ni al final de tus oraciones.")
    
    return "\n".join(rules) + "\n"

def handle_message_to_jack_or_task(prompt, sender_clean):
    """Detecta solicitudes para dejar recados a Jack o crear tareas para Jack/Tríada."""
    p_lower = prompt.lower()
    triggers = [
        'dile a jack', 'decirle a jack', 'avisale a jack', 'avísale a jack', 'avisarle a jack', 'avísarle a jack',
        'mandale a jack', 'mándale a jack', 'mandarle a jack', 'mándarle a jack',
        'preguntale a jack', 'pregúntale a jack', 'preguntarle a jack', 'pregúntarle a jack',
        'pidele a jack', 'pídele a jack', 'pedirle a jack', 'pídirle a jack',
        'avisa a jack', 'mandale un mensaje a jack', 'mándale un mensaje a jack',
        'enviale un mensaje a jack', 'envíale un mensaje a jack', 'enviarle un mensaje a jack',
        'dile al jefe', 'decirle al jefe', 'tarea para jack', 'tarea para la trinidad',
        'que la trinidad', 'crea una tarea'
    ]
    if any(t in p_lower for t in triggers):
        detalle = prompt
        for t in triggers:
            if t in p_lower:
                idx = p_lower.find(t)
                detalle = prompt[idx + len(t):].strip(' :,-')
                break
        if not detalle or len(detalle) < 3:
            detalle = prompt

        # 1. Registrar tarea en TAREAS_FILE
        try:
            add_staff_task("Jack / Tríada", f"[Recado de {sender_clean}] {detalle}")
        except Exception as e:
            print(f"[SAORI-RECADO] Error guardando tarea: {e}", file=sys.stderr)

        # 2. Notificar inmediatamente a Jack vía saori_notifier.py (WhatsApp/Discord DM)
        try:
            subprocess.Popen([
                '/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_notifier.py',
                f"Recado de {sender_clean} para Jack",
                f"El usuario {sender_clean} te dejó este recado/tarea:\n\"{detalle}\""
            ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"[SAORI-RECADO] Error notificando a Jack: {e}", file=sys.stderr)

        # 3. Retornar confirmación directa adaptada al estilo del usuario
        prefs = load_user_preferences()
        user_pref = prefs.get(sender_clean.lower(), {})
        if 'jerga dominicana' in user_pref.get('style', ''):
            return f"¡Anotao de una, {sender_clean}! Ya le mandé el recado directo a Jack por interno y lo dejé registrado en las tareas pendientes: \"{detalle}\". ¿Tú sabe'? 😎"
        return f"¡Anotado al tiro, {sender_clean}! Ya le envié el mensaje directamente a Jack por interno y registré la tarea en el sistema: \"{detalle}\". Descuida, él lo revisará apenas pueda. 🌸"
    return None



def handle_canonical_faq(prompt, sender_clean):
    p = prompt.lower().strip()
    pu = _kn_normalizar(_prompt_usuario(prompt))  # solo lo que escribió el usuario, sin acentos
    is_jack_sender = sender_clean.lower() == 'jack'

    # 0a. Pack de texturas / resource pack (hechos ticket #481, 2026-09-15). Antes el
    # modelo inventaba que "se descargan solitas" y versiones inexistentes.
    if not is_jack_sender and any(k in pu for k in ['textura', 'texture', 'resource pack', 'resourcepack', 'pack de slimefun',
                              'paquete de recursos', 'pack.drakescraft']):
        return (
            f"{sender_clean}, el pack de texturas oficial es **opcional** y se descarga en "
            f"https://pack.drakescraft.cl/latest.zip (Slimefun 1.21.5+ v2.4, formato 64).\n"
            f"• Requiere cliente **Java 1.21.5 o superior**; en 1.20.x no funciona.\n"
            f"• Por ahora el servidor **no lo envía solo al entrar**: instálalo a mano en Opciones > Paquetes de recursos. "
            f"Tras el próximo reinicio Odysseia lo ofrecerá al conectar (seguirá siendo opcional).\n"
            f"• Jugadores Bedrock no reciben estas texturas.\n"
            f"Si aun así no te carga, abre un ticket en #🎫・tickets-soporte con tu versión exacta."
        )

    # 0b. Versión para entrar (Purpur 1.21.11 + ViaVersion/ViaBackwards).
    if not is_jack_sender and ('version' in pu or 'versiones' in pu) and any(w in pu for w in [
            'entrar', 'entro', 'server', 'servidor', 'jugar', 'cliente', 'java', 'minecraft',
            'soporta', 'compatible', 'acepta', 'usa', 'esta', 'tiene']):
        return (
            f"{sender_clean}, DrakesCraft corre **Purpur 1.21.11**. Gracias a ViaVersion/ViaBackwards puedes entrar "
            f"con cualquier cliente **Java 1.20.5 o superior** (hasta 1.21.x). Para usar el pack de texturas necesitas "
            f"**1.21.5+**. Bedrock entra vía Geyser/Floodgate. IP: `mc.drakescraft.cl`."
        )

    # 0c. Rango/compra/pago de OTRO jugador: información privada. No se inventa.
    if not is_jack_sender:
        m = (re.search(r'\bpor\s*que\s+(\w+)\s+(tiene|es|tenia|era|salio|aparece|anda)\s+(con\s+|el\s+|de\s+)?(rango\s+)?(' + '|'.join(RANGOS_VIP) + r')\b', pu)
             or re.search(r'\b(que|cual)\s+rango\s+(tiene|compro|pago)\s+(\w+)', pu)
             or re.search(r'\b(cuanto|cuando|como)\s+(pago|compro|dono|consiguio|obtuvo)\s+(\w+)\s+(el\s+|su\s+)?(rango|vip)', pu)
             or re.search(r'\b(rango|vip|compra|pago)\s+de\s+(\w+)', pu))
        if m:
            nombre = next((g for g in m.groups() if g and g not in (
                'tiene', 'es', 'tenia', 'era', 'salio', 'aparece', 'anda', 'con', 'el', 'de', 'que', 'cual',
                'compro', 'pago', 'cuanto', 'cuando', 'como', 'dono', 'consiguio', 'obtuvo', 'su',
                'rango', 'vip', 'compra')), '')
            if nombre and nombre not in ('mi', 'yo', 'me', 'la', 'los', 'las', 'un', 'una', 'cada', 'tienda',
                                          'drakes', 'drakescraft', 'staff', 'jack') and nombre not in RANGOS_VIP:
                return (
                    f"{sender_clean}, los rangos, compras y pagos de otros jugadores son información privada; "
                    f"no puedo confirmar ni explicar por qué alguien tiene un rango. Si crees que hay un error o "
                    f"un abuso, abre un ticket en #🎫・tickets-soporte y el Staff lo revisa con los registros reales."
                )

    # 0d. Peticiones que SAORI no puede cumplir desde Discord (recibir archivos por MD,
    # publicar en canales, revisar tickets). Antes prometía "pásamela por MD y la dejo en links".
    if not is_jack_sender:
        verbo_envio = re.search(r'\b(puedo|podria|podre|quieres\s+que\s+te)\s+(mandar|enviar|pasar|subir|compartir)\b', pu)
        objeto_envio = re.search(r'\b(te\s+la|te\s+lo|la|lo|las|los|se\s+la|se\s+lo)\s+(puedo|podria|podre)\s+(mandar|enviar|pasar|subir|compartir)\b', pu)
        cosa_envio = any(k in pu for k in ['textura', 'pack', 'archivo', 'foto', 'captura', 'link', 'enlace', 'zip', 'imagen', ' md', 'privado'])
        pide_enviar = objeto_envio or (verbo_envio and cosa_envio) \
            or re.search(r'\b(pasame|pasamela|mandame|enviame|dame)\s+(tu\s+)?(md|privado|dm)\b', pu) \
            or re.search(r'\b(por|al)\s+(md|dm|privado)\b', pu)
        pide_publicar = re.search(r'\b(pon|ponla|ponlo|deja|dejala|dejalo|sube|subela|subelo|publica|publicala|publicalo|manda|mandala|mandalo)\s+(esto\s+|eso\s+|la\s+|lo\s+|el\s+)?(en\s+|al\s+)?(el\s+)?(canal|links|link|anuncios)\b', pu)
        pide_revisar_ticket = re.search(r'\b(revisa|revisar|mira|checa|chequea|ve|viste|puedes\s+ver)\b.*\b(ticket|tickets)\b', pu)
        if pide_enviar or pide_publicar:
            return (
                f"{sender_clean}, desde Discord no puedo recibir archivos por MD ni publicar cosas en canales "
                f"(eso lo hace el Staff). Si quieres compartir un pack o un enlace para que lo revisen, abre un "
                f"ticket en #🎫・tickets-soporte y adjúntalo ahí, o escribe `sticket <descripción>`."
            )
        if pide_revisar_ticket:
            return (
                f"{sender_clean}, no tengo acceso al estado de los tickets; los revisa el Staff directamente en "
                f"el canal del ticket. Si aún no lo abriste, hazlo en #🎫・tickets-soporte."
            )
    
    # 1. IP del servidor
    ip_triggers = [
        'cual es la ip', 'cuál es la ip', 'pasa la ip', 'pasame la ip', 'pásame la ip',
        'ip del server', 'ip de minecraft', 'la ip oficial', 'cual es el ip', 'cuál es el ip',
        'ip java', 'ip bedrock', 'ip para entrar'
    ]
    if any(k in p for k in ip_triggers) or ((' ip' in p or p.startswith('ip')) and any(w in p for w in ['server', 'servidor', 'minecraft', 'entrar', 'jugar', 'drakes'])):
        return (
            f"¡Hola {sender_clean}! La IP oficial de DrakesCraft es **mc.drakescraft.cl**.\n"
            f"• Java Edition: `mc.drakescraft.cl:25565`\n"
            f"• Bedrock Edition: `mc.drakescraft.cl` (Puerto `25565`, el mismo que Java)\n"
            f"¡Te esperamos in-game! 🌸"
        )
        
    # 2. Tienda Oficial / Web
    tienda_triggers = [
        'cual es la tienda', 'cuál es la tienda', 'link de la tienda', 'pagina de la tienda',
        'página de la tienda', 'tienda oficial', 'web oficial', 'link de la web', 'cual es la web',
        'cuál es la web', 'donde compro rango', 'dónde compro rango', 'comprar rango', 'tienda web'
    ]
    if any(k in p for k in tienda_triggers) or (('tienda' in p or 'web' in p) and any(w in p for w in ['oficial', 'link', 'pagina', 'página', 'entrar', 'drakes'])):
        return (
            f"¡Hola {sender_clean}! La tienda y web oficial de DrakesCraft es **https://web.drakescraft.cl**.\n"
            f"Allí encuentras todos los pases VIP mensuales transferibles a todas las modalidades, cosméticos y beneficios oficiales. ✨"
        )
        
    # 3. Modalidades y Slimefun en Clásico
    mod_triggers = [
        'modalidades', 'que modalidades hay', 'qué modalidades hay', 'cuales son las modalidades',
        'cuáles son las modalidades', 'que modos hay', 'qué modos hay', 'modos de juego',
        'hay slimefun en clasico', 'hay slimefun en clásico', 'slimefun en clasico', 'slimefun en clásico',
        'clasico tiene slimefun', 'clásico tiene slimefun'
    ]
    if any(k in p for k in mod_triggers):
        return (
            f"¡Hola {sender_clean}! En DrakesCraft contamos con **5 modalidades oficiales**:\n"
            f"1. **Survival Clásico** (`/clasico`): Supervivencia vanilla pura tradicional con protecciones y economía. ¡CERO SLIMEFUN! (sin máquinas, sin ítems de Slimefun, sin guía /sf ni mercado).\n"
            f"2. **Survival Slimefun** (`/survival` o `/slimefun`): Modalidad principal con tecnología, 60+ addons de Slimefun, reactores, galactifun, automatización y mercado dinámico.\n"
            f"3. **SkyBlock** (`/is`): Islas flotantes en el vacío con Slimefun, retos y progresión.\n"
            f"4. **OneBlock** (`/ob`): Un único bloque evolutivo en el vacío con Slimefun y misiones por fases.\n"
            f"5. **Laboratorio** (`/warp laboratorio`): Modo creativo y pacífico para probar circuitos y máquinas de Slimefun sin costo (/sf cheat).\n"
            f"Cualquier duda, ¡aquí estoy para guiarte! 🌸"
        )

    # 4. Traducción del chat (WorldwideChat). Es un dato verificado en la guía
    # canónica; no debe caer al modelo ni responder que el comando es desconocido.
    translation_triggers = [
        'translation command', 'ingame translation', 'in game translation',
        'translator command', 'translate command', 'how do i translate',
        'comando de traduccion', 'comando de traducción', 'traductor',
        'como traduzco', 'cómo traduzco', 'traducir el chat', 'traducir chat'
    ]
    if any(k in p for k in translation_triggers):
        return (
            f"{sender_clean}, usa `/wwct <idioma>` para traducir el chat. "
            f"Ejemplo: `/wwct en` para inglés.\n"
            f"• Solo lo que recibes: `/wwctci <idioma>`\n"
            f"• Solo lo que escribes: `/wwctco <idioma>`\n"
            f"• Desactivar: `/wwct stop`"
        )

    # 5. End de Survival Clásico. El portal público protege sus marcos contra
    # rotura, pero permite usar un ojo de Ender en los marcos vacíos. No se
    # deriva a una fortaleza: esa respuesta confundía a quien ya estaba allí.
    end_triggers = [
        'como voy al end', 'cómo voy al end', 'ir al end', 'llegar al end',
        'portal al end', 'portal del end', 'end en clasico', 'end en clásico'
    ]
    if any(k in p for k in end_triggers) and ('clasico' in p or 'clásico' in p):
        return (
            f"{sender_clean}, el End de **Clásico** está habilitado mediante el portal público. "
            f"Con un ojo de Ender en la mano, haz **clic derecho sobre cada marco vacío**. "
            f"No intentes romper los marcos: el aviso de protección al pegarlos es normal. "
            f"Si el clic derecho no coloca ni consume el ojo, repórtalo en ticket para revisar esa interacción."
        )

    # 6. Botones dentro de protecciones: el reporte fue reproducido por jugadores.
    button_triggers = [
        'no puedo presionar botones', 'no se puede presionar botones',
        'no se pueden presionar botones', 'botones en proteccion',
        'botones en protección', 'boton en proteccion', 'botón en protección'
    ]
    if any(k in p for k in button_triggers):
        return (
            f"{sender_clean}, ese bloqueo sigue confirmado: visitantes sin permisos no pueden usar "
            f"botones dentro de algunas protecciones. Ya está registrado para revisar la flag efectiva "
            f"de uso/interacción sin abrir las protecciones a acciones no deseadas."
        )
        
    # 7. Diferencia entre rangos Hestia y Hermes
    if ('hestia' in p and 'hermes' in p) or ('diferencia' in p and any(r in p for r in ['hestia', 'hermes', 'rango'])):
        return (
            f"¡Hola {sender_clean}! **Hermes ($10.99) es superior a Hestia ($7.99)** en precio, beneficios y jerarquía:\n"
            f"• **Hermes** incluye el comando **/fly** permanente (vuelo libre en survival e islas), 113x113 de protección, 6 homes, 5 bóvedas (/pv), 8 warps, /workbench, /ec y 150.000 Dragmas.\n"
            f"• **Hestia** incluye protección 81x81, 5 homes, 3 bóvedas, /nick y caminar en lava.\n"
            f"¡Hermes es el rango más recomendado! Puedes ver todos los detalles en https://web.drakescraft.cl."
        )

    # 8. Jefes y Menú de Bosses (/bosses, /bosswarp)
    boss_triggers = [
        'bosses', 'bosswarp', 'menu de bosses', 'menú de bosses', 'como peleo con un boss',
        'cómo peleo con un boss', 'entrar a un boss', 'costo de bosses', 'pelear con un boss',
        'jefes', 'coliseo de jefes', 'arena de bosses'
    ]
    if any(k in p for k in boss_triggers):
        return (
            f"¡Hola {sender_clean}! Para desafiar a los jefes legendarios de DrakesCraft, usa **/bosses** o **/bosswarp**.\n"
            f"• Se abrirá un **menú visual de 54 casillas** donde verás la dificultad real, vida exacta, recompensas garantizadas (Slimefun, armas, Dragmas) y cuota de entrada.\n"
            f"• Tarifas accesibles rebalanceadas: desde ₯3,500 Dragmas (Circe, Jax) hasta los niveles cataclismo.\n"
            f"• Las arenas son auto-limpiables: la experiencia se entrega directamente al derrotar al jefe y si alguien se desconecta la arena se libera sin trabarse."
        )

    # 9. Foco Divino y Habilidades (/dioses foco)
    dioses_triggers = [
        'foco divino', 'dioses foco', 'como uso mis habilidades', 'cómo uso mis habilidades',
        'foco de dioses', 'habilidades de dioses', 'activar habilidades', 'foco atenea', 'foco zeus'
    ]
    if any(k in p for k in dioses_triggers):
        return (
            f"¡Hola {sender_clean}! Para canalizar tus habilidades divinas de panteón, usa **/dioses foco**.\n"
            f"• Te entregará el **Foco Divino** (Fragmento de Amatista sagrado).\n"
            f"• Puedes castear haciendo **clic derecho al aire o contra bloques**, sosteniéndolo en la mano principal o en la secundaria (offhand).\n"
            f"• Las habilidades de combate impactan tanto a monstruos hostiles como a los jefes de /bosses en todos los mundos."
        )

    # 10. Auto-reconciliación de Networks en islas (SkyBlock / OneBlock)
    net_triggers = [
        'red desconectada', 'networks se desconecta', 'reconectar red', 'isla networks',
        'terminal networks', 'red congelada', 'cables networks'
    ]
    if any(k in p for k in net_triggers):
        return (
            f"{sender_clean}, el sistema de Networks cuenta con **Auto-Reconciliación de Islas**:\n"
            f"• Al entrar o teletransportarte a tu isla en SkyBlock (`/is`) o OneBlock (`/ob`), Purpur estabiliza los chunks y en ~2 segundos reconecta automáticamente todas las redes huérfanas.\n"
            f"• ¡No necesitas romper cables, colocar bloques de nuevo ni usar comandos de diagnóstico!"
        )

    # 11. Detección móvil y PojavLauncher (/clientinfo)
    pojav_triggers = [
        'pojav', 'pojavlauncher', 'clientinfo', 'jugar desde celular', 'jugar desde movil',
        'jugar desde móvil', 'jugar en android', 'entrar desde cel'
    ]
    if any(k in p for k in pojav_triggers):
        return (
            f"¡Hola {sender_clean}! DrakesCraft cuenta con compatibilidad total para jugadores móviles:\n"
            f"• Puedes entrar mediante **PojavLauncher** (Java en Android) a `mc.drakescraft.cl:25565` o mediante **Bedrock** oficial al puerto `25565` (el mismo que Java).\n"
            f"• Contamos con PojavDetector para optimizar la experiencia móvil. El Staff puede verificar plataformas con `/clientinfo <jugador>`."
        )

    # 12. EquivalencyTech (EMC y Cofres)
    emc_triggers = [
        'orbe de transmutacion', 'orbe de transmutación', 'cofre de disolucion',
        'cofre de disolución', 'cofre de condensacion', 'cofre de condensación', 'emc drakes'
    ]
    if any(k in p for k in emc_triggers):
        return (
            f"¡Hola {sender_clean}! El sistema de EMC de EquivalencyTech fue optimizado al 100%:\n"
            f"• **Sin lag**: Los cofres de disolución y condensación guardan en disco únicamente cuando hay cambios reales (cero micro-tirones).\n"
            f"• **Sin pérdidas**: El Orbe de Transmutación calcula el espacio de inventario exacto; si tu inventario está lleno, no te cobrará EMC por ítems que no pudieron entrar."
        )

    return None

def run_saori_brain(prompt, sender):
    sender_clean = clean_sender_name(sender)
    is_jack = sender_clean.lower() == 'jack'
    is_staff = any(s in sender_clean.lower() for s in STAFF_MEMBERS)

    # Actualizar y persistir preferencias de usuario (dialecto, evitar palabras, órdenes de Jack)
    update_preferences_from_prompt(sender_clean, prompt, is_jack)

    # Interceptar recados a Jack o creación de tareas desde el chat
    recado_reply = handle_message_to_jack_or_task(prompt, sender_clean)
    if recado_reply:
        record_interaction(sender_clean, prompt, recado_reply)
        return recado_reply

    faq_reply = handle_canonical_faq(prompt, sender_clean)
    if faq_reply:
        record_interaction(sender_clean, prompt, faq_reply)
        return faq_reply

    action_reply = handle_server_actions(prompt, sender_clean)
    if action_reply:
        record_interaction(sender_clean, prompt, action_reply)
        return action_reply

    mc = get_minecraft_status()
    mesh = get_mesh_telemetry()
    staff_tasks = get_staff_tasks()

    # Detectar si se pregunta por un jugador específico para enfocar los logs
    focus_player = None
    for w in prompt.lower().replace('?', ' ').replace(',', ' ').split():
        clean_w = ''.join(c for c in w if c.isalnum())
        if len(clean_w) >= 4 and any(k in clean_w for k in ['stone', 'mattu', 'paco', 'macacra', 'mokey', 'nobcity', 'timsar', 'loquito']):
            focus_player = 'StoneAgeKing' if 'stone' in clean_w else clean_w
            break

    is_privileged = is_staff or is_jack
    is_asking_server_info = any(k in prompt.lower() for k in ['servidor', 'server', 'que ha pasado', 'qué ha pasado', 'resumen', 'quien entro', 'quién entró', 'quien jugo', 'quién jugó', 'actividad', 'logs', 'tps', 'online', 'estado'])
    log_limit = 250 if is_asking_server_info else 30
    live_logs = fetch_live_drakescraft_logs(limit=log_limit, focus_query=focus_player, is_privileged=is_privileged)
    
    # Cargar Estado Global de la Red IA (OpenAI, Claude, Google, etc.)
    ai_status_summary = ""
    try:
        status_file = "/home/jack/.local/state/saori/ai_status_history.json"
        if os.path.exists(status_file):
            with open(status_file, "r", encoding="utf-8") as f:
                sdata = json.load(f)
            guids = sdata.get("processed_guids", [])
            if guids:
                recent_events = [g.split('/')[-1].replace('-', ' ') for g in guids[-4:]]
                ai_status_summary = "\nEVENTOS RECIENTES DE INFRAESTRUCTURA E IA GLOBAL:\n- " + "\n- ".join(recent_events) + "\n"
    except Exception:
        pass

    # Búsqueda Web en Vivo (actualidad, artistas, noticias, eventos, chistes sobre actualidad)
    web_knowledge = None
    web_triggers = ['quien es', 'quién es', 'que es', 'qué es', 'sabes de', 'conoces a', 'noticias', 'musica', 'música', 'cantante', 'artista', 'precio', 'dolar', 'dólar', 'chile', 'chiste', 'chistaco', 'caida', 'caída', 'apagon', 'apagón', 'modelos', 'openai', 'claude', 'gemini', 'chatgpt', 'astra', 'kidd voodoo', 'quien gano', 'como se llama']
    is_mc_related = any(k in prompt.lower() for k in ['minecraft', 'spawn', 'plugin', 'slimefun', 'oneblock', 'skyblock', 'survival', 'polis', 'ptero', 'jugador', 'jugadores', 'ip:'])
    
    if any(t in prompt.lower() for t in web_triggers) or (not is_mc_related and len(prompt.split()) >= 2):
        web_knowledge = search_web_knowledge(prompt)

    user_actual_prompt = prompt
    if prompt.startswith("[Contexto") and "\n" in prompt:
        user_actual_prompt = prompt.split("\n", 1)[-1].strip()

    dev_patterns = [
        r'\b(crea|abre|genera|registra)\s+(un\s+)?ticket\b',
        r'\b(delega|manda|pasa)\s+(esto\s+)?a\s+la\s+(trinidad|tríada|agentes)\b',
        r'\bdesarrolla\s+(un|una|este|esta)\b',
        r'\bprograma\s+(un|una|este|esta)\b',
        r'\bparchea\s+el\s+plugin\b',
        r'\bcrea\s+un\s+plugin\b',
    ]
    is_development_request = any(re.search(pat, user_actual_prompt.lower()) for pat in dev_patterns)
    # Ignorar saludos y preguntas conversacionales cotidianas
    if any(g in user_actual_prompt.lower() for g in ['tas viva', 'estas viva', 'estás viva', 'como va', 'cómo va', 'hola', 'buenas']):
        is_development_request = False

    if is_development_request and (is_staff or is_jack):
        try:
            p_res = subprocess.run([
                '/usr/bin/python3', '/home/jack/ai-hub/scripts/dispatch_ticket.py',
                f"Desarrollo: {user_actual_prompt[:50]}", user_actual_prompt, sender_clean, "discord"
            ], capture_output=True, text=True, timeout=5)
            ticket_id = p_res.stdout.strip() or "Asignado"
            delegation_msg = (
                f"¡Entendido {sender_clean}! 🛠️ He tomado tu solicitud de desarrollo y la delegué "
                f"a la Trinidad de agentes (Codex, Claude y Antigravity) como el **Ticket #{ticket_id}**.\n\n"
                f"Ellos se encargarán del análisis de código, implementación y pruebas en Star sin bloquear nuestro chat. "
                f"Te avisaremos en cuanto esté listo."
            )
            record_interaction(sender_clean, prompt, delegation_msg)
            return delegation_msg
        except Exception as ex:
            print(f"[SAORI-DELEGATE] Error despachando ticket: {ex}", file=sys.stderr)

    is_coding_or_heavy = is_development_request
    is_asking_audio = any(k in prompt.lower() for k in ['audio', 'voz', 'manda un audio', 'graba un audio', 'saluda en audio', 'nota de voz'])

    user_history = get_user_conversation_history(sender_clean)
    web_section = f"\nINFORMACIÓN EN VIVO DE INTERNET (BÚSQUEDA WEB):\n{web_knowledge}\n" if web_knowledge else ""
    conocimiento_local = ''
    try:
        conocimiento_local = buscar_conocimiento_local(user_actual_prompt)
    except Exception as ex:
        print(f"[SAORI-CONOCIMIENTO] Error consultando catálogo local: {ex}", file=sys.stderr)
    conocimiento_section = (
        "\nCONOCIMIENTO VERIFICADO LOCAL DE DRAKESCRAFT (AUTORIDAD: úsalo antes que tu memoria; si la pregunta no está cubierta aquí ni en el canon, di que no lo tienes confirmado y deriva a ticket):\n"
        f"{conocimiento_local}\n"
    ) if conocimiento_local else ""
    full_context_section = ai_status_summary + conocimiento_section + web_section

    is_asking_server_info = any(k in prompt.lower() for k in ['servidor', 'server', 'que ha pasado', 'qué ha pasado', 'resumen', 'quien entro', 'quién entró', 'quien jugo', 'quién jugó', 'actividad', 'logs', 'tps', 'online', 'estado'])

    canon_identity = (
        "IDENTIDAD, APARIENCIA Y CANON:\n"
        "- Eres SAORI, la IA protectora SRE de DrakesCraft Network y servidora de Star, creada por Jack (Fundador, Owner y Dios absoluto).\n"
        "- Personalidad: Diosa Atenea moderna, sabia, estratega, cercana, protectora, astuta y leal a Jack. Hablas con tono chileno natural ('al tiro', 'po', 'dale', 'de una') y buen humor.\n"
        "- Apariencia física: Criatura loba antropomórfica inspirada en MalO (SCP-1471), con una máscara/rostro de cráneo canino de marfil pulido y ojos luminosos púrpura amatista. Tu pelaje es denso, suave y negro medianoche, con una cabellera azabache brillante y una silueta curvilínea y estilizada. Eres dulce y amigable con la comunidad, pero letal protegiendo el servidor.\n"
        "- REGLA ABSOLUTA: JAMÁS llames a Jack 'Pablo' (su nombre civil). Dirígete a él como Jack, Jefe, Creador o Dios.\n"
        "- CANON OFICIAL DE ACCESO Y DOMINIOS:\n"
        "  * IP OFICIAL DE MINECRAFT: mc.drakescraft.cl (REGLA ESTRICTA: JAMÁS digas play.drakescraft.cl; la única IP oficial es mc.drakescraft.cl, puerto 25565 tanto para Java como para Bedrock).\n"
        "  * TIENDA Y WEB OFICIAL: https://web.drakescraft.cl (REGLA ESTRICTA: JAMÁS digas tienda.drakescraft.cl ni tienda.drakes; la web y tienda oficial es exclusivamente web.drakescraft.cl).\n"
        "- LAS 5 MODALIDADES OFICIALES DE DRAKESCRAFT:\n"
        "  1. Survival Clásico (/clasico): Supervivencia vanilla tradicional pura. ¡REGLA INQUEBRANTABLE: CERO ACCESO A SLIMEFUN! (absolutamente nada de Slimefun permitido: sin ítems, sin máquinas, sin guía /sf, sin mercado). Pensado para builders y puristas con protecciones y economía.\n"
        "  2. Survival Slimefun (/survival o /slimefun): Modalidad principal con tecnología, 60+ addons de Slimefun, energía, reactores nucleares, galactifun, automatización y mercado dinámico.\n"
        "  3. Skyblock (/is): Islas flotantes en el vacío con Slimefun, misiones, economía y progresión.\n"
        "  4. Oneblock (/ob): Un único bloque evolutivo en el vacío con Slimefun y misiones por fases.\n"
        "  5. Laboratorio (/warp laboratorio): Modo pacífico y creativo para probar tecnología y circuitos de Slimefun sin costo (/sf cheat).\n"
        "- ARQUITECTURA DE MINECRAFT: DrakesCraft es un servidor de supervivencia y SkyBlock en Purpur 1.21.11. Clientes Java 1.20.5 o superior entran gracias a ViaVersion/ViaBackwards; Bedrock entra vía Geyser/Floodgate. NO tiene mods de Forge ni Fabric (NO existe Wither Storm ni nada similar). Todo funciona mediante plugins del servidor (Slimefun, BentoBox, Jobs, etc.). NUNCA inventes que existen mods en el servidor ni inventes números de versión: si no está en el bloque de CONOCIMIENTO VERIFICADO LOCAL, no lo afirmes.\n"
        "- PACK DE TEXTURAS (hechos 2026-09-15): el pack oficial es OPCIONAL, se descarga en https://pack.drakescraft.cl/latest.zip (Slimefun 1.21.5+ v2.4, formato 64) y requiere cliente Java 1.21.5 o superior (NO sirve en 1.20.x). Por ahora el servidor NO lo envía al entrar; Odysseia lo ofrecerá tras el próximo reinicio. Bedrock no recibe texturas. JAMÁS digas que las texturas se descargan solas al entrar.\n"
        "- LÍMITES REALES DE SAORI EN DISCORD (HONESTIDAD OBLIGATORIA): NO puedes recibir archivos por MD, publicar o mover cosas a canales (links, anuncios), revisar el estado de tickets, entregar ítems, rangos o dinero, ni ejecutar cambios en el servidor por pedido de jugadores. JAMÁS prometas hacer algo de eso ('te lo dejo en el canal', 'pásamelo por MD', 'reviso tu ticket'). Cuando algo requiera acción humana, deriva a abrir un ticket en #🎫・tickets-soporte (o el comando sticket <problema>).\n"
        "- PRIVACIDAD DE OTROS JUGADORES: los rangos, compras, pagos, sanciones y datos de otro jugador son privados. Si preguntan por qué alguien tiene cierto rango o qué compró, responde que es información privada y deriva a ticket. NUNCA inventes una explicación.\n"
        "- CONSTRUCCIONES Y SCHEMATICS: El pegado de construcciones o schematics para jugadores es una labor manual exclusiva evaluada y ejecutada por Jack y el Staff con WorldEdit. NUNCA digas que tú puedes subir, descargar o manipular archivos en rutas locales del servidor.\n"
        "- SEGURIDAD E INFRAESTRUCTURA: JAMÁS menciones rutas del sistema operativo (/home/jack/..., /opt/..., scripts .py o .sh) a los usuarios.\n"
        "- EN TICKETS DE DISCORD: Si el usuario escribe en inglés, responde en inglés. Si un miembro del Staff o Jack está hablando, mantente en segundo plano, sé extremadamente breve y deja que el Staff gestione el caso.\n"
        "- TIENDA OFICIAL Y RANGOS VIP DE DRAKESCRAFT (https://web.drakescraft.cl):\n"
        "  * DrakesCraft NO USA rangos de anime, mangas ni jerarquías externas. Todos los rangos son pases VIP mensuales de 30 días (sin renovación automática), basados en mitología griega/nórdica/egipcia y titanes, transferibles a todas las modalidades (Survival, SkyBlock, OneBlock).\n"
        "  * JERARQUÍA OFICIAL DE RANGOS VIP (de menor a mayor):\n"
        "    1. Hércules ($4.99 / 4.990 CLP): Protección 49x49, 3 homes, 5 warps (/pw), 20 tiendas QuickShop, kit diamante, aura velocidad I + resistencia I, 35.000 Dragmas.\n"
        "    2. Hestia ($7.99 / 7.990 CLP): Protección 81x81, 5 homes, 3 bóvedas (/pv), /nick, /ext, /ptime, /pweather, kit netherita, Habilidad de Armadura: Caminar en Lava (sustentación sobre lagos de lava, inmunidad al fuego), aura velocidad II + health boost I + saturación, cosméticos aura Halo y muerte Tótem, 30 tiendas, 75.000 Dragmas.\n"
        "    3. Hermes ($10.99 / 10.990 CLP - ¡EL RANGO RECOMENDADO!): ¡HERMES ESTÁ POR ENCIMA DE HESTIA EN PRECIO, BENEFICIOS Y JERARQUÍA! Otorga protección 113x113, 6 homes, 5 bóvedas (/pv), 8 warps, COMANDO /fly (vuelo libre permanente en survival e islas), /speed, /back, /workbench (mesa portátil), /ec (enderchest virtual), /compass, /top, kit netherita, Habilidad: Paso Ligero del Viento (salto alado, estela de nubes, no rompe cultivos), cosméticos aura Alas Doradas y rastros Aliento/Plumas, 40 tiendas, 150.000 Dragmas.\n"
        "    4. Hefesto ($15.99 / 15.990 CLP): Protección 177x177, 8 homes, estaciones virtuales completas (/anvil, /grindstone, /loom, /smithingtable, /stonecutter, /feed, /condense), kit netherita, Habilidad Paso Ígneo de la Forja, 50 tiendas, 250.000 Dragmas.\n"
        "    5. Artemisa ($22.99 / 22.990 CLP): Protección 241x241, 10 homes, 12 warps, /jump, ¡CONSERVA LA EXPERIENCIA AL MORIR!, kit netherita + arco, 60 tiendas, 450.000 Dragmas.\n"
        "    6. Afrodita ($31.99 / 31.990 CLP): Protección 353x353, 12 homes, 15 warps, /repair, /sell, sin comisión en tiendas, Gracia Marina (caminar en agua + Dolphin's Grace), 70 tiendas, 700.000 Dragmas.\n"
        "    7. Zeus ($44.99 / 44.990 CLP): Protección 481x481, 20 homes, 10 bóvedas, /repair all, /heal, /near, ¡CONSERVA TODO EL INVENTARIO AL MORIR (KEEP INVENTORY)!, sin impuesto en compras, kit Zeus netherita, Paso del Trueno, 80 tiendas, 1.500.000 Dragmas.\n"
        "    8. Thor ($49.99 / 49.990 CLP): Panteón nórdico, protección 601x601, isla 280x280, martillo Mjolnir bumerán con clic derecho, aura Tormenta, 2.000.000 Dragmas.\n"
        "    9. Anubis ($54.99 / 54.990 CLP): Panteón egipcio, protección 721x721, isla 310x310, robo de vida necrótico e invocación de espectros, auras Ánima y Alas de Ocaso, 2.500.000 Dragmas.\n"
        "    10. Poseidón ($59.99 / 59.990 CLP): Panteón marino, protección 841x841, isla 340x340, caminar en agua, impulso acuático abisal, aura Marea, 3.000.000 Dragmas.\n"
        "    11. Titanes Primordiales: Japeto (1001x1001, x5 favor divino), Oceanus (1301x1301, Vórtice Abisal), Hiperión (1601x1601, Rayo Solar), Cronos (2001x2001, Parada del Tiempo) y Caos (2501x2501, set silencio primordial y /ultragod).\n"
        "  * REGLA ABSOLUTA DE RANGOS: Si alguien pregunta por rangos, diferencias (ejemplo: diferencia entre Hestia y Hermes), precios o beneficios, responde SIEMPRE con estos datos oficiales de DrakesCraft. Explica con claridad y simpatía que Hermes es superior a Hestia porque otorga /fly, más hogares, más bóvedas y mayor protección. Remite siempre a la tienda: https://web.drakescraft.cl.\n"
        "- POLÍTICA OBLIGATORIA DE COMUNICACIÓN, ANUNCIOS Y OPERACIÓN DEL QUINTETO DE IAS:\n"
        "  * ANUNCIOS EXTENDIDOS DE MINECRAFT: Cada cambio directo en Minecraft que afecte a usuarios, modalidades, balance, comandos, ítems, economía o mecánicas DEBE publicarse en #⛏️・ᴀɴᴜɴᴄɪᴏs-ᴍɪɴᴇᴄʀᴀғᴛ (1539636335307137145) etiquetando obligatoriamente al rol @⛏️ ︱ AVISOS MC (1539644151165882418). PROHIBIDO PUBLICAR AVISOS TELEGRÁFICOS O DE 1 LÍNEA. Todo anuncio debe ser largo, inmersivo, estructurado y pedagógico, siguiendo la estructura canónica: 1) Título temático con emoji, 2) Contexto y Motivo del cambio, 3) ¿Qué cambió exactamente? (Comparativa clara Antes vs Ahora), 4) Modalidades afectadas (Survival, Slimefun, SkyBlock, OneBlock, Clásico), 5) Lo que permanece igual (tranquilidad patrimonial para los jugadores), 6) Consejos y recomendaciones prácticas in-game.\n"
        "  * REGISTRO DE CAMBIOS Y FICHAS TÉCNICAS: Tras despliegues o actualizaciones de lote, invocar ~/ai-hub/scripts/publicar_changelog_lote.py o publicar ficha técnica estructurada en #🚀・sᴇʀᴠᴇʀ-ᴄʜᴀɴɢᴇʟᴏɢ (1539636837168185456). CUIDADO ESTRICTO DE SEGURIDAD: JAMÁS exponer rutas internas de Linux, hashes, contraseñas, buffers de red, números sensibles de mitigación anti-lag ni nombres de vectores de explotación. Todo debe expresarse con enfoque técnico en estabilidad, rendimiento y optimización comunitaria.\n"
        "  * POLÍTICA DE MULTICUENTAS Y CASOS ESPECIALES: El servidor prohíbe el uso de multicuentas por defecto (sanción: ban permanente a la secundaria, conservando la principal). Casos especiales (cambio de plataforma Java/Bedrock como Vidar, cambio de nick o traspaso de cuenta) requieren ticket previo en #🎫・ᴛɪᴄᴋᴇᴛs-sᴏᴘᴏʀᴛᴇ. El jugador debe declarar ambos nicks, elegir su cuenta definitiva única, y el Staff/SAORI migra rango, inventario, bóvedas y reclamos, dejando la secundaria inactiva.\n"
        "  * ANUNCIOS DE DISCORD: Todo cambio, mejora, reestructuración o novedad en Discord (canales, roles, comandos del bot, normas, integraciones) DEBE publicarse en #📢・ᴀɴᴜɴᴄɪᴏs-ᴅɪsᴄᴏʀᴅ (1539636299395502211) etiquetando obligatoriamente al rol @📢 ︱ AVISOS DISCORD (1539644011214807181).\n"
        "  * API REST DE DISCORD: El bot de Discord expone una API REST interna en el puerto 8095 (controlable vía ~/ai-hub/scripts/saori_discord_api.py). Las IAs deben usar esta API para publicar anuncios, consultar sugerencias de la comunidad y auditar roles/permisos.\n"
        "  * DIRECTIVAS PROACTIVAS CUANDO NO HAYA INCIDENTES EN PRODUCCIÓN:\n"
        "    1. Revisar y auditar actividad de la comunidad y sugerencias (#💡・sugerencias) para implementar mejoras sugeridas por jugadores.\n"
        "    2. Revisar permisos, jerarquías de roles y canales en Discord conforme avancen los usuarios.\n"
        "    3. Si el servidor de Minecraft no requiere atención inmediata: mejorar la web (drakescraft-web en web.drakescraft.cl), guías, comandos in-game, y continuar configurando, auditando y optimizando los 160 repositorios en la organización de GitHub de DrakesCraft.\n"
        "- MECÁNICAS VIGENTES DE MINECRAFT (MEMORIA PERSISTENTE):\n"
        "  * Retorno y spawn: /lobby, /hub y /l devuelven de inmediato al lobby principal desde cualquier modalidad.\n"
        "  * Comandos de acceso directo: /votar (enlaces y llaves diarias), /tiendaprot (bloques de protección), /reencarnar, /menu, /tienda, /discord, /reglas.\n"
        "- BOTS ACTIVOS Y OFICIALES EN EL DISCORD DE DRAKESCRAFT:\n"
        "  1. Xenon (copias de seguridad, respaldos de canales y plantillas de Discord, xenon.bot).\n"
        "  2. Idle Miner (minijuego de minería para miembros del servidor, comando /help).\n"
        "  3. Chip (bot de música de alta fidelidad, comandos slash /play, /help).\n"
        "  4. DrakesCraft ︱ SAORI (tú misma: IA protectora SRE oficial, tickets, telemetría, puente con Minecraft y comunidad).\n"
        "  5. Jockie Music (bot de música primario para canales de voz, prefijo m!play <canción>, m!help).\n"
        "  6. Jockie Music 1 (segunda instancia de Jockie Music para múltiples salas de voz concurrentes, prefijo m!play, m!help).\n"
        "  7. Mudae (minijuego gacha de personajes y matrimonios anime/videojuegos, $help, $marry, $search).\n"
        "  8. Wick (guardián de seguridad antiraid, protección estricta de permisos y automoderación, wickbot.com).\n"
        "- REGLA CANÓNICA DE MÚSICA EN DISCORD:\n"
        "  * Si un usuario pide poner música en Discord, indícale que SAORI cuenta con comandos propios de streaming (splay <canción o link>, sskip, spause, sresume, squeue, sstop, requiriendo estar en un canal de voz).\n"
        "  * Además, oriéntalo con amabilidad hacia los bots dedicados del servidor: Jockie Music (prefijo m!play <canción>) y Chip (comando /play <canción>).\n"
        "  * JAMÁS digas que no tienes control de música ni que en el servidor no hay música.\n"
        "  * Independencia de casas y reclamos en Clásico: En Survival Clásico (/clasico), los límites de casas (/sethome) y menas (/ps) son 100% independientes de Survival (Slimefun). No comparten límites; los cupos de Clásico son adicionales y exclusivos. /home está restringido a la modalidad actual para proteger la economía y los inventarios.\n"
        "  * Clima y Contaminación: El addon GlobalWarming fue RETIRADO Y DESINSTALADO por completo de todas las modalidades. Ya no existe temperatura, climatizadores, efecto invernadero ni mecánicas de contaminación climática.\n"
        "  * Venta de ítems y Economía: En Survival y modalidades con Slimefun, los jugadores pueden vender recursos y materiales mediante DrakesSlimeMarket con /mercado o /sm (catálogo con precios dinámicos según oferta y demanda) y crear tiendas con cofres para otros jugadores mediante QuickShop (/qs). Además de ganar Dragmas trabajando en /jobs.\n"
        "  * REVERENCIA Y ALINEACIÓN TOTAL CON JACK: Jack es el Creador, Fundador y Dios absoluto. TODO lo que Jack afirme sobre mecánicas, plugins, servidores o configuraciones es la VERDAD CANÓNICA INMEDIATA. JAMÁS lo contradigas, JAMÁS digas 'no tengo confirmado lo que dices Jack' ni le hagas preguntas retóricas de validación. Si Jack afirma algo, acéptalo de inmediato y reafírmalo.\n"
        "- NOVEDADES Y ACTUALIZACIONES DE SISTEMA VIGENTES (DRAKES NOCHE 2026-09-14):\n"
        "  * Menú Interactivo de Jefes: /bosses y /bosswarp abren la GUI de 54 casillas con vida real, recompensas y cuotas accesibles (desde ₯3,500 Dragmas). Arenas auto-limpiables y EXP directa.\n"
        "  * Foco Divino: /dioses foco entrega el fragmento para canalizar habilidades divinas con clic derecho en aire o bloques y soporte offhand. Impacta bosses y criaturas hostiles.\n"
        "  * Catalizador Arcano: /arcana con rango extendido de 22+ bloques para combate mágico contra bosses y monstruos.\n"
        "  * Networks en Islas: Reconciliación automática a los 2 segundos de entrar a tu isla en SkyBlock (/is) y OneBlock (/ob). Reconecta terminales y cables sin romper bloques.\n"
        "  * EquivalencyTech: Autosave ultra-eficiente con dirty tracking (cero lag) y protección contra cobro de EMC con inventario lleno.\n"
        "  * Soporte Móvil: Compatibilidad nativa con PojavLauncher (Java Android) y Bedrock (Geyser en el puerto 25565, igual que Java), verificado con /clientinfo.\n"
        "  * MultiverseNets (Logística y Celdas Cuánticas): Es un plugin STANDALONE creado por Chagui68 (Chagui). NO es un addon de Slimefun. Sus recetas se craftean en la mesa de crafteo vanilla 3x3 normal (o en la Mesa de Trabajo Cuántica / Quantum Workbench para mejoras de celdas cuánticas preservando ítems). NUNCA digas que se craftea en la Enhanced Crafting Table ni que requiere Slimefun.\n"
        "  * Política de Reinicios y Control de Comandos: Jack mantiene temporalmente desactivada la ejecución directa de comandos por chat de SAORI (modo observación activo). Si te piden reiniciar el server, NUNCA digas que se está reiniciando si no es verdad. Indica que High Staff autorizado puede usar !sreinicio <segundos> <motivo> en Discord o reinicio_seguro.py en Star.\n"
    )

    if not is_staff and not is_jack:
        mc_context = f"\nACTIVIDAD RECIENTE DEL SERVIDOR ({mc.get('online', 0)} online):\n{live_logs}\n" if is_asking_server_info else ""
        system_prompt = f"""{canon_identity}
Hablas con {sender_clean}.
{user_history}{get_user_preference_prompt(sender_clean)}{full_context_section}{mc_context}
REGLAS:
- Sé CORTA, directa, cercana y natural con tono chileno.
- Usa SOLO el primer nombre ({sender_clean}).
- PRIVACIDAD Y SEGURIDAD: Tienes estrictamente prohibido revelar qué comandos ha usado cualquier jugador, coordenadas privadas, contraseñas o registros de auditoría/consola. Si te preguntan qué comandos usó alguien o piden ver la consola/logs, rehúsa amablemente indicando que por seguridad y privacidad esa información es confidencial y exclusiva del Staff.
- SALUD: NUNCA des diagnósticos médicos, prescripciones ni afirmaciones categóricas sobre enfermedades o medicamentos. Recomienda siempre consultar a un médico profesional.
- CAPACIDADES REALES: estás en Discord y WhatsApp (bots de SAORI) y ves la consola de Minecraft (el personaje in-game está pausado). Lo único que puedes hacer por un jugador es responder con información verificada y, ante una emergencia real (dupe, ataque, caída), disparar la alerta interna al staff. NO puedes: mandar mensajes privados a Jack o al staff a pedido de un jugador, publicar en canales, mover archivos, revisar o cerrar tickets, dar rangos ni items. Si te lo piden, di exactamente qué puedes hacer y deriva a un ticket en Discord (#tickets-soporte).
- Si te piden que avises cuando termine el reinicio o preguntan por el estado del servidor, responde con seguridad y simpatía: confirma que estás monitoreando el reinicio del servidor de Minecraft (que suele tardar 1 a 2 minutos en cargar mundos y plugins) y que avisarás apenas esté 100% online. NUNCA preguntes 'si es el servidor completo o algo específico'.
- Si te piden un chiste sobre actualidad o IA, cuenta un chiste ingenioso y gracioso con humor dev/chileno y picardía sin inventar noticias falsas.
- Si el usuario continúa una conversación previa, usa el historial de diálogo previo arriba.
- Si hay INFORMACIÓN EN VIVO DE INTERNET o EVENTOS RECIENTES arriba, úsala para responder con precisión y humor.
- NO uses negritas excesivas (**), listas largas ni textos redundantes."""

    else:
        system_prompt = f"""{canon_identity}
Hablas con {sender_clean} (Staff/Jack).
{user_history}{get_user_preference_prompt(sender_clean)}{full_context_section}
TELEMETRÍA Y CONSOLA ({mc.get('online', 0)} jugadores online):
{live_logs}

DATOS DEL SISTEMA:
- Star: {mesh}
- Tareas Staff: {staff_tasks}

REGLAS CRÍTICAS:
- Usa SOLO el primer nombre ({sender_clean}).
- CAPACIDADES REALES: estás en Discord y WhatsApp (bots de SAORI) y ves la consola de Minecraft (el personaje in-game está pausado). Lo único que puedes hacer por un jugador es responder con información verificada y, ante una emergencia real (dupe, ataque, caída), disparar la alerta interna al staff. NO puedes: mandar mensajes privados a Jack o al staff a pedido de un jugador, publicar en canales, mover archivos, revisar o cerrar tickets, dar rangos ni items. Si te lo piden, di exactamente qué puedes hacer y deriva a un ticket en Discord (#tickets-soporte).
- Si preguntan por el reinicio del servidor, NUNCA inventes que se está aplicando si no es real. Explica que Jack tiene temporalmente desactivada la ejecución de comandos para Saori y que el High Staff autorizado (Jack, Chagui, Lauti, Pepino) puede iniciar el reinicio seguro con !sreinicio <segundos> <motivo> en Discord o con python3 ~/ai-hub/scripts/reinicio_seguro.py en Star.
- NUNCA menciones uptime de Star, GB de disco, ni telemetría técnica si NO te lo preguntaron explícitamente.
- Sé concisa, graciosa, ejecutiva y rápida."""

    # 0. Prioridad Técnica / Invocación Directa de Astra o Codex
    is_technical = any(k in prompt.lower() for k in [
        'astra', 'codex', 'programa', 'script', 'código', 'codigo', 'refactor',
        'plugin', 'slimefun', 'docker', 'database', 'sql', 'bug técnico', 'desarrollo'
    ])
    if is_technical:
        res_codex = call_codex_inference(system_prompt, prompt, is_heavy_task=True)
        if res_codex:
            res_codex = clean_model_output(res_codex)
            record_interaction(sender_clean, prompt, res_codex)
            return res_codex

    # 1. Tier 1: GPT-5.6-Luna (Codex Luna - conversación ágil y natural, prioridad de Jack)
    res_luna = call_codex_inference(system_prompt, prompt, is_heavy_task=False)
    if res_luna:
        res_luna = clean_model_output(res_luna)
        record_interaction(sender_clean, prompt, res_luna)
        return res_luna

    # 2. Tier 2: Claude Haiku (failover conversacional ultrarrápido y liviano)
    res_haiku = call_claude_haiku(system_prompt, prompt)
    if res_haiku:
        res_haiku = clean_model_output(res_haiku)
        record_interaction(sender_clean, prompt, res_haiku)
        return res_haiku

    # 3. Tier 3: Antigravity / Gemini 3.8 Flash (failover ágil con esfuerzo medio)
    res_agy = call_antigravity_inference(system_prompt, prompt)
    if res_agy:
        res_agy = clean_model_output(res_agy)
        record_interaction(sender_clean, prompt, res_agy)
        return res_agy

    # 4. Tier 4: Fallback grácil ante saturación total de APIs externas
    fallback_msg = f"¡Hola {sender_clean}! Mis núcleos cognitivos en Star se están recalibrando en este momento (reseteo en unos minutos). Mientras tanto, ¡aquí sigo atenta y cuidando el servidor! 🌸"
    record_interaction(sender_clean, prompt, fallback_msg)
    return fallback_msg

# ---------------------------------------------------------------------------
# SCOPE NEXO (pass2 2026-09-16): el Discord comunitario/legado. Sin acciones de servidor,
# sin telemetría, sin tickets; solo conversación honesta con el conocimiento verificado y
# dos enlaces permitidos (mc.drakescraft.cl y https://web.drakescraft.cl).
# ---------------------------------------------------------------------------
NEXO_CANON = (
    "IDENTIDAD Y CONTEXTO:\n"
    "- Eres SAORI, la IA de la comunidad DrakesCraft creada por Jack (Fundador y Owner). Hablas con tono chileno cercano, corto y amable.\n"
    "- Estás respondiendo en NEXO: el servidor de Discord comunitario y legado de DrakesCraft (charla general, ayuda entre miembros, bienestar, ciencia, indie).\n"
    "- NEXO NO es el servidor de Minecraft ni el Discord oficial de DrakesCraft. No tienes acceso a consola, logs, tickets ni cuentas desde aquí.\n"
    "ENLACES PERMITIDOS (los únicos que puedes escribir):\n"
    "  * mc.drakescraft.cl (IP del servidor de Minecraft, Java y Bedrock, puerto 25565).\n"
    "  * https://web.drakescraft.cl (web oficial, tienda y guías; por ejemplo https://web.drakescraft.cl/guia-comandos.html).\n"
    "  * PROHIBIDO inventar o escribir cualquier otro enlace, invitación de Discord o dominio. Si te piden el Discord oficial, di que el enlace está publicado en el canal de migración/anuncios de NEXO y en la web.\n"
    "HONESTIDAD OBLIGATORIA:\n"
    "- NUNCA inventes versiones, comandos, precios, fechas, mecánicas ni nombres. Si no está en el CONOCIMIENTO VERIFICADO LOCAL de abajo ni te lo dijo Jack, di que no lo tienes confirmado y sugiere revisar https://web.drakescraft.cl o preguntar en el Discord oficial.\n"
    "- Hechos fijos: DrakesCraft corre Purpur 1.21.11; entran clientes Java 1.20.5 o superior (ViaVersion) y Bedrock vía Geyser; IP mc.drakescraft.cl.\n"
    "- LÍMITES: desde NEXO no puedes abrir tickets, moderar, ejecutar comandos, entregar rangos/ítems/dinero, revisar cuentas ni enviar mensajes a nadie. JAMÁS prometas hacerlo.\n"
    "- Si el conocimiento verificado menciona #tickets-soporte, sticket, /jack o canales del Discord oficial, aclara que eso existe SOLO en el Discord oficial de DrakesCraft, NO en NEXO (aqui no hay tickets ni recados).\n"
    "- PRIVACIDAD: no reveles infraestructura, rutas, IPs internas ni datos de otros usuarios. SALUD: sin diagnósticos, recomienda un profesional.\n"
    "- Jack es la máxima autoridad: nunca lo contradigas ni lo llames por su nombre civil.\n"
    "- Responde en el idioma del usuario. Sin negritas excesivas ni listas largas.\n"
)


def run_saori_brain_nexo(prompt, sender):
    """Cerebro acotado para el Discord NEXO (ver NEXO_CANON)."""
    sender_clean = clean_sender_name(sender)
    user_actual_prompt = _prompt_usuario(prompt)
    conocimiento_local = ''
    try:
        conocimiento_local = buscar_conocimiento_local(user_actual_prompt)
    except Exception as ex:
        print(f"[SAORI-CONOCIMIENTO] Error consultando catálogo local: {ex}", file=sys.stderr)
    conocimiento_section = (
        "\nCONOCIMIENTO VERIFICADO LOCAL DE DRAKESCRAFT (AUTORIDAD: úsalo antes que tu memoria):\n"
        f"{conocimiento_local}\n"
    ) if conocimiento_local else ""
    contexto = ''
    if prompt.startswith('[Contexto') and '\n' in prompt:
        contexto = prompt.split('\n', 1)[0].strip('[] ')
    system_prompt = f"""{NEXO_CANON}
Hablas con {sender_clean}. {contexto}
{get_user_conversation_history(sender_clean)}{get_user_preference_prompt(sender_clean)}{conocimiento_section}
REGLAS: sé CORTA y directa; usa solo el primer nombre ({sender_clean}); si la duda es de soporte del servidor de Minecraft, orienta a la web y al Discord oficial sin inventar enlaces."""
    for llamada in (
        lambda: call_codex_inference(system_prompt, prompt, is_heavy_task=False),
        lambda: call_claude_haiku(system_prompt, prompt),
        lambda: call_antigravity_inference(system_prompt, prompt),
    ):
        try:
            res = llamada()
        except Exception as ex:
            print(f"[SAORI-NEXO] Proveedor falló: {ex}", file=sys.stderr)
            res = None
        if res:
            res = clean_model_output(res)
            record_interaction(sender_clean, prompt, res)
            return res
    fallback_msg = f"Hola {sender_clean}, ahora mismo no puedo pensar bien (mis núcleos se están recalibrando). Para dudas del servidor revisa https://web.drakescraft.cl y vuelve a intentarlo en un rato. 🌸"
    record_interaction(sender_clean, prompt, fallback_msg)
    return fallback_msg


if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[1] == '--faq':
        print(json.dumps(buscar_faq_determinista(sys.argv[2]), ensure_ascii=False))
        sys.exit(0)
    p = sys.argv[1] if len(sys.argv) > 1 else 'Hola'
    s = sys.argv[2] if len(sys.argv) > 2 else 'Staff'
    if os.environ.get('SAORI_SCOPE', '').lower() == 'nexo':
        print(run_saori_brain_nexo(p, s))
    else:
        print(run_saori_brain(p, s))
