#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI AI Status Watcher (OpenAI, Claude & Google AI Studio / Antigravity Monitor)
Monitorea los canales RSS/Atom de estado de:
1. OpenAI (ChatGPT / Codex)
2. Anthropic (Claude AI)
3. Google AI Studio / Google Cloud (Antigravity & Gemini)

Publica alertas automáticas e incidentes en vivo en el canal #📡・ᴇsᴛᴀᴅᴏ-sᴇʀᴠɪᴅᴏʀ de Discord.
"""

import os
import sys
import time
import json
import xml.etree.ElementTree as ET
import urllib.request
import re
from datetime import datetime, timezone

STATE_FILE = "/home/jack/.local/state/saori/ai_status_history.json"
DISCORD_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
CHANNEL_STATUS_ID = "1539636713675038751"  # 📡・ᴇsᴛᴀᴅᴏ-sᴇʀᴠɪᴅᴏʀ

FEEDS = [
    {
        "provider": "OpenAI (ChatGPT / Codex)",
        "icon": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/04/ChatGPT_logo.svg/1024px-ChatGPT_logo.svg.png",
        "url": "https://status.openai.com/feed.rss",
        "type": "rss",
        "color": 0x10A37F
    },
    {
        "provider": "Anthropic (Claude AI)",
        "icon": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/78/Anthropic_logo.svg/1024px-Anthropic_logo.svg.png",
        "url": "https://status.claude.com/feed.rss",
        "type": "rss",
        "color": 0xD97706
    },
    {
        "provider": "Google AI Studio & Cloud (Antigravity / Gemini)",
        "icon": "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Google_Gemini_logo.svg/1024px-Google_Gemini_logo.svg.png",
        "url": "https://status.cloud.google.com/en/feed.atom",
        "type": "atom",
        "color": 0x4285F4
    }
]

def load_processed_guids():
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"processed_guids": []}

def save_processed_guids(data):
    try:
        if len(data["processed_guids"]) > 300:
            data["processed_guids"] = data["processed_guids"][-150:]
        with open(STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"[STATUS-WATCHER] Error guardando estado: {e}", file=sys.stderr)

def strip_html(html_str):
    if not html_str:
        return ""
    clean = re.sub(r'<[^>]+>', ' ', html_str)
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()

def send_discord_embed(feed_info, title, description, link, pub_date):
    desc_clean = strip_html(description)[:1800]
    is_resolved = any(k in title.lower() or k in desc_clean.lower() for k in ["resolved", "operational", "mitigated", "normal", "resuelto", "mitigado"])
    is_major = any(k in title.lower() or k in desc_clean.lower() for k in ["outage", "elevated error", "major", "caida", "interrupcion", "degraded", "experiencing"])
    
    status_emoji = "🟢" if is_resolved else ("🔴" if is_major else "🟡")
    embed_color = 0x00FF88 if is_resolved else (0xFF0033 if is_major else 0xFFAA00)

    embed = {
        "title": f"{status_emoji} {feed_info['provider']} · {title}",
        "url": link,
        "description": desc_clean or "Actualización de infraestructura reportada.",
        "color": embed_color,
        "author": {
            "name": f"Monitor Global de Infraestructura IA · {feed_info['provider']}",
            "icon_url": feed_info["icon"]
        },
        "fields": [
            {
                "name": "⏱️ Fecha de Emisión",
                "value": pub_date or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                "inline": True
            },
            {
                "name": "🔗 Estado Oficial",
                "value": f"[Ver Reporte Completo]({link})",
                "inline": True
            }
        ],
        "footer": {
            "text": "S.A.O.R.I. SRE · Sentinel AI Status Monitor"
        },
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    payload = {
        "embeds": [embed]
    }

    url = f"https://discord.com/api/v10/channels/{CHANNEL_STATUS_ID}/messages"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bot {DISCORD_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://drakescraft.cl, 1.0)"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[STATUS-WATCHER] ✅ Incidente enviado a Discord ({resp.status}): {title}")
    except Exception as e:
        print(f"[STATUS-WATCHER] ❌ Error enviando a Discord: {e}", file=sys.stderr)

def check_rss_feed(feed_info, processed_set):
    try:
        req = urllib.request.Request(
            feed_info["url"],
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            xml_data = response.read()

        root = ET.fromstring(xml_data)
        items = root.findall(".//item")

        for item in reversed(items[:5]):
            guid = item.findtext("guid") or item.findtext("link") or item.findtext("title")
            if not guid or guid in processed_set:
                continue

            title = item.findtext("title") or "Incidente en Plataforma IA"
            link = item.findtext("link") or feed_info["url"]
            desc = item.findtext("description") or ""
            pub_date = item.findtext("pubDate") or ""

            send_discord_embed(feed_info, title, desc, link, pub_date)
            processed_set.add(guid)
            time.sleep(1)

    except Exception as e:
        print(f"[STATUS-WATCHER] Error consultando RSS {feed_info['provider']}: {e}", file=sys.stderr)

def check_atom_feed(feed_info, processed_set):
    try:
        req = urllib.request.Request(
            feed_info["url"],
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=12) as response:
            xml_data = response.read()

        root = ET.fromstring(xml_data)
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        entries = root.findall("atom:entry", ns)

        for entry in reversed(entries[:5]):
            eid = entry.findtext("atom:id", default="", namespaces=ns) or entry.findtext("atom:title", default="", namespaces=ns)
            if not eid or eid in processed_set:
                continue

            title = entry.findtext("atom:title", default="Google Cloud Service Health Update", namespaces=ns)
            link_el = entry.find("atom:link", ns)
            link = link_el.attrib.get("href") if link_el is not None else feed_info["url"]
            summary = entry.findtext("atom:summary", default="", namespaces=ns) or entry.findtext("atom:content", default="", namespaces=ns)
            pub_date = entry.findtext("atom:updated", default="", namespaces=ns)

            send_discord_embed(feed_info, title, summary, link, pub_date)
            processed_set.add(eid)
            time.sleep(1)

    except Exception as e:
        print(f"[STATUS-WATCHER] Error consultando Atom {feed_info['provider']}: {e}", file=sys.stderr)

def main():
    state = load_processed_guids()
    processed_set = set(state.get("processed_guids", []))

    print(f"=== SAORI AI Status Watcher Iniciado ({len(processed_set)} procesados previamente) ===")

    for feed in FEEDS:
        if feed["type"] == "atom":
            check_atom_feed(feed, processed_set)
        else:
            check_rss_feed(feed, processed_set)

    state["processed_guids"] = list(processed_set)
    save_processed_guids(state)

if __name__ == "__main__":
    main()
