# -*- coding: utf-8 -*-
"""
SAORI â€” Unified Open Framework CLI
==================================
Command line interface for managing SAORI Kokoro, Neural Observatory,
Multi-Provider LLM orchestration, and Protocol ANOMALY.
"""

import sys
import os
import argparse
import json
import sqlite3
import shutil
from pathlib import Path

def get_kernel():
    from kokoro.kernel import KokoroKernel
    return KokoroKernel()

def cmd_status(args):
    """Displays operational status of Kokoro and active providers."""
    kernel = get_kernel()
    st = kernel.estado_general()

    print("\n" + "=" * 60)
    print(f"  ðŸ�›ï¸�  SAORI KOKORO â€” OPERATIONAL STATUS (v{st['version']})")
    print("=" * 60)
    print(f"  â€¢ Sovereign Operator : {st['operador']}")
    print(f"  â€¢ Active Invariants  : {st['invariantes_activas']}")
    print(f"  â€¢ Active Providers   : {', '.join(st['proveedores_activos']) if st['proveedores_activos'] else 'None (Configure in .env)'}")
    print(f"  â€¢ Primary Provider   : {st['primary_provider'] or 'None'}")
    print(f"  â€¢ Persistent Memories: {st['memorias_recientes_detectadas']} recent milestones indexed")
    print(f"  â€¢ ANOMALY Health     : {st['anomaly_health_score']}/100")
    print("=" * 60 + "\n")

def cmd_doctor(args):
    """Runs a complete environment, dependency and connectivity diagnosis."""
    print("\n" + "=" * 60)
    print("  ðŸ©º  SAORI DIAGNOSTIC DOCTOR")
    print("=" * 60)

    # 1. Python environment
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    py_ok = sys.version_info >= (3, 10)
    print(f"  [{'âœ“' if py_ok else 'âœ—'}] Python Version: {py_ver} (Requires >= 3.10)")

    # 2. SQLite & WAL mode
    try:
        con = sqlite3.connect(":memory:")
        con.execute("PRAGMA journal_mode=WAL;")
        con.close()
        sqlite_ok = True
    except Exception:
        sqlite_ok = False
    print(f"  [{'âœ“' if sqlite_ok else 'âœ—'}] SQLite WAL Engine: Available")

    # 3. State directories
    state_dir = Path.home() / ".local" / "state" / "saori"
    try:
        state_dir.mkdir(parents=True, exist_ok=True)
        dir_ok = os.access(state_dir, os.W_OK)
    except Exception:
        dir_ok = False
    print(f"  [{'âœ“' if dir_ok else 'âœ—'}] State Storage: {state_dir} (Writable)")

    # 4. LLM Providers Probe
    from kokoro.adapters.registry import ProviderRegistry
    reg = ProviderRegistry()
    probes = reg.run_diagnostics()

    print("\n  AI Provider Connectivity & Discovery:")
    any_connected = False
    for name, p_status in probes.items():
        cfg = p_status.get("configured", False)
        st = p_status.get("status", "unknown")
        if cfg and st == "connected":
            any_connected = True
            lat = p_status.get("latency_ms", "N/A")
            print(f"    â€¢ {name.upper():<10} : âœ“ CONNECTED ({lat} ms)")
        elif cfg:
            err = p_status.get("error", "Unknown error")
            print(f"    â€¢ {name.upper():<10} : âš ï¸� CONFIGURED BUT ERROR ({err})")
        else:
            print(f"    â€¢ {name.upper():<10} : âšª NOT CONFIGURED (No key/endpoint)")

    # Summary
    print("\n" + "-" * 60)
    if any_connected:
        print("  ðŸŽ‰ System is healthy and ready for autonomous SRE operations!")
    else:
        print("  âš ï¸�  Notice: No AI providers are connected. Run 'saori init' or edit '.env'")
        print("     to configure OpenAI, Anthropic, Gemini, or a local Ollama daemon.")
    print("=" * 60 + "\n")

def cmd_init(args):
    """Interactive onboarding wizard to configure SAORI."""
    print("\n" + "=" * 60)
    print("  âœ¨ SAORI KOKORO INITIALIZATION WIZARD")
    print("=" * 60)
    env_file = Path(".env")
    example_file = Path(".env.example")

    if env_file.exists() and not args.force:
        print("  Existing .env file detected.")
        overwrite = input("  Do you want to re-run configuration? (y/N): ").strip().lower()
        if overwrite != "y":
            print("  Aborted.")
            return

    if example_file.exists():
        shutil.copy(example_file, env_file)
        print("  âœ“ Created base .env from .env.example")
    else:
        with open(env_file, "w", encoding="utf-8") as f:
            f.write("# SAORI Configuration\nSAORI_OWNER=Lead Engineer\n")
        print("  âœ“ Created clean .env")

    print("\n  Which primary LLM provider would you like to use?")
    print("    1) Local Ollama (100% Free & Private, runs locally)")
    print("    2) Anthropic Claude (claude-3-5-sonnet, claude-3-5-haiku)")
    print("    3) OpenAI (gpt-4o, gpt-4o-mini, o3-mini)")
    print("    4) Google Gemini (gemini-2.0-flash, gemini-1.5-pro)")
    print("    5) OpenAI-Compatible (vLLM, LocalAI, DeepSeek, OpenCode)")

    choice = input("\n  Select option (1-5) [default 1]: ").strip() or "1"
    lines_to_append = []

    if choice == "1":
        model = input("  Ollama model name [default llama3.2]: ").strip() or "llama3.2"
        endpoint = input("  Ollama endpoint [default http://localhost:11434]: ").strip() or "http://localhost:11434"
        lines_to_append.extend([
            "SAORI_PRIMARY_PROVIDER=ollama",
            f"OLLAMA_BASE_URL={endpoint}",
            f"OLLAMA_MODEL={model}"
        ])
    elif choice == "2":
        key = input("  Anthropic API Key: ").strip()
        lines_to_append.extend([
            "SAORI_PRIMARY_PROVIDER=anthropic",
            f"ANTHROPIC_API_KEY={key}"
        ])
    elif choice == "3":
        key = input("  OpenAI API Key: ").strip()
        lines_to_append.extend([
            "SAORI_PRIMARY_PROVIDER=openai",
            f"OPENAI_API_KEY={key}"
        ])
    elif choice == "4":
        key = input("  Google Gemini API Key: ").strip()
        lines_to_append.extend([
            "SAORI_PRIMARY_PROVIDER=gemini",
            f"GEMINI_API_KEY={key}"
        ])
    elif choice == "5":
        base_url = input("  API Base URL (e.g. http://localhost:8000/v1): ").strip()
        key = input("  API Key (or press enter for none): ").strip() or "none"
        model = input("  Model name: ").strip()
        lines_to_append.extend([
            "SAORI_PRIMARY_PROVIDER=openai",
            f"OPENAI_COMPATIBLE_BASE_URL={base_url}",
            f"OPENAI_COMPATIBLE_API_KEY={key}",
            f"OPENAI_COMPATIBLE_MODEL={model}"
        ])

    with open(env_file, "a", encoding="utf-8") as f:
        f.write("\n# Configured via saori init\n" + "\n".join(lines_to_append) + "\n")

    print("\n  âœ“ Configuration saved to .env")
    print("  Run 'saori doctor' to verify your connection!\n")

def cmd_chat(args):
    """Interactive chat with SAORI using configured provider."""
    kernel = get_kernel()
    provider = kernel.router.registry.get_primary_provider()
    if not provider:
        print("â�Œ No AI provider configured. Run 'saori init' first.")
        return

    identity_prompt = kernel.identity.generar_prompt_base(agente="interactive-cli")
    messages = [{"role": "system", "content": identity_prompt}]

    print("\n" + "=" * 60)
    print(f"  ðŸ’¬ SAORI KOKORO CHAT (Connected to {provider.name.upper()})")
    print("  Type 'exit' or 'quit' to end session.")
    print("=" * 60 + "\n")

    while True:
        try:
            user_input = input("You > ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("exit", "quit"):
                break

            messages.append({"role": "user", "content": user_input})
            print("\nSAORI is thinking...", end="\r", flush=True)

            resp = kernel.router.despachar(messages=messages, tarea=user_input)
            print(f"SAORI > {resp.text}\n")
            print(f"      [{resp.model} | {resp.latency_seconds}s | {resp.usage.total_tokens} tokens]\n")
            messages.append({"role": "assistant", "content": resp.text})
        except KeyboardInterrupt:
            print("\nSession ended.")
            break
        except Exception as e:
            print(f"\nâ�Œ Error: {e}\n")

def cmd_observatory(args):
    """Launches Neural Observatory web interface."""
    from kokoro.observatory.dashboard import start_observatory_server
    host = args.host or "127.0.0.1"
    port = args.port or 8089
    print(f"\nðŸš€ Launching SAORI Neural Observatory on http://{host}:{port}")
    start_observatory_server(host=host, port=port)

def cmd_flight(args):
    """Flight Recorder black-box inspector and trace replayer."""
    from kokoro.observatory.flight_recorder import FlightRecorder
    recorder = FlightRecorder()

    if args.replay:
        print(f"\n  ðŸ“¼ Deterministic Causal Replay for Trace: {args.replay}")
        replay = recorder.reproduce_trace(args.replay)
        print(replay)
    else:
        print("\n  ðŸ“¦ Recent Flight Recorder Traces:")
        traces = recorder.list_traces(limit=args.limit or 15)
        for t in traces:
            print(f"    â€¢ {t.get('trace_id')} | {t.get('project')} | {t.get('agent')} | status={t.get('status')} | {t.get('created_at')}")
    print()

def cmd_anomaly(args):
    """Runs or inspects Protocol ANOMALY self-learning engine."""
    kernel = get_kernel()
    anomaly = kernel.anomaly

    if args.cycle:
        print("\n  ðŸŒ€ Running Autonomous ANOMALY Cognitive Audit Cycle...")
        res = anomaly.ejecutar_ciclo_aprendizaje_autonomo()
        print(f"    â€¢ Trace ID       : {res.get('trace_id')}")
        print(f"    â€¢ Hypotheses     : {res.get('hipotesis_generadas')} generated")
        print(f"    â€¢ Simulations    : {res.get('simulaciones_ejecutadas')} executed in sandbox")
        print(f"    â€¢ Meta-Learnings : {res.get('aprendizajes_promovidos')} promoted")
    elif args.hypotheses:
        print("\n  ðŸ”¬ Active Scientific Hypotheses:")
        hyps = anomaly.hypothesis_engine.listar_activas()
        for h in hyps:
            print(f"    â€¢ [{h['id']}] {h['hipotesis'][:65]}... (status={h['estado']})")
    elif args.learnings:
        print("\n  ðŸ§  Verified Meta-Learnings (Baseline vs Challenger):")
        learns = anomaly.meta_learning.listar_aprendizajes()
        for l in learns:
            print(f"    â€¢ [{l['id']}] {l['estrategia_optima']} (+{int(l.get('ganancia_rendimiento',0)*100)}% gain)")
    else:
        model = anomaly.self_model.compilar_modelo()
        print(f"\n  SAORI Dynamic Self-Model Health: {model.salud_general_score}/100")
        print(f"  Curiosity Foci: {len(anomaly.curiosity.escanear_oportunidades_aprendizaje())} active targets\n")

def main():
    parser = argparse.ArgumentParser(
        prog="saori",
        description="SAORI Kokoro â€” The Autonomous Multi-Agent Cognitive Framework"
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # status
    subparsers.add_parser("status", help="Show Kokoro health score, active providers, and memory stats")

    # doctor
    subparsers.add_parser("doctor", help="Run comprehensive system and AI provider diagnostics")

    # init
    p_init = subparsers.add_parser("init", help="Interactive setup wizard for new environments")
    p_init.add_argument("--force", action="store_true", help="Overwrite existing configuration")

    # chat
    subparsers.add_parser("chat", help="Interactive terminal chat with SAORI")

    # observatory
    p_obs = subparsers.add_parser("observatory", help="Launch the Neural Observatory web UI")
    p_obs.add_argument("--host", default="127.0.0.1", help="Host interface (default 127.0.0.1)")
    p_obs.add_argument("--port", type=int, default=8089, help="Port (default 8089)")

    # flight
    p_flight = subparsers.add_parser("flight", help="Black-box Flight Recorder inspector")
    p_flight.add_argument("--replay", help="Trace ID to deterministically replay")
    p_flight.add_argument("--limit", type=int, default=15, help="Number of traces to show")

    # anomaly
    p_anomaly = subparsers.add_parser("anomaly", help="Protocol ANOMALY self-learning engine")
    p_anomaly.add_argument("--cycle", action="store_true", help="Execute an autonomous learning cycle")
    p_anomaly.add_argument("--hypotheses", action="store_true", help="List active hypotheses")
    p_anomaly.add_argument("--learnings", action="store_true", help="List verified meta-learnings")

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        sys.exit(0)

    dispatch = {
        "status": cmd_status,
        "doctor": cmd_doctor,
        "init": cmd_init,
        "chat": cmd_chat,
        "observatory": cmd_observatory,
        "flight": cmd_flight,
        "anomaly": cmd_anomaly,
    }

    if args.command in dispatch:
        dispatch[args.command](args)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
