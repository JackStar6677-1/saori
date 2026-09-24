# -*- coding: utf-8 -*-
"""
SAORI Tier 0 Local Offline Tool Dispatcher.
Hybrid SAN (Cactus Compute Needle 2 - 14 MB) + Deterministic Syntax Rules.
Executes infrastructure queries (TPS, players, server status, staff tasks) in 0-15 ms on CPU with 0 tokens.
"""

import os
import sys
import time

# Desactivar telemetría externa anónima de Needle
os.environ["NEEDLE_TELEMETRY"] = "0"

class NeedleDispatcher:
    def __init__(self, tps_getter=None, players_getter=None, status_getter=None, tasks_getter=None):
        self.tps_getter = tps_getter
        self.players_getter = players_getter
        self.status_getter = status_getter
        self.tasks_getter = tasks_getter
        self.needle = None
        self._init_needle()

    def _init_needle(self):
        try:
            import needle

            @needle.tool
            def get_server_tps() -> str:
                """Obtener los TPS actuales, lag y rendimiento de Minecraft en vivo"""
                if self.tps_getter:
                    return self.tps_getter()
                return "⚡ TPS: 20.0 (Rendimiento óptimo sin lag)"

            @needle.tool
            def get_online_players() -> str:
                """Consultar lista de jugadores conectados y población actual en Minecraft"""
                if self.players_getter:
                    return self.players_getter()
                return "👥 Jugadores en línea: 0"

            @needle.tool
            def get_server_status() -> str:
                """Consultar estado operativo, CPU, RAM y salud general del servidor"""
                if self.status_getter:
                    return self.status_getter()
                return "🛡️ Servidor DrakesCraft: En línea y saludable"

            @needle.tool
            def get_staff_tasks() -> str:
                """Consultar lista de tareas pendientes del equipo de Staff y desarrollo"""
                if self.tasks_getter:
                    return self.tasks_getter()
                return "📋 No hay tareas pendientes críticas registradas."

            # Inicializar Needle Generación 2 (45M parámetros / 13.3 MB)
            self.needle = needle.Needle(
                tools=[get_server_tps, get_online_players, get_server_status, get_staff_tasks],
                generation=2,
                stateless=True
            )
            print("[NEEDLE-2] ⚡ Tier 0 Local Tool Dispatcher inicializado (14 MB SAN Model)", file=sys.stderr)
        except Exception as e:
            print(f"[NEEDLE-2] ⚠️ Inferencia SAN no disponible ({e}), operando en modo determinista", file=sys.stderr)
            self.needle = None

    def try_dispatch(self, prompt: str) -> str | None:
        """
        Evalúa el prompt en Tier 0:
        1. Fast-Path Determinista (0.01 ms): Coincidencias sintácticas exactas de infraestructura.
        2. Needle 2 SAN Model (~15 ms): Inferencia offline local para variaciones semánticas con confianza >= 0.55.
        3. Si la intención es conversacional o la confianza es baja, retorna None para derivar a Tier 1 (Codex).
        """
        if not prompt or not prompt.strip():
            return None

        p_lower = prompt.lower().strip()

        # Filtrar charla conversacional pura antes de evaluar
        is_greeting = any(g in p_lower for g in ["hola", "chiste", "quien eres", "cómo estás", "como estas", "que haces", "te amo", "cuentame"])
        has_infra_keyword = any(k in p_lower for k in ["tps", "lag", "rendimiento", "jugador", "jugadores", "online", "conectado", "conectados", "server", "servidor", "status", "tarea", "tareas"])

        if is_greeting and not has_infra_keyword:
            return None

        # ── 1. FAST-PATH DETERMINISTA SRE (< 1 ms) ──
        if any(k in p_lower for k in ["tps", "spark tps", "lag del server", "rendimiento del server"]):
            if self.tps_getter:
                res = self.tps_getter()
                if res:
                    print(f"[TIER-0] ⚡ Fast-Path TPS ejecutado determinísticamente", file=sys.stderr)
                    return res

        if any(k in p_lower for k in ["lista de jugadores", "quien esta conectado", "quién está conectado", "quienes estan jugando", "quiénes están jugando", "players online", "who is online"]):
            if self.players_getter:
                res = self.players_getter()
                if res:
                    print(f"[TIER-0] ⚡ Fast-Path Jugadores ejecutado determinísticamente", file=sys.stderr)
                    return res

        if any(k in p_lower for k in ["estado del servidor", "status del server", "como va el server", "cómo va el server", "salud del server", "uptime del server"]):
            if self.status_getter:
                res = self.status_getter()
                if res:
                    print(f"[TIER-0] ⚡ Fast-Path Estado Servidor ejecutado determinísticamente", file=sys.stderr)
                    return res

        if any(k in p_lower for k in ["tareas pendientes", "tareas del staff", "pendientes staff", "lista de tareas"]):
            if self.tasks_getter:
                res = self.tasks_getter()
                if res:
                    print(f"[TIER-0] ⚡ Fast-Path Tareas Staff ejecutado determinísticamente", file=sys.stderr)
                    return res

        # ── 2. INFERENCIA LOCAL NEEDLE 2 SAN (~15 ms en CPU) ──
        if self.needle and has_infra_keyword:
            try:
                start_t = time.time()
                res = self.needle.run(prompt.strip())
                if res and isinstance(res, dict):
                    confidence = float(res.get("confidence", 0.0))
                    results = res.get("results", [])
                    if confidence >= 0.55 and results:
                        elapsed_ms = int((time.time() - start_t) * 1000)
                        out = results[0] if isinstance(results[0], str) else str(results[0])
                        print(f"[NEEDLE-2] ⚡ Tier 0 SAN Inferencia ({confidence:.2f} conf, {elapsed_ms}ms CPU): {out[:60]}...", file=sys.stderr)
                        return out
            except Exception as e:
                print(f"[NEEDLE-2] Error en inferencia local: {e}", file=sys.stderr)

        return None
