#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Ecosystem Context Router & Safety Firewall (v1.0.0)
Classifies and isolates queries across DrakesCraft, Star Cloud, and Educational IT.
Prevents confidential context leakage and enforces domain boundaries.
"""

import json
import os
import pathlib
import sys
from typing import Dict, Any, Tuple

DEFAULT_CONTEXTS_DIR = pathlib.Path(__file__).parent.parent / "config" / "contexts"
CONTEXTS_DIR = pathlib.Path(os.getenv("SAORI_CONTEXTS_DIR", str(DEFAULT_CONTEXTS_DIR)))

def load_context_policies() -> Dict[str, Any]:
    policies = {}
    for domain in ["drakes", "star", "castel"]:
        p_file = CONTEXTS_DIR / f"{domain}.json"
        if p_file.exists():
            with open(p_file, "r", encoding="utf-8") as f:
                policies[domain] = json.load(f)
    return policies

def classify_query_domain(prompt: str) -> str:
    lower = prompt.lower()
    
    # Institutional / Educational IT indicators
    if any(k in lower for k in ["castel", "cempudla", "ccg", "credcam", "sala", "laboratorio", "profesor", "colegio", "veyon"]):
        return "castel"
    
    # Star Infrastructure indicators
    if any(k in lower for k in ["star", "docker", "vps", "portainer", "systemd", "backup", "broker", "memoria", "omniast", "hermes"]):
        return "star"
        
    # Default: DrakesCraft gaming domain
    return "drakes"

def route_and_enforce_safety(prompt: str, channel: str, sender: str) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Evaluates safety boundaries.
    Returns: (is_allowed, sanitized_prompt_or_error, context_meta)
    """
    domain = classify_query_domain(prompt)
    policies = load_context_policies()
    policy = policies.get(domain, {})
    boundaries = policy.get("safety_boundaries", {})

    # Critical Safety Rule 1: Never allow institutional context in public Discord / public channels
    if domain == "castel" and channel in ["discord", "public_group"]:
        return False, "[SEGURIDAD SAORI] Consulta institucional bloqueada en canal publico.", {"domain": "castel", "action": "blocked"}

    # Critical Safety Rule 2: Infrastructure controls only for authorized operators
    if domain == "star" and channel == "discord" and sender.lower() not in ["jack", "operator", "admin"]:
        if any(cmd in prompt.lower() for cmd in ["reiniciar", "docker", "rm", "sudo", "token", "password"]):
            return False, "[SEGURIDAD SAORI] Comando de infraestructura restringido al operador.", {"domain": "star", "action": "restricted"}

    return True, prompt, {
        "domain": domain,
        "name": policy.get("name", domain),
        "visibility": policy.get("visibility", "public"),
        "components": policy.get("components", [])
    }

if __name__ == "__main__":
    test_queries = [
        ("Como crafteo un generador de slimefun en skyblock?", "discord", "jugador123"),
        ("Cual es el estado del contenedor saori-whatsapp?", "discord", "jack"),
        ("Hay que revisar la reserva de computacion de CastelRoomKeeper", "discord", "usuario_random"),
        ("Compila el siguiente addon de la flota de Season 2", "sre", "jack")
    ]
    for q, ch, s in test_queries:
        allowed, msg, meta = route_and_enforce_safety(q, ch, s)
        print(f"[{meta['domain'].upper()}] (Allowed: {allowed}) Channel: {ch} | Query: {q[:40]}... -> {msg[:40]}")
