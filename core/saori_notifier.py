#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Alert Dispatcher (Email SMTP & Direct WhatsApp to Jack)
Envía notificaciones de alta prioridad por correo y WhatsApp (+56963477776)
"""

import sys, os, json, smtplib, urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_CONFIG_PATH = '/home/jack/.config/saori/smtp.json'
WEBHOOK_URL = 'http://127.0.0.1:8088/notify-ticket'
JACK_WA_NUMBER = '56963477776'

def send_urgent_email(subject, body_text):
    if not os.path.exists(SMTP_CONFIG_PATH):
        return False, "No existe configuración SMTP"
    try:
        with open(SMTP_CONFIG_PATH, 'r') as f:
            cfg = json.load(f)

        msg = MIMEMultipart()
        msg['Subject'] = f"🚨 [SAORI DRAKES ALERTA] {subject}"
        msg['From'] = f"SAORI SRE <{cfg['user']}>"
        msg['To'] = cfg['recipient']

        html_content = f"""
        <html>
        <body style="font-family: Arial, sans-serif; background-color: #1a1a2e; color: #ffffff; padding: 20px;">
            <div style="background-color: #16213e; border-left: 5px solid #e94560; padding: 15px; border-radius: 8px;">
                <h2 style="color: #e94560; margin-top: 0;">🏛️ SAORI Star Core · Alerta Urgente</h2>
                <p style="font-size: 16px; line-height: 1.5;">{body_text.replace('\n', '<br>')}</p>
                <hr style="border: 1px solid #0f3460;">
                <p style="font-size: 12px; color: #a2a8d3;">Emitido automáticamente para Jack · Servidor Star & DrakesCraft</p>
            </div>
        </body>
        </html>
        """
        msg.attach(MIMEText(body_text, 'plain'))
        msg.attach(MIMEText(html_content, 'html'))

        with smtplib.SMTP(cfg['smtp_host'], cfg['smtp_port'], timeout=10) as server:
            if cfg.get('use_tls', True):
                server.starttls()
            server.login(cfg['user'], cfg['password'])
            server.send_message(msg)
        return True, "Email enviado con éxito"
    except Exception as e:
        return False, str(e)

def send_urgent_whatsapp(title, message_body):
    try:
        payload = json.dumps({
            "ticket_id": "URGENTE",
            "agente": "SAORI SRE Sentinel",
            "titulo": title,
            "resumen": message_body,
            "group_jid": f"{JACK_WA_NUMBER}@s.whatsapp.net"
        }).encode('utf-8')
        req = urllib.request.Request(WEBHOOK_URL, data=payload, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=4) as r:
            return True, "WhatsApp enviado"
    except Exception as e:
        return False, str(e)

def dispatch_alert(subject, message):
    email_ok, email_msg = send_urgent_email(subject, message)
    wa_ok, wa_msg = send_urgent_whatsapp(subject, message)
    return {
        "email": {"ok": email_ok, "detail": email_msg},
        "whatsapp": {"ok": wa_ok, "detail": wa_msg}
    }

if __name__ == '__main__':
    sub = sys.argv[1] if len(sys.argv) > 1 else 'Alerta General'
    msg = sys.argv[2] if len(sys.argv) > 2 else 'Se requiere atención en el servidor.'
    res = dispatch_alert(sub, msg)
    print(json.dumps(res, indent=2))
