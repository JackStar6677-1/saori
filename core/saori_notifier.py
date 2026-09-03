#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Unified Alert Dispatcher
- Filtra por severidad ANTES de notificar.
- CRÍTICO  → Email + WhatsApp (grupo staff)
- URGENTE  → Solo WhatsApp
- RUTINARIO → Solo log local, sin notificación externa
"""

import sys, os, json, smtplib, urllib.request, re
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

SMTP_CONFIG_PATH  = '/home/jack/.config/saori/smtp.json'
WEBHOOK_URL       = 'http://127.0.0.1:8088/notify-ticket'
JACK_WA_NUMBER    = '56963477776'
STAFF_GROUP_JID   = '120363422906663864@g.us'
LOG_FILE          = '/home/jack/ai-hub/logs/saori_alerts.log'

# ------------------------------------------------------------------
# Palabras que indican alerta GENUINAMENTE CRÍTICA
# ------------------------------------------------------------------
CRITICAL_KEYWORDS = [
    'crash', 'caida', 'caído', 'server down', 'servidor caído', 'oom',
    'out of memory', 'watchdog', 'ddos', 'griefing', 'hackeando', 'hackeado',
    'dupeo', 'dupeando', 'dupe', 'login exploit', 'kicked', 'lag extremo',
    'tps bajo', 'tps critico', 'disk full', 'disco lleno', 'no arranca',
    'failed to bind', 'connection refused', 'exception in thread main',
    'java.lang.outofmemory', 'could not load', 'plugin failed',
]

# Palabras que indican update RUTINARIO de la Tríada (NO notificar externamente)
ROUTINE_KEYWORDS = [
    'sin tickets libres', 'sin incidentes nuevos', 'ventana limpia',
    'servidor estable', 'triados y cerrados', 'sin bug detras',
    'staged', 'active', 'verified', 'integración', 'pasada de integracion',
    'reconciliados', 'bytecode', 'lote', '3/10', '4/10', '5/10', '6/10',
    '7/10', '8/10', '9/10', '10/10', 'arranque limpio', '0 plugins fallidos',
    'suites', 'sha coincidente', 'catalogo verificado',
]

os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

def classify_severity(subject: str, body: str) -> str:
    """Retorna 'critical', 'urgent' o 'routine'."""
    combined = (subject + ' ' + body).lower()

    # Primero chequear si es rutinario
    routine_hits = sum(1 for k in ROUTINE_KEYWORDS if k in combined)
    if routine_hits >= 2:
        return 'routine'

    # Luego ver si es crítico
    for k in CRITICAL_KEYWORDS:
        if k in combined:
            return 'critical'

    # Revisar señales de urgencia en el asunto
    if any(w in subject.lower() for w in ['crash', 'caída', 'urgente', 'down', 'oom', 'dupe', 'hack']):
        return 'urgent'

    # Default: rutinario si viene de la Tríada con estado OK
    if 'estado: ok' in combined or '[claude-code]' in combined or '[antigravity]' in combined:
        return 'routine'

    return 'urgent'

def log_locally(severity: str, subject: str, body: str):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(f'[{ts}] [{severity.upper()}] {subject}\n')
        if severity != 'routine':
            # Solo loguear cuerpo en no-rutinarios para no inflar el log
            for line in body.splitlines()[:5]:
                f.write(f'  {line}\n')
        f.write('\n')

def send_urgent_email(subject: str, body_text: str) -> tuple:
    if not os.path.exists(SMTP_CONFIG_PATH):
        return False, 'Sin config SMTP'
    try:
        with open(SMTP_CONFIG_PATH) as f:
            cfg = json.load(f)

        msg = MIMEMultipart()
        msg['Subject'] = f'🚨 [SAORI DRAKES] {subject}'
        msg['From']    = f'SAORI SRE <{cfg["user"]}>'
        msg['To']      = cfg['recipient']

        html = f"""<html><body style="font-family:Arial;background:#1a1a2e;color:#fff;padding:20px">
<div style="background:#16213e;border-left:5px solid #e94560;padding:15px;border-radius:8px">
<h2 style="color:#e94560;margin-top:0">🏛️ SAORI Star Core · Alerta Urgente</h2>
<p style="font-size:16px;line-height:1.5">{body_text.replace(chr(10),'<br>')}</p>
<hr style="border:1px solid #0f3460">
<p style="font-size:12px;color:#a2a8d3">Emitido por SAORI · DrakesCraft</p>
</div></body></html>"""

        msg.attach(MIMEText(body_text, 'plain'))
        msg.attach(MIMEText(html, 'html'))

        with smtplib.SMTP(cfg['smtp_host'], cfg['smtp_port'], timeout=10) as s:
            if cfg.get('use_tls', True):
                s.starttls()
            s.login(cfg['user'], cfg['password'])
            s.send_message(msg)
        return True, 'Email enviado'
    except Exception as e:
        return False, str(e)

def send_whatsapp(title: str, body: str, target_jid: str) -> tuple:
    """Envía al webhook del bot de WhatsApp."""
    try:
        payload = json.dumps({
            'ticket_id': 'ALERTA',
            'agente':    'SAORI SRE',
            'titulo':    title,
            'resumen':   body[:300],
            'group_jid': target_jid,
        }).encode('utf-8')
        req = urllib.request.Request(
            WEBHOOK_URL, data=payload,
            headers={'Content-Type': 'application/json'}
        )
        with urllib.request.urlopen(req, timeout=4):
            pass
        return True, 'WhatsApp enviado'
    except Exception as e:
        return False, str(e)

def dispatch_alert(subject: str, message: str, force_level: str = None) -> dict:
    """
    Punto de entrada principal.
    force_level: 'critical' | 'urgent' | 'routine' (sobreescribe clasificación automática)
    """
    severity = force_level or classify_severity(subject, message)
    log_locally(severity, subject, message)

    result = {'severity': severity, 'email': None, 'whatsapp': None}

    if severity == 'routine':
        print(f'[SAORI-NOTIFY] Rutinario — solo log local: {subject[:60]}', file=sys.stderr)
        return result

    if severity in ('critical', 'urgent'):
        # WhatsApp al grupo de staff
        wa_ok, wa_msg = send_whatsapp(subject, message, STAFF_GROUP_JID)
        result['whatsapp'] = {'ok': wa_ok, 'detail': wa_msg}
        print(f'[SAORI-NOTIFY] WhatsApp Grupo → {wa_msg}', file=sys.stderr)

        # Si es alerta de cuota IA o crítico, enviar también mensaje directo a Jack
        if any(k in subject.lower() or k in message.lower() for k in ['cuota', 'quota', 'rate limit', 'agotada', 'límite']) or severity == 'critical':
            jack_jid = f"{JACK_WA_NUMBER}@s.whatsapp.net"
            send_whatsapp(subject, message, jack_jid)
            print(f'[SAORI-NOTIFY] WhatsApp Directo Jack ({JACK_WA_NUMBER}) → Enviado', file=sys.stderr)

    if severity == 'critical':
        # Email solo para críticos
        em_ok, em_msg = send_urgent_email(subject, message)
        result['email'] = {'ok': em_ok, 'detail': em_msg}
        print(f'[SAORI-NOTIFY] Email → {em_msg}', file=sys.stderr)

    return result

if __name__ == '__main__':
    sub = sys.argv[1] if len(sys.argv) > 1 else 'Alerta General'
    msg = sys.argv[2] if len(sys.argv) > 2 else 'Se requiere atención en el servidor.'
    lvl = sys.argv[3] if len(sys.argv) > 3 else None
    res = dispatch_alert(sub, msg, force_level=lvl)
    print(json.dumps(res, indent=2, ensure_ascii=False), file=sys.stderr)

