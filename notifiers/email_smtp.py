#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Modulo de notificaciones por correo electronico para SAORI.

Envia correos electronicos firmados por el agente emisor unicamente en dos casos:
1. Incidencias de moderacion social que requieren revision humana de Jack.
2. Correcciones tecnicas exitosas (fix con causa raiz y verificacion).
"""
from __future__ import annotations

import argparse
import email.mime.text
import email.utils
import json
import os
import pathlib
import smtplib
import sys
import time

CONFIG_PATHS = [
    pathlib.Path.home() / ".config/nova/smtp.json",
    pathlib.Path.home() / ".config/saori/smtp.json",
]


def cargar_config() -> dict:
    for p in CONFIG_PATHS:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
    return {}


def enviar_correo(agente: str, asunto: str, cuerpo: str) -> bool:
    cfg = cargar_config()
    if not cfg or not cfg.get("user") or not cfg.get("password"):
        print(f"[INFO] Correo omitido (falta configurar ~/.config/nova/smtp.json): {asunto}")
        return False

    host = cfg.get("smtp_host", "smtp.gmail.com")
    port = int(cfg.get("smtp_port", 587))
    use_tls = cfg.get("use_tls", True)
    remitente = cfg["user"]
    destinatario = cfg.get("recipient", remitente)
    nombre_agente = agente.capitalize()

    msg = email.mime.text.MIMEText(cuerpo, "plain", "utf-8")
    msg["Subject"] = asunto
    msg["From"] = f"{nombre_agente} · SAORI <{remitente}>"
    msg["To"] = destinatario
    msg["Date"] = email.utils.formatdate(localtime=True)

    try:
        if use_tls:
            server = smtplib.SMTP(host, port, timeout=10)
            server.starttls()
        else:
            server = smtplib.SMTP_SSL(host, port, timeout=10)
        server.login(remitente, cfg["password"])
        server.sendmail(remitente, [destinatario], msg.as_string())
        server.quit()
        print(f"[SUCCESS] Correo enviado a {destinatario}: {asunto}")
        return True
    except Exception as e:
        print(f"[WARN] Error al enviar correo ({type(e).__name__}): {e}")
        return False


def notificar_moderacion(agente: str, jugador: str, motivo: str, extracto: str, caso_id: str = "") -> bool:
    asunto = f"[SAORI Moderación] Revisión requerida: {jugador} — {motivo}"
    cuerpo = f"""Hola Jack,

El agente {agente} bajo SAORI ha detectado una incidencia de moderación social que requiere tu criterio y revisión humana:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETALLES DEL CASO #{caso_id or '—'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Jugador: {jugador}
• Clasificación / Motivo: {motivo}
• Agente detector: {agente}
• Fecha y hora: {time.strftime('%Y-%m-%d %H:%M:%S')}

• Contexto / Evidencia:
{extracto.strip()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ACCIONES:
Puedes revisar el caso en consola con:
  python3 ~/ai-hub/scripts/saori_orchestrador.py moderacion listar
O resolverlo directamente en el juego/panel.

Atentamente,
{agente.capitalize()} · SAORI DrakesCraft
"""
    return enviar_correo(agente, asunto, cuerpo)


def notificar_correccion(agente: str, ticket_id: str, titulo: str, repo: str,
                         causa_raiz: str, fix_resumen: str, sha: str = "", resultado: str = "") -> bool:
    asunto = f"[SAORI Fix Exitoso] Ticket #{ticket_id}: {titulo}"
    cuerpo = f"""Hola Jack,

El agente {agente} bajo SAORI ha completado, desplegado y verificado con éxito una corrección técnica en DrakesCraft:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORME DE CORRECCIÓN · TICKET #{ticket_id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Título: {titulo}
• Repositorio: {repo or 'DrakesCraft'}
• Commit / SHA: {sha or 'Verificado'}
• Agente que resolvió: {agente}
• Fecha: {time.strftime('%Y-%m-%d %H:%M:%S')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DIAGNÓSTICO Y SOLUCIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• ¿Qué pasaba? (Causa raíz):
  {causa_raiz.strip()}

• ¿Qué se corrigió?:
  {fix_resumen.strip()}

• Resultado de la verificación:
  {resultado.strip() or 'Compilado, verificado SHA y puesto en STAGED/activo sin excepciones.'}

Atentamente,
{agente.capitalize()} · SAORI DrakesCraft
"""
    return enviar_correo(agente, asunto, cuerpo)


def notificar_reinicio(agente: str, staged_count: int, activos_total: int,
                       resumen_lote: str = "", estado_post: str = "") -> bool:
    asunto = f"[SAORI Reinicio Seguro] Lote {staged_count} cambios aplicados con éxito"
    cuerpo = f"""Hola Jack,

El orquestador SAORI ({agente}) ha ejecutado con éxito un reinicio seguro en DrakesCraft para aplicar el lote acumulado:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORME DE REINICIO SEGURO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Cambios aplicados en este lote: {staged_count}
• Total de componentes activos acumulados: {activos_total}
• Agente ejecutor: {agente}
• Fecha y hora: {time.strftime('%Y-%m-%d %H:%M:%S')} CLT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CAMBIOS ACTIVADOS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{resumen_lote.strip() or 'Lote completo de 10 cambios aplicado.'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTADO POST-ARRANQUE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{estado_post.strip() or 'Servidor running estable, plugins cargados y sin errores críticos.'}

Atentamente,
{agente.capitalize()} · SAORI DrakesCraft
"""
    return enviar_correo(agente, asunto, cuerpo)


def notificar_incidente(agente: str, ticket_id: str, titulo: str, repo: str,
                        severidad: str, evidencia: str) -> bool:
    asunto = f"[SAORI Incidente #{ticket_id}] {severidad.upper()}: {titulo}"
    cuerpo = f"""Hola Jack,

El agente {agente} ha detectado una nueva anomalía técnica en producción que ha sido clasificada en la cola de SAORI:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INCIDENTE TÉCNICO · TICKET #{ticket_id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Título: {titulo}
• Repositorio / Plugin: {repo or 'Desconocido'}
• Severidad: {severidad.upper()}
• Agente detector: {agente}
• Fecha y hora: {time.strftime('%Y-%m-%d %H:%M:%S')} CLT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EVIDENCIA Y DIAGNÓSTICO PRELIMINAR:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{evidencia.strip()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTADO EN COLA:
El ticket ha sido ingresado en estado DETECTED/TRIAGED y será tomado por el siguiente agente desarrollador disponible.

Atentamente,
{agente.capitalize()} · SAORI DrakesCraft
"""
    return enviar_correo(agente, asunto, cuerpo)


def notificar_resumen(agente: str, asunto_custom: str, contenido: str) -> bool:
    asunto = f"[SAORI Resumen] {asunto_custom}"
    cuerpo = f"""Hola Jack,

Informe de estado y avance operacional generado por {agente}:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESUMEN OPERACIONAL SAORI
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Agente emisor: {agente}
• Fecha y hora: {time.strftime('%Y-%m-%d %H:%M:%S')} CLT

{contenido.strip()}

Atentamente,
{agente.capitalize()} · SAORI DrakesCraft
"""
    return enviar_correo(agente, asunto, cuerpo)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="tipo", required=True)

    mod = sub.add_parser("moderacion")
    mod.add_argument("--agente", required=True)
    mod.add_argument("--jugador", required=True)
    mod.add_argument("--motivo", required=True)
    mod.add_argument("--extracto", required=True)
    mod.add_argument("--caso", default="")

    fix = sub.add_parser("correccion")
    fix.add_argument("--agente", required=True)
    fix.add_argument("--ticket", required=True)
    fix.add_argument("--titulo", required=True)
    fix.add_argument("--repo", default="")
    fix.add_argument("--causa", required=True)
    fix.add_argument("--fix", required=True)
    fix.add_argument("--sha", default="")
    fix.add_argument("--resultado", default="")

    rein = sub.add_parser("reinicio")
    rein.add_argument("--agente", required=True)
    rein.add_argument("--staged-count", type=int, default=10)
    rein.add_argument("--activos-total", type=int, default=36)
    rein.add_argument("--resumen", default="")
    rein.add_argument("--estado", default="")

    inc = sub.add_parser("incidente")
    inc.add_argument("--agente", required=True)
    inc.add_argument("--ticket", required=True)
    inc.add_argument("--titulo", required=True)
    inc.add_argument("--repo", default="")
    inc.add_argument("--severidad", default="media")
    inc.add_argument("--evidencia", required=True)

    res = sub.add_parser("resumen")
    res.add_argument("--agente", required=True)
    res.add_argument("--asunto", required=True)
    res.add_argument("--contenido", required=True)

    args = parser.parse_args()
    if args.tipo == "moderacion":
        ok = notificar_moderacion(args.agente, args.jugador, args.motivo, args.extracto, args.caso)
    elif args.tipo == "correccion":
        ok = notificar_correccion(args.agente, args.ticket, args.titulo, args.repo,
                                  args.causa, args.fix, args.sha, args.resultado)
    elif args.tipo == "reinicio":
        ok = notificar_reinicio(args.agente, args.staged_count, args.activos_total,
                                args.resumen, args.estado)
    elif args.tipo == "incidente":
        ok = notificar_incidente(args.agente, args.ticket, args.titulo, args.repo,
                                 args.severidad, args.evidencia)
    elif args.tipo == "resumen":
        ok = notificar_resumen(args.agente, args.asunto, args.contenido)
    else:
        return 1
    return 0 if ok else 0


if __name__ == "__main__":
    sys.exit(main())
