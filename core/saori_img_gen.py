#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Image Generator Engine (Pollinations AI + Codex Prompt Enhancer)
Genera imágenes hiper-detalladas a partir de prompts y las guarda en /tmp/saori_img.png
"""

import sys, os, urllib.request, urllib.parse, time, subprocess

def enhance_prompt_with_codex(raw_prompt):
    """Mejora el prompt en inglés para que la IA de imagen genere una obra de arte con canon de Saori."""
    p_lower = raw_prompt.lower()
    is_saori = any(k in p_lower for k in ['saori', 'ti misma', 'tu foto', 'como eres', 'retrato tuyo', 'dibujate'])
    
    if is_saori:
        raw_prompt += " (character features: anthropomorphic wolf creature inspired by SCP-1471 MalO, ivory canine skull face with glowing purple eyes, soft dark midnight fur, sleek black hair, plush curvy silhouette, cute, majestic, high quality digital art)"

    cmd = [
        '/home/jack/.local/bin/codex', 'exec', '--skip-git-repo-check',
        f"Transform the following image request into a single detailed, artistic English prompt for a modern image generator (max 35 words, visually stunning, highly detailed, vivid lighting): '{raw_prompt}'. Output ONLY the final prompt:"
    ]
    try:
        p = subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=12)
        if p.returncode == 0 and p.stdout.strip():
            return p.stdout.strip().replace('"', '').replace('\n', ' ')
    except:
        pass
    return raw_prompt

def generate_image(prompt, output_path="/tmp/saori_generated.png", enhance=True):
    final_prompt = enhance_prompt_with_codex(prompt) if enhance else prompt
    print(f"[SAORI-IMG] Prompt final: {final_prompt}", file=sys.stderr)

    encoded_prompt = urllib.parse.quote(final_prompt)
    seed = int(time.time() * 1000) % 1000000
    image_url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1024&height=1024&seed={seed}&nologo=true&model=flux"

    try:
        req = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=35) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            return True, output_path
    except Exception as e:
        print(f"[SAORI-IMG] Error descargando imagen: {e}", file=sys.stderr)
        return False, str(e)
    return False, "Error desconocido al generar imagen"

if __name__ == '__main__':
    if len(sys.argv) > 1:
        p = sys.argv[1]
        out = sys.argv[2] if len(sys.argv) > 2 else f"/tmp/saori_img_{int(time.time())}.png"
        ok, res = generate_image(p, out)
        if ok:
            print(res)
        else:
            print(f"ERROR: {res}", file=sys.stderr)
            sys.exit(1)
