#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Voice Generator (Voz Chilena Femenina · Catalina Neural)
Genera notas de voz en formato OGG/OPUS y MP3 para WhatsApp y Discord.
"""

import sys, os, asyncio, edge_tts, subprocess

VOICE_CHILEAN_FEMALE = 'es-CL-CatalinaNeural'

async def generate_voice(text, output_mp3_path):
    # Limpiar emojis o formatos especiales para que la voz suene limpia y natural
    clean_text = text.replace('*', '').replace('_', '').replace('#', '').replace('`', '')
    communicate = edge_tts.Communicate(clean_text, VOICE_CHILEAN_FEMALE, pitch="+0Hz", rate="+5%")
    await communicate.save(output_mp3_path)
    
    # Si se requiere OGG Opus para WhatsApp PTT
    output_ogg_path = output_mp3_path.replace('.mp3', '.opus')
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', output_mp3_path,
            '-c:a', 'libopus', '-b:a', '32k', '-vbr', 'on',
            '-compression_level', '10', output_ogg_path
        ], capture_output=True, check=True)
        return output_ogg_path
    except:
        return output_mp3_path

if __name__ == '__main__':
    if len(sys.argv) > 2:
        txt = sys.argv[1]
        out_path = sys.argv[2]
        res = asyncio.run(generate_voice(txt, out_path))
        print(res)
