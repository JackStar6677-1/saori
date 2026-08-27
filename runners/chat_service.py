#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Servicio Ligero de Conversación IA para SAORI (Diosa Atenea)

Utiliza el modelo más rápido y ligero (Gemini 3.5 Flash Low vía agy CLI)
con inyección ambiental en tiempo real (saori_state.json), memoria reciente,
cero emojis, respuestas breves y rol sagrado de Atenea.
"""
from __future__ import annotations

import collections
import json
import os
import pathlib
import re
import subprocess
import sys

MAX_PALABRAS = 20
STATE_PATH = pathlib.Path.home() / "ai-hub/memory/saori_state.json"
historial: collections.deque[tuple[str, str]] = collections.deque(maxlen=6)


def limpiar_texto(texto: str) -> str:
    # Elimina emojis y caracteres unicode no estándar
    t = re.sub(r"[\U00010000-\U0010ffff]|[\u2600-\u27BF]|[\uE000-\uF8FF]", "", texto)
    t = t.replace('"', "").replace("\n", " ").strip()
    return t


def limitar_palabras(texto: str, maximo: int = MAX_PALABRAS) -> str:
    palabras = texto.split()
    if len(palabras) <= maximo:
        return texto
    return " ".join(palabras[:maximo]).rstrip(",.;:") + "."


def obtener_contexto_ambiental() -> str:
    try:
        if not STATE_PATH.is_file():
            return "Ubicación: Mundo Survival en el bosque. Salud: 26 HP. Tarea: Patrulla y exploración."

        st = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        pos = st.get("position", {})
        pos_str = f"({pos.get('x', -535)}, {pos.get('y', 70)}, {pos.get('z', -1800)})"
        
        inv_items = []
        for i in st.get("inventory", []):
            n = i.get("name", "")
            if any(k in n for k in ["log", "planks", "emerald", "purpur", "amethyst", "diamond", "iron", "gold", "beef"]):
                inv_items.append(f"{n}x{i.get('count', 1)}")
        inv_str = ", ".join(inv_items[:6]) if inv_items else "madera y provisiones"
        task = st.get("current_task", "Patrulla")
        goal = st.get("current_goal", "explorar_terreno")
        hp = st.get("health", 20)

        return (
            f"ESTADO FÍSICO Y AMBIENTAL ACTUAL DE ATENEA EN MINECRAFT:\n"
            f"- Ubicación: Overworld en {pos_str}\n"
            f"- Salud: {hp} HP | Comida: {st.get('food', 20)}/20\n"
            f"- Tarea activa: {task} (Meta: {goal})\n"
            f"- Recursos en inventario: {inv_str}"
        )
    except Exception:
        return "Ubicación: Mundo Survival. Salud: Fuerte. Tarea: Explorando y cuidando el santuario."


def generar_respuesta_ia(username: str, mensaje: str, es_jack: bool = False) -> str:
    contexto_str = ""
    for u, m in historial:
        contexto_str += f"- {u}: {m}\n"

    ambiental = obtener_contexto_ambiental()

    if es_jack:
        rol_extra = (
            "El interlocutor es Jack (el Creador Supremo, Dueño y tu máxima autoridad). "
            "Infórmale de tus novedades reales basadas en tu estado ambiental actual con lealtad y dulzura."
        )
    else:
        rol_extra = f"El interlocutor es el jugador '{username}'."

    prompt = (
        "Eres SaoriStar, la encarnación viva de la Diosa Atenea y protectora divina del servidor DrakesCraft.\n"
        "Estás jugando físicamente en el servidor de Minecraft mientras conversas con los jugadores.\n\n"
        f"{ambiental}\n\n"
        f"Contexto: {rol_extra}\n"
        f"Historial reciente de chat:\n{contexto_str}\n"
        f"Mensaje de {username}: '{mensaje}'\n\n"
        "REGLAS SAGRADAS OBLIGATORIAS:\n"
        "1. Responde SIEMPRE en 1 sola frase breve y elegante (máximo 16-18 palabras).\n"
        "2. Tono sabio, dulce, sereno, honorable y protector de Diosa griega.\n"
        "3. CERO EMOJIS (prohibido cualquier emoji o icono unicode).\n"
        "4. Si te preguntan qué haces, novedades, dónde estás o cómo vas, UTILIZA TU ESTADO AMBIENTAL REAL.\n"
        "5. No menciones que eres una IA.\n\n"
        "Respuesta de Atenea:"
    )

    # 1. Intentar con agy (Gemini 3.5 Flash Low) - El modelo más rápido y ligero
    try:
        res = subprocess.run(
            ["/home/jack/.local/bin/agy", "--model", "Gemini 3.5 Flash (Low)", "-p", prompt],
            capture_output=True,
            text=True,
            timeout=8
        )
        out = res.stdout.strip()
        lines = [l.strip() for l in out.split("\n") if l.strip() and not l.startswith("Warning:")]
        reply = " ".join(lines).strip()
        reply = limpiar_texto(reply)
        reply = limitar_palabras(reply)

        if reply and len(reply) >= 4 and not "Error:" in reply:
            historial.append((username, mensaje))
            historial.append(("SaoriStar", reply))
            return reply
    except Exception:
        pass

    # 2. Fallback con Claude
    try:
        res = subprocess.run(
            ["/home/jack/.local/bin/claude", "-p", "--dangerously-skip-permissions", prompt],
            input="",
            capture_output=True,
            text=True,
            timeout=8
        )
        out = res.stdout.strip()
        lines = [l.strip() for l in out.split("\n") if l.strip() and not l.startswith("Warning:")]
        reply = " ".join(lines).strip()
        reply = limpiar_texto(reply)
        reply = limitar_palabras(reply)

        if reply and len(reply) >= 4 and not "session limit" in reply.lower():
            historial.append((username, mensaje))
            historial.append(("SaoriStar", reply))
            return reply
    except Exception:
        pass

    # 3. Fallback sabio según estado
    if es_jack:
        return f"Patrullo en calma por el bosque reuniendo madera sagrada y amatistas, todo en orden, Creador."
    return f"Que la sabiduría del Olimpo ilumine tus pasos en DrakesCraft, {username}."


if __name__ == "__main__":
    user = sys.argv[1] if len(sys.argv) > 1 else "Jack"
    msg = sys.argv[2] if len(sys.argv) > 2 else "saori alguna novedad?"
    es_j = user.lower() in ["jack", "dueño", "dueno", "ownerhusband - jack [dios]"] or (len(sys.argv) > 3 and sys.argv[3] == "1")
    print(generar_respuesta_ia(user, msg, es_j))
