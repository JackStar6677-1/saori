#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Sovereign Cloud Voice Engine (Pure Cloud Ingestion)
Arquitectura 100% Nube: Cero impacto de CPU/GPU en Star VPS, Nexus o Nova.

Jerarqu?a de motores generativos en la nube:
1. ElevenLabs Cloud (eleven_multilingual_v2 / eleven_v4): Voces humanas de m?xima calidad.
2. NVIDIA Cloud NIM (Magpie Multilingual NVCF): S?ntesis en cl?ster NVIDIA.
3. Edge-TTS: Salvaguarda de emergencia en red.
"""

import sys
import os
import re
import time
import json
import asyncio
import subprocess
from pathlib import Path

# Cargar variables de entorno desde .env si existe
from dotenv import load_dotenv
env_file = Path(__file__).resolve().parent.parent / ".env"
if env_file.exists():
    load_dotenv(env_file)
else:
    load_dotenv(".env")

# ElevenLabs SDK
from elevenlabs import ElevenLabs, VoiceSettings

DEFAULT_ELEVENLABS_VOICE_ID = os.environ.get("SAORI_ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # Sarah (calidez, confianza)
FALLBACK_EDGE_VOICE = "es-CL-CatalinaNeural"


def _read_key_file(env_var: str, file_paths: list[str], prefix: str = "") -> str:
    val = os.environ.get(env_var, "").strip()
    if val and (not prefix or val.startswith(prefix)):
        return val
    for p in file_paths:
        expanded = os.path.expanduser(p)
        if os.path.exists(expanded):
            try:
                with open(expanded, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                    if content and (not prefix or content.startswith(prefix)):
                        return content
            except Exception:
                pass
    return ""


def get_elevenlabs_api_key() -> str:
    return _read_key_file("ELEVENLABS_API_KEY", [
        "/home/jack/.elevenlabs_api_key",
        "~/.elevenlabs_api_key",
        "/home/jack/workspace/saori/.env",
        "/home/jack/.config/saori/elevenlabs.key"
    ])


def clean_for_speech(text: str) -> str:
    if not text:
        return ""
    # Arreglar mojibake si existiera
    if any(m in text for m in ("?", "?", "?", "?", "?")):
        try:
            repaired = text.encode("latin-1", errors="ignore").decode("utf-8", errors="ignore")
            if repaired and len(repaired) >= len(text) * 0.4:
                text = repaired
        except Exception:
            pass

    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`[^`]*`', '', text)
    text = re.sub(r'https?://\S+', 'el enlace web', text)
    text = re.sub(r'<@!?\d+>', '', text)
    text = re.sub(r'[*_~#>]', ' ', text)
    text = re.sub(r'^[\u2022\-\+]\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n[\u2022\-\+]\s*', '. ', text)
    text = re.sub(r'\b24/7\b', 'veinticuatro siete', text)
    text = re.sub(r'\bSRE\b', 'S.R.E.', text)
    text = re.sub(r'\bTPS\b', 'T.P.S.', text)
    text = re.sub(r'\bVPS\b', 'V.P.S.', text)
    text = re.sub(r'\bAPI\b', 'A.P.I.', text)
    text = re.sub(r'\bRAM\b', 'memoria ram', text)
    text = re.sub(r'\bCPU\b', 'procesador', text)
    text = re.sub(r'\bGB\b', 'gigabytes', text)
    text = re.sub(r'\bMB\b', 'megabytes', text)
    text = re.sub(r'[\U00010000-\U0010ffff]', '', text)
    text = re.sub(r'[\u2600-\u27BF\u2300-\u23FF\u2B50\u200B-\u200D\uFE0F]', '', text)
    text = re.sub(r'[^\w\s\.,;:!\???????????????\-]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def synthesize_with_elevenlabs(text: str, voice_id: str = None) -> bytes:
    """S?ntesis en la nube de ElevenLabs v?a SDK oficial con calidad humana realista."""
    api_key = get_elevenlabs_api_key()
    if not api_key:
        raise RuntimeError("No se configur? ELEVENLABS_API_KEY.")
    
    client = ElevenLabs(api_key=api_key)
    v_id = voice_id or DEFAULT_ELEVENLABS_VOICE_ID
    
    audio_generator = client.text_to_speech.convert(
        text=text,
        voice_id=v_id,
        model_id="eleven_multilingual_v2",
        output_format="mp3_44100_128",
        voice_settings=VoiceSettings(
            stability=0.5,
            similarity_boost=0.8,
            style=0.15,
            use_speaker_boost=True
        )
    )
    
    audio_bytes = bytearray()
    for chunk in audio_generator:
        audio_bytes.extend(chunk)
    return bytes(audio_bytes)


async def synthesize_with_edge_tts(text: str, temp_mp3_path: str, voice: str = FALLBACK_EDGE_VOICE):
    import edge_tts
    communicate = edge_tts.Communicate(text, voice, pitch="+0Hz", rate="+0%")
    await communicate.save(temp_mp3_path)


def transcode_to_opus(input_path: str, output_path: str) -> bool:
    cmd = [
        'ffmpeg', '-y', '-i', input_path,
        '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
        '-ar', '48000', '-ac', '1',
        output_path
    ]
    p = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return p.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 100


async def generate_voice(text: str, final_output_path: str, voice: str = None) -> str:
    clean_text = clean_for_speech(text)
    if not clean_text:
        clean_text = "Hola Jack, aqu? estoy al pie del ca??n."

    if len(clean_text) > 450:
        clean_text = clean_text[:440].rsplit('.', 1)[0] + '.'

    pid = os.getpid()
    ts = int(time.time() * 1000)
    temp_mp3 = f"/tmp/saori_raw_{pid}_{ts}.mp3"

    try:
        # Tier 1: ElevenLabs Cloud Generative Voice (SDK Oficial)
        if get_elevenlabs_api_key():
            try:
                audio_data = synthesize_with_elevenlabs(clean_text, voice_id=voice)
                with open(temp_mp3, "wb") as f:
                    f.write(audio_data)
                if transcode_to_opus(temp_mp3, final_output_path):
                    return final_output_path
            except Exception as e_el:
                sys.stderr.write(f"[SAORI-TTS] ElevenLabs Cloud fall?: {e_el}\n")

        # Tier 2: Salvaguarda edge-tts
        await synthesize_with_edge_tts(clean_text, temp_mp3)
        if transcode_to_opus(temp_mp3, final_output_path):
            return final_output_path

        import shutil
        if os.path.exists(temp_mp3):
            shutil.copyfile(temp_mp3, final_output_path)
        return final_output_path

    finally:
        if os.path.exists(temp_mp3):
            try:
                os.unlink(temp_mp3)
            except Exception:
                pass


def generate_voice_sync(text: str, final_output_path: str, voice: str = None) -> str:
    return asyncio.run(generate_voice(text, final_output_path, voice))


if __name__ == '__main__':
    if len(sys.argv) > 2:
        txt = sys.argv[1]
        out = sys.argv[2]
        custom_voice = sys.argv[3] if len(sys.argv) > 3 else None
        res = generate_voice_sync(txt, out, custom_voice)
        print(res)
    else:
        print("Uso: saori_tts.py <texto> <ruta_salida.opus> [voz_opcional]")
