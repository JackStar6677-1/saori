#!/usr/bin/env python3
"""
Publica el resultado de una pasada de agente donde el widget NOVA CONTROL pueda leerlo.

Lo usan por igual claude-code, codex y antigravity: quien termina una pasada
escribe su entrada y el plasmoide muestra la ultima de cada uno. Asi Jack ve que
paso sin abrir el chat del agente, que era el problema: una automatizacion que no
se ve, para el que la mira, no se distingue de una que no corre.

Uso desde otro agente o desde un script:

    python3 reportar_pasada_agente.py \\
        --agente claude-code \\
        --estado ok \\
        --resumen "Sin errores nuevos en 6 h" \\
        --accion "LiteXpansion ee0ded4c desplegado y verificado" \\
        --accion "WorldwideChat 4f11bfd6 desplegado" \\
        --pendiente "Faltan 2 STAGED para el umbral"

Estados: ok (verde), aviso (ambar), error (rojo), bloqueo (gris).

El archivo se escribe de forma atomica y guarda como mucho las ultimas
MAX_HISTORIAL pasadas por agente, para que no crezca sin limite.
"""

import argparse
import json
import os
import pathlib
import sys
import tempfile
import time

ESTADO = pathlib.Path.home() / ".local/state/nova/agentes.json"
MAX_HISTORIAL = 12
ESTADOS = ("ok", "aviso", "error", "bloqueo")


def cargar():
    """Lee el estado previo. Un archivo corrupto no debe impedir escribir el nuevo."""
    if not ESTADO.is_file():
        return {"schema": 1, "agentes": {}}
    try:
        d = json.loads(ESTADO.read_text(encoding="utf-8"))
        d.setdefault("agentes", {})
        return d
    except (ValueError, OSError):
        return {"schema": 1, "agentes": {}}


def guardar(datos):
    """Escritura atomica: el widget puede estar leyendo en cualquier momento."""
    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(ESTADO.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(datos, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, ESTADO)
    except Exception:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[1])
    ap.add_argument("--agente", required=True,
                    help="claude-code, codex o antigravity")
    ap.add_argument("--estado", required=True, choices=ESTADOS)
    ap.add_argument("--resumen", required=True,
                    help="una linea, lo que se vera de un vistazo")
    ap.add_argument("--accion", action="append", default=[],
                    help="algo que se corrigio o desplego (repetible)")
    ap.add_argument("--pendiente", action="append", default=[],
                    help="lo que queda por hacer (repetible)")
    ap.add_argument("--ventana", default="",
                    help="periodo de log revisado, ej. 06:00-12:00")
    ap.add_argument("--proyecto", default="drakescraft")
    a = ap.parse_args()

    datos = cargar()
    entrada = {
        "ts": int(time.time()),
        "estado": a.estado,
        "resumen": a.resumen[:240],
        "acciones": [x[:200] for x in a.accion][:8],
        "pendientes": [x[:200] for x in a.pendiente][:6],
        "ventana": a.ventana[:60],
        "proyecto": a.proyecto[:40],
    }

    agente = datos["agentes"].setdefault(a.agente, {"historial": []})
    agente["ultima"] = entrada
    agente["historial"] = ([entrada] + agente.get("historial", []))[:MAX_HISTORIAL]
    datos["actualizado"] = entrada["ts"]

    try:
        guardar(datos)
    except OSError as e:
        print(f"[ERROR] no se pudo escribir {ESTADO}: {e}")
        return 1
    print(f"[SUCCESS] {a.agente}: {a.estado} — {a.resumen[:70]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
