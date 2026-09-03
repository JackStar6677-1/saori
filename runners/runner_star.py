#!/usr/bin/env python3
"""Ejecuta un agente CLI en Star solo cuando el modo central lo autoriza.

Gestiona automaticamente el ciclo de cuota:
- Si detecta limite (5h o semanal), calcula la hora real en CLT y pausa el agente.
- Cuando expira el limite (hora de reactivacion), lo despausa automaticamente,
  emite heartbeat con cuota ok y lo pone en linea con su contexto.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import threading
import time

ROOT = pathlib.Path.home() / "ai-hub"
WORKSPACE = pathlib.Path.home() / "workspace/drakescraft"
PROMPTS = ROOT / "handoff/prompts"
LOG_DIR = ROOT / "log/star-agents"
STATE_DIR = pathlib.Path.home() / ".local/state/saori/agents"
AGENT_CONTROL = pathlib.Path.home() / ".local/state/nova/agent-control.json"
MINUTES = {"codex": (0, 30), "claude-code": (12, 42), "antigravity": (24, 54)}
def get_codex_command() -> list[str]:
    """Construye Codex en Terra/medium, el perfil operativo solicitado por Jack."""
    return [
        "codex", "exec", "-C", str(WORKSPACE),
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m", "gpt-5.6-terra",
        "-c", 'model_reasoning_effort="medium"',
        "-",
    ]


COMMANDS = {
    "codex": [
        "codex", "exec", "-C", str(WORKSPACE),
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
        "-m", "gpt-5.6-terra",
        "-c", 'model_reasoning_effort="medium"',
        "-",
    ],
    "claude-code": [
        "claude",
        "--model", "opus",
        "--effort", "medium",
        "--dangerously-skip-permissions",
        "-p",
    ],
    "antigravity": [
        "agy",
        "--model", "Gemini 3.7 Flash (Medium)",
        "--mode", "accept-edits",
        # La salida JSON oficial incluye usage.input/output/thinking/cache/total.
        # Sin ella el widget solo puede decir "no medible".
        "--output-format", "json", "--print-timeout", "20m", "-p",
    ],
}


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Ejecuta un comando con PATH explícito y errores auditables."""
    env = dict(os.environ)
    env["PATH"] = f"{pathlib.Path.home()}/.local/bin:" + env.get("PATH", "/usr/bin:/bin")
    return subprocess.run(command, env=env, **kwargs)


def orchestrator_heartbeat(agent: str, *, error: str | None = None) -> None:
    """Publica presencia independientemente de que el modelo siga el prompt.

    Presencia no es saldo. El runner no tiene ninguna lectura del consumo del
    proveedor, asi que no envia porcentaje: mandaba 100 fijo y con eso borraba
    la cuota real que Jack o la CLI habian medido (ticket 247). Si algun dia
    hay una fuente autoritativa, se publica con --porcentaje y --fuente cli.
    """
    command = [
        sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
        "heartbeat", "--agente", agent, "--cuota", "ok",
    ]
    if error:
        command.extend(["--error", error[:300]])
    result = run(command, text=True, capture_output=True)
    if result.returncode != 0:
        print(f"[WARN] heartbeat SAORI falló para {agent}: {result.stderr.strip()}", file=sys.stderr)


def run_agent(command: list[str], prompt: str, log: pathlib.Path, agent: str) -> int:
    """Ejecuta una CLI y renueva su heartbeat sin confiar en su comportamiento."""
    env = dict(os.environ)
    env["PATH"] = f"{pathlib.Path.home()}/.local/bin:" + env.get("PATH", "/usr/bin:/bin")
    stop = threading.Event()

    def keepalive() -> None:
        while not stop.wait(300):
            orchestrator_heartbeat(agent)
            save_state(agent, status="ejecutando", reason=None)

    with log.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(
            command,
            env=env,
            stdin=subprocess.PIPE if agent == "codex" else subprocess.DEVNULL,
            text=True,
            stdout=output,
            stderr=subprocess.STDOUT,
        )
        keeper = threading.Thread(target=keepalive, name=f"saori-heartbeat-{agent}", daemon=True)
        keeper.start()
        try:
            if agent == "codex" and process.stdin is not None:
                process.stdin.write(prompt)
                process.stdin.close()
            return process.wait(timeout=25 * 60)
        except subprocess.TimeoutExpired:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise
        finally:
            stop.set()
            keeper.join(timeout=2)


def set_pause_state(agent: str, paused: bool, reason: str = "") -> None:
    """Sincroniza el estado de pausa en agent-control.json de forma segura."""
    try:
        AGENT_CONTROL.parent.mkdir(parents=True, exist_ok=True)
        data = {}
        if AGENT_CONTROL.is_file():
            try:
                data = json.loads(AGENT_CONTROL.read_text(encoding="utf-8"))
            except Exception:
                pass
        # El contrato compartido de coordinar_agentes.py guarda las pausas en
        # `paused`. Las antiguas claves superiores por agente eran ignoradas por
        # el widget y hacían que una cuota agotada pareciera un heartbeat caído.
        pauses = data.setdefault("paused", {})
        pauses[agent] = paused
        data.pop(agent, None)
        if paused:
            reasons = data.setdefault("pause_reasons", {})
            reasons[agent] = reason or "sin-cuota"
            paused_at = data.setdefault("paused_at", {})
            paused_at[agent] = int(time.time())
        else:
            data.get("pause_reasons", {}).pop(agent, None)
            data.get("paused_at", {}).pop(agent, None)
        data["updated"] = int(time.time())
        
        fd, tmp = tempfile.mkstemp(dir=AGENT_CONTROL.parent, prefix=".ctrl-", text=True)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        os.replace(tmp, AGENT_CONTROL)
    except Exception as e:
        print(f"[WARN] No se pudo actualizar agent-control.json: {e}", file=sys.stderr)


def next_run(agent: str, now: int | None = None) -> int:
    """Calcula el próximo turno UTC del timer sin depender de systemd."""
    current = dt.datetime.fromtimestamp(now or time.time(), dt.timezone.utc)
    for add_hour in (0, 1, 2):
        base = current + dt.timedelta(hours=add_hour)
        for minute in MINUTES[agent]:
            candidate = base.replace(minute=minute, second=0, microsecond=0)
            if candidate > current:
                return int(candidate.timestamp())
    return int(current.timestamp()) + 1800


def save_state(agent: str, **values) -> None:
    """Publica estado atómico consumible por Nova Control."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    path = STATE_DIR / f"{agent}.json"
    previous = {}
    try:
        previous = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    payload = {**previous, **values, "agent": agent,
               "host": "star", "updated": int(time.time()),
               "next_scheduled": next_run(agent)}
    fd, tmp = tempfile.mkstemp(dir=STATE_DIR, prefix=f".{agent}-", text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
    except Exception:
        pathlib.Path(tmp).unlink(missing_ok=True)
        raise


def parse_reset(text: str) -> tuple[str, int | None, str]:
    """Extrae hora real de reactivación en CLT (Chile Local Time), epoch y ventana."""
    lower = text.lower()
    tipo = "7d" if any(k in lower for k in ["weekly", "seven_day", "7 d", "semanal", "upgrade to pro", "purchase more credits"]) else "5h"
    
    # 1. Buscar epoch exacto en transcripción / quotaLimits JSON
    epoch_m = re.search(r'["\']resetsAt["\']:\s*(\d{10})', text)
    if epoch_m:
        epoch = int(epoch_m.group(1))
        t_utc = dt.datetime.fromtimestamp(epoch, dt.timezone.utc)
        t_clt = t_utc - dt.timedelta(hours=4)
        rem = epoch - int(time.time())
        clt_str = f"{t_clt.hour:02d}:{t_clt.minute:02d} CLT"
        if rem <= 0:
            return f"{clt_str} (reactivado)", epoch, tipo
        elif rem < 3600:
            return f"{clt_str} (en {max(1, rem//60)}m)", epoch, tipo
        else:
            return f"{clt_str} (en {rem//3600}h {(rem%3600)//60}m)", epoch, tipo

    # Antigravity publica duraciones relativas, por ejemplo
    # "Resets in 93h29m16s". Sin este caso SAORI reintentaba la CLI cada media
    # hora durante varios dias aunque la cuota siguiera agotada.
    relative = re.search(
        r"resets?\s+in\s+(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?",
        text,
        re.IGNORECASE,
    )
    if relative and any(relative.groups()):
        days, hours, minutes, seconds = (int(value or 0) for value in relative.groups())
        duration = days * 86400 + hours * 3600 + minutes * 60 + seconds
        epoch = int(time.time()) + duration
        target_clt = dt.datetime.fromtimestamp(epoch, dt.timezone.utc) - dt.timedelta(hours=4)
        tipo = "7d" if duration >= 24 * 3600 else tipo
        return (
            f"{target_clt:%Y-%m-%d %H:%M CLT} (en {duration//3600}h {(duration%3600)//60}m)",
            epoch,
            tipo,
        )

    # Codex publica límites semanales como: "try again at Sep 1st, 2026 3:28 PM".
    # Sin la fecha, el parser anterior lo convertía erróneamente en la próxima
    # ocurrencia diaria y reintentaba cientos de veces antes del reinicio real.
    absolute = re.search(
        r"(?:try again at|available|reactiv\w*|reset\w*)[^\n]{0,40}?"
        r"([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,\s*(\d{4})\s+"
        r"(\d{1,2}):(\d{2})\s*(AM|PM)",
        text,
        re.IGNORECASE,
    )
    if absolute:
        month, day, year, hour, minute, ampm = absolute.groups()
        try:
            parsed = dt.datetime.strptime(
                f"{month} {day} {year} {hour}:{minute} {ampm}",
                "%b %d %Y %I:%M %p",
            ).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            parsed = dt.datetime.strptime(
                f"{month} {day} {year} {hour}:{minute} {ampm}",
                "%B %d %Y %I:%M %p",
            ).replace(tzinfo=dt.timezone.utc)
        epoch = int(parsed.timestamp())
        target_clt = parsed - dt.timedelta(hours=4)
        rem = epoch - int(time.time())
        clt_str = target_clt.strftime("%Y-%m-%d %H:%M CLT")
        if rem <= 0:
            return f"{clt_str} (reactivado)", epoch, "7d"
        return f"{clt_str} (en {rem//3600}h {(rem%3600)//60}m)", epoch, "7d"

    # 2. Buscar patrón en texto (ej. resets 5:10pm (UTC) o try again at 8:28 PM)
    m = re.search(r"(?:reset|available|try again|reactiv\w*|restablece(?:\s+a(?:\s+las)?)?|int[ée]ntalo de nuevo(?: el)?)[^\n]{0,80}?(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?(?:\s*\((utc|gmt)\))?", text, re.IGNORECASE)
    if not m:
        return "reinicio-no-publicado", None, tipo
    
    hh, mm, ampm, tz = m.groups()
    hour = int(hh)
    minute = int(mm)
    ampm = (ampm or "").lower().replace(".", "")
    if ampm == "pm" and hour < 12:
        hour += 12
    elif ampm == "am" and hour == 12:
        hour = 0
    
    now_utc = dt.datetime.now(dt.timezone.utc)
    target_utc = now_utc.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target_utc < now_utc - dt.timedelta(minutes=15):
        target_utc += dt.timedelta(days=1)
    
    epoch = int(target_utc.timestamp())
    target_clt = target_utc - dt.timedelta(hours=4)
    rem = epoch - int(time.time())
    clt_str = f"{target_clt.hour:02d}:{target_clt.minute:02d} CLT"
    if rem <= 0:
        desc = f"{clt_str} (reactivado)"
    elif rem < 3600:
        desc = f"{clt_str} (en {max(1, rem//60)}m)"
    else:
        desc = f"{clt_str} (en {rem//3600}h {(rem%3600)//60}m)"
    return desc, epoch, tipo


def classify(log: pathlib.Path, code: int) -> tuple[str, str | None, int | None, str | None]:
    """Clasifica fallos conocidos extrayendo la reactivacion real en CLT."""
    try:
        text = log.read_text(encoding="utf-8", errors="replace")[-65536:]
    except OSError:
        text = ""
    
    # Una ejecución correcta prevalece sobre palabras como "rate-limit" que el
    # agente puede haber citado al analizar Mojang, Discord o los propios logs.
    # Clasificar el contenido semántico de la respuesta produjo falsos agotados.
    if code == 0:
        return "activo", None, None, None

    # Solo ante fallo real revisar el transcript reciente de Claude para obtener
    # el mensaje de cuota que la CLI puede haber escrito fuera del log principal.
    if "claude" in log.name.lower():
        try:
            for tf in sorted((pathlib.Path.home() / ".claude/projects").glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)[:2]:
                text += "\n" + tf.read_text(encoding="utf-8", errors="replace")[-32768:]
        except Exception:
            pass

    if re.search(
        r"quota|rate.?limit|usage limit|session limit|limit reached|too many requests|l[ií]mite de uso|l[ií]mite de sesi[oó]n|alcanzado(?: tu| el)? l[ií]mite|sin cuota|obt[ée]n m[aá]s uso",
        text,
        re.IGNORECASE,
    ):
        desc, epoch, tipo = parse_reset(text)
        return "sin-cuota", desc, epoch, tipo
    return "error", None, None, None


def release_agent_locks(agent: str) -> None:
    """Libera bloqueos residuales cuando el proceso del agente ya terminó.

    Los prompts exigen liberarlos al cerrar, pero esta guarda evita que una salida
    anticipada conserve durante el TTL un repo y bloquee un reinicio autorizado.
    """
    state = run(
        [sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
         "estado", "--json"],
        text=True, capture_output=True,
    )
    if state.returncode != 0:
        return
    try:
        locks = json.loads(state.stdout).get("bloqueos") or []
    except (TypeError, ValueError):
        return
    for lock in locks:
        if lock.get("owner") != agent or not lock.get("resource"):
            continue
        run(
            [sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
             "desbloquear", "--agente", agent,
             "--recurso", str(lock["resource"])],
            text=True, capture_output=True,
        )


def release_legacy_lease(agent: str) -> None:
    """Libera la licencia global heredada si quedó a nombre de este agente.

    SAORI ya coordina por recursos, pero los botones y runners antiguos todavía
    consultan esta licencia. Una CLI terminada por cuota podía dejarla viva cuatro
    horas y bloquear falsamente a los demás agentes.
    """
    try:
        data = json.loads(AGENT_CONTROL.read_text(encoding="utf-8"))
        lease = data.get("lease") or {}
        token = lease.get("token")
        if lease.get("agent") != agent or not token:
            return
        run(
            [sys.executable, str(ROOT / "scripts/coordinar_agentes.py"),
             "end", agent, "--token", str(token)],
            text=True, capture_output=True,
        )
    except (OSError, ValueError, TypeError):
        return


def mantener_conocimiento() -> None:
    """Revisa el catalogo verificable de Atenea una vez por ciclo (ticket 262).

    El mantenedor lleva su propio intervalo, asi que llamarlo en cada pasada de
    cada agente no lo ejecuta seis veces por hora. Es mejor esfuerzo: si falla,
    el agente arranca igual y el catalogo queda como estaba.
    """
    try:
        salida = run([sys.executable, str(ROOT / "scripts/mantener_conocimiento_verificado.py"),
                      "--json"], text=True, capture_output=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as error:
        print(f"[WARN] mantenimiento del catalogo verificable: {error}", file=sys.stderr)
        return
    if salida.returncode != 0:
        print(f"[WARN] catalogo verificable no vigente: {salida.stdout.strip()} "
              f"{salida.stderr.strip()}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("agent", choices=tuple(COMMANDS))
    args = parser.parse_args()

    # No existe otro proceso de este agente mientras systemd mantiene el servicio
    # activo. Por tanto, cualquier bloqueo suyo al abrir pertenece a una pasada
    # anterior que ya terminó y debe limpiarse antes de reasignar roles.
    release_agent_locks(args.agent)
    release_legacy_lease(args.agent)
    
    # Comprobar modo de host
    mode = run([sys.executable, str(ROOT / "scripts/saori_host_mode.py"), "check", "--host", "star"],
               text=True, capture_output=True)
    if mode.returncode != 0:
        save_state(args.agent, status="inactivo", reason="modo-laptop")
        return 0
    
    # Comprobar si estaba restringido por cuota
    state_path = STATE_DIR / f"{args.agent}.json"
    prev_state = {}
    if state_path.is_file():
        try:
            prev_state = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    
    now = int(time.time())
    reset_epoch = prev_state.get("quota_reset_epoch")
    
    # Si estaba sin cuota: verificar si el tiempo ya venció
    if prev_state.get("status") == "sin-cuota" and reset_epoch:
        if now < reset_epoch:
            # Todavía restringido: actualizar cuenta regresiva y omitir ejecución pesada
            t_utc = dt.datetime.fromtimestamp(reset_epoch, dt.timezone.utc)
            t_clt = t_utc - dt.timedelta(hours=4)
            rem = reset_epoch - now
            clt_str = f"{t_clt.hour:02d}:{t_clt.minute:02d} CLT"
            desc = f"{clt_str} (en {max(1, rem//60)}m)" if rem < 3600 else f"{clt_str} (en {rem//3600}h {(rem%3600)//60}m)"
            save_state(args.agent, quota_reset=desc)
            # Reafirmar la pausa en cada skip. Otro cliente Codex puede emitir
            # un heartbeat con el mismo nombre, pero eso no devuelve cuota a la
            # CLI de Star ni debe hacerla aparecer como operativa.
            set_pause_state(args.agent, True, f"sin-cuota-{prev_state.get('quota_type', '5h')}")
            # Mantener fresca la presencia de SAORI, pero explícitamente marcada
            # como no disponible por cuota. Así el panel no inventa una caída.
            pausa = [sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
                     "heartbeat", "--agente", args.agent, "--cuota", "agotada",
                     "--porcentaje", "0", "--fuente", "cli",
                     "--reset-epoch", str(reset_epoch)]
            if prev_state.get("quota_type"):
                pausa.extend(["--ventana", str(prev_state["quota_type"])])
            run(pausa, text=True, capture_output=True)
            print(f"[INFO] {args.agent} en pausa por cuota ({prev_state.get('quota_type', '5h')}). Reactivacion: {desc}")
            return 0
        else:
            # YA VENCIÓ: Despausar automáticamente y poner en línea
            print(f"[INFO] Límite de {args.agent} finalizado. Reactivando automáticamente...")
            set_pause_state(args.agent, False)
            save_state(args.agent, status="activo", reason=None, quota_reset=None, quota_reset_epoch=None)
            run([sys.executable, str(ROOT / "scripts/saori_orchestrador.py"), "heartbeat", "--agente", args.agent, "--cuota", "ok"])
            
            # Notificar a Jack que el agente recuperó cuota
            run([
                sys.executable, str(ROOT / "scripts/saori_notifier.py"),
                f"Cuota Recuperada: {args.agent.upper()}",
                f"Jack, el agente {args.agent} ha recuperado cuota y vuelve a estar operativo en la Tríada.",
                "urgent"
            ], text=True, capture_output=True)

    mantener_conocimiento()

    prompt_path = PROMPTS / f"{args.agent}.md"
    if not WORKSPACE.is_dir() or not prompt_path.is_file():
        print(f"[ERROR] workspace o prompt ausente para {args.agent}", file=sys.stderr)
        return 2
    prompt = prompt_path.read_text(encoding="utf-8")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    log = LOG_DIR / f"{args.agent}-{stamp}.log"
    command = get_codex_command() if args.agent == "codex" else COMMANDS[args.agent]
    if args.agent != "codex":
        command = [*command, prompt]
    try:
        # El runner, no el LLM, es dueño de la presencia y la asignación.
        orchestrator_heartbeat(args.agent)
        run([sys.executable, str(ROOT / "scripts/saori_orchestrador.py"), "asignar"],
            text=True, capture_output=True)
        save_state(args.agent, status="ejecutando", reason=None, started=int(time.time()))
        returncode = run_agent(command, prompt, log, args.agent)
        status, reset_desc, reset_epoch, quota_type = classify(log, returncode)
        
        # Si entró en sin-cuota: pausar automáticamente y notificar a Jack
        if status == "sin-cuota":
            set_pause_state(args.agent, True, f"sin-cuota-{quota_type or '5h'}")
            agotada = [sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
                       "heartbeat", "--agente", args.agent, "--cuota", "agotada",
                       "--porcentaje", "0", "--fuente", "cli",
                       "--ventana", quota_type or "5h"]
            if reset_epoch:
                agotada.extend(["--reset-epoch", str(reset_epoch)])
            run(agotada, text=True, capture_output=True)

            if prev_state.get("status") != "sin-cuota":
                run([
                    sys.executable, str(ROOT / "scripts/saori_notifier.py"),
                    f"Alerta de Cuota Agotada: {args.agent.upper()}",
                    f"Jack, el agente {args.agent} se ha quedado sin cuota ({quota_type or '5h'}). Reactivación estimada: {reset_desc or 'Pendiente'}.",
                    "urgent"
                ], text=True, capture_output=True)
        
        save_state(args.agent, status=status,
                   reason=None if returncode == 0 else status,
                   quota_reset=reset_desc, quota_reset_epoch=reset_epoch,
                   quota_type=quota_type,
                   last_exit=returncode,
                   last_finished=int(time.time()), last_log=str(log))
        if returncode == 0:
            orchestrator_heartbeat(args.agent)
        elif status == "sin-cuota":
            # No usar orchestrator_heartbeat(): esa ayuda publica cuota=ok y
            # desharia la pausa que acabamos de detectar. El 0 aqui si es una
            # lectura directa: la CLI contesto con su pared de cuota.
            cierre = [sys.executable, str(ROOT / "scripts/saori_orchestrador.py"),
                      "heartbeat", "--agente", args.agent, "--cuota", "agotada",
                      "--porcentaje", "0", "--fuente", "cli",
                      "--ventana", quota_type or "5h",
                      "--error", f"cli-exit-{returncode}"]
            if reset_epoch:
                cierre.extend(["--reset-epoch", str(reset_epoch)])
            run(cierre, text=True, capture_output=True)
        else:
            orchestrator_heartbeat(args.agent, error=f"cli-exit-{returncode}")
        return returncode
    except subprocess.TimeoutExpired:
        save_state(args.agent, status="error", reason="timeout", last_exit=124)
        orchestrator_heartbeat(args.agent, error="timeout-25m")
        print(f"[ERROR] timeout de {args.agent}", file=sys.stderr)
        return 124
    except OSError as error:
        save_state(args.agent, status="error", reason="io-error", last_exit=2)
        print(f"[ERROR] {args.agent}: {error}", file=sys.stderr)
        return 2
    finally:
        release_agent_locks(args.agent)
        release_legacy_lease(args.agent)


if __name__ == "__main__":
    sys.exit(main())
