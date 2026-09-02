#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Triad Ticket Dispatcher
Crea tickets técnicos consolidados en /home/jack/ai-hub/tickets/ y notifica a WhatsApp y Discord.
"""

import sys, os, json, time, urllib.request
from datetime import datetime

TICKETS_DIR = '/home/jack/ai-hub/tickets'
WEBHOOK_URL = 'http://127.0.0.1:8088/notify-ticket'

def create_and_dispatch_ticket(ticket_title, description, author, channel_name):
    os.makedirs(TICKETS_DIR, exist_ok=True)
    
    # Calcular próximo ID de ticket
    existing = [f for f in os.listdir(TICKETS_DIR) if f.endswith('.md')]
    ticket_num = 231 + len(existing)
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M')
    
    filename = f"TICKET_{ticket_num}_{author.replace(' ', '_')}.md"
    file_path = os.path.join(TICKETS_DIR, filename)
    
    content = f"""# 📋 TICKET #{ticket_num}: {ticket_title}

**Origen:** Discord ({channel_name})  
**Reportado por:** {author}  
**Asignado a:** Tríada de Agentes (SAORI SRE, Claude-Code, Codex)  
**Fecha:** {now_str}  
**Estado:** PENDIENTE / EN ANÁLISIS  

---

### 📝 DESCRIPCIÓN DETALLADA DEL PROBLEMA
{description}

---

### 🤖 DIRECTIVA DE RESOLUCIÓN AUTOMÁTICA
Este ticket ha sido validado y consolidado por SAORI tras confirmar que el problema está completamente explicado.
Los agentes autónomos pueden analizar logs, estado de plugins o infraestructura para su solución.
"""

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"[TICKET-DISPATCH] Ticket #{ticket_num} creado en {file_path}")

    # Notificar al webhook de WhatsApp
    try:
        payload = json.dumps({
            "ticket_id": str(ticket_num),
            "agente": "Tríada SRE (SAORI / Claude / Codex)",
            "titulo": ticket_title,
            "resumen": description[:120] + ("..." if len(description) > 120 else ""),
            "group_jid": "120363422906663864@g.us"
        }).encode('utf-8')
        req = urllib.request.Request(WEBHOOK_URL, data=payload, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=3)
    except Exception as e:
        print(f"[TICKET-DISPATCH] Error notificando webhook: {e}")

    return ticket_num

if __name__ == '__main__':
    if len(sys.argv) >= 4:
        title = sys.argv[1]
        desc = sys.argv[2]
        author = sys.argv[3]
        ch = sys.argv[4] if len(sys.argv) > 4 else 'discord'
        t_id = create_and_dispatch_ticket(title, desc, author, ch)
        print(t_id)
