#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Voice Generator (Voz Chilena Femenina · Catalina Neural)
Genera notas de voz en formato OGG/OPUS y MP3 para WhatsApp y Discord.
"""

import sys, os, asyncio, edge_tts, subprocess

VOICE_CHILEAN_FEMALE = 'es-CL-CatalinaNeural'

async def generate_voice(text, final_output_path):
    # Limpiar URLs, menciones, emojis y formatos para que la voz suene limpia y natural
    import re
    clean_text = re.sub(r'https?://\S+', 'el enlace web', text)
    clean_text = re.sub(r'<@!?\d+>', '', clean_text)
    clean_text = re.sub(r'[\U00010000-\U0010ffff]', '', clean_text)
    clean_text = re.sub(r'[^\w\s\.,;:!\?¿¡áéíóúÁÉÍÓÚñÑ\-]', ' ', clean_text)
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    if not clean_text:
        clean_text = "Hola, aquí estoy."

    temp_mp3 = f"/tmp/saori_raw_{os.getpid()}_{int(asyncio.get_event_loop().time() * 1000)}.mp3"
    try:
        communicate = edge_tts.Communicate(clean_text, VOICE_CHILEAN_FEMALE, pitch="+0Hz", rate="+5%")
        await communicate.save(temp_mp3)

        # Convertir a OGG Opus estándar 48kHz mono compatible con WhatsApp PTT y Discord
        cmd = [
            'ffmpeg', '-y', '-i', temp_mp3,
            '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
            '-ar', '48000', '-ac', '1',
            final_output_path
        ]
        p = subprocess.run(cmd, capture_output=True)
        if p.returncode == 0 and os.path.exists(final_output_path) and os.path.getsize(final_output_path) > 100:
            return final_output_path
        else:
            # Fallback: copiar el mp3
            import shutil
            shutil.copyfile(temp_mp3, final_output_path)
            return final_output_path
    finally:
        if os.path.exists(temp_mp3):
            try:
                os.unlink(temp_mp3)
            except:
                pass

if __name__ == '__main__':
    if len(sys.argv) > 2:
        txt = sys.argv[1]
        out_path = sys.argv[2]
        res = asyncio.run(generate_voice(txt, out_path))
        print(res)
