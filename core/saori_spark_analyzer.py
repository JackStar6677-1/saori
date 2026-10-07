#!/usr/bin/env python3
"""
Analizador inteligente de perfiles Spark para DrakesCraft & SAORI.
Ejecuta un perfil de 60 segundos (o analiza una URL ya generada),
decodifica los StackTraceNodes del volcado en Bytebin y desglosa
con exactitud qué subsistema o plugin está consumiendo el hilo principal.
"""

import sys
import os
import json
import time
import struct
import urllib.request
import re

PTERO_KEY_PATH = os.path.expanduser('~/.pterodactyl_key')
PTERO_BASE = 'https://panel.thegamehosting.com/api/client/servers/38528a4e'

def read_varint(data, offset):
    res = 0
    shift = 0
    while True:
        if offset >= len(data):
            break
        b = data[offset]
        offset += 1
        res |= (b & 0x7f) << shift
        if not (b & 0x80):
            break
        shift += 7
    return res, offset

def parse_proto(buf):
    idx = 0
    length = len(buf)
    fields = []
    while idx < length:
        tag_var, idx = read_varint(buf, idx)
        wire = tag_var & 0x07
        field_num = tag_var >> 3
        if wire == 0:
            val, idx = read_varint(buf, idx)
            fields.append((field_num, wire, val))
        elif wire == 1:
            if idx + 8 > length: break
            val = struct.unpack('<d', buf[idx:idx+8])[0]
            idx += 8
            fields.append((field_num, wire, val))
        elif wire == 2:
            l, idx = read_varint(buf, idx)
            if idx + l > length: break
            val = buf[idx:idx+l]
            idx += l
            fields.append((field_num, wire, val))
        elif wire == 5:
            if idx + 4 > length: break
            val = struct.unpack('<f', buf[idx:idx+4])[0]
            idx += 4
            fields.append((field_num, wire, val))
        else:
            break
    return fields

def analyze_spark_url(spark_url):
    code = spark_url.rstrip('/').split('/')[-1]
    bytebin_url = f'https://bytebin.lucko.me/{code}'
    req = urllib.request.Request(bytebin_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read()
    except Exception as e:
        return {'error': f'No se pudo descargar el volcado de Bytebin: {e}'}

    top_fields = parse_proto(raw)
    thread_nodes = [val for fnum, wire, val in top_fields if fnum == 2]
    if not thread_nodes:
        return {'error': 'El volcado de Spark no contiene nodos de hilo.'}

    tfields = parse_proto(thread_nodes[0])
    nodes = []
    for fn, w, v in tfields:
        if fn == 3: # StackTraceNode
            nfields = parse_proto(v)
            cname = ''
            mname = ''
            times = []
            for nfn, nw, nv in nfields:
                if nfn == 3:
                    cname = nv.decode('utf-8', errors='ignore')
                elif nfn == 4:
                    mname = nv.decode('utf-8', errors='ignore')
                elif nfn == 8:
                    if nw == 1:
                        times.append(nv)
                    elif nw == 2:
                        for i in range(0, len(nv), 8):
                            if i+8 <= len(nv):
                                times.append(struct.unpack('<d', nv[i:i+8])[0])
            total_time = sum(times)
            if cname and total_time > 0:
                nodes.append({'class': cname, 'method': mname, 'time_ms': total_time})

    plugin_times = {}
    for n in nodes:
        cn = n['class'].lower()
        if 'io.github.sefiraat.networks' in cn or 'networks' in cn:
            pkg = 'Networks (Sefiraat)'
        elif 'slimefun' in cn or 'slimefun4' in cn:
            pkg = 'Slimefun Core'
        elif 'multiversenets' in cn:
            pkg = 'MultiverseNets (Chagui)'
        elif 'equivalencytech' in cn:
            pkg = 'EquivalencyTech'
        elif 'bentobox' in cn:
            pkg = 'BentoBox (Islas)'
        elif 'levelledmobs' in cn:
            pkg = 'LevelledMobs'
        elif 'danktech' in cn:
            pkg = 'DankTech'
        elif 'worldguard' in cn or 'worldedit' in cn:
            pkg = 'WorldGuard / WorldEdit'
        elif 'coreprotect' in cn:
            pkg = 'CoreProtect'
        elif 'multiverse' in cn:
            pkg = 'Multiverse Core/Creatures'
        elif any(b in cn for b in ['net.minecraft', 'org.bukkit', 'com.destroystokyo.paper', 'io.papermc']):
            pkg = 'Motor Vanilla/Paper'
        else:
            continue

        plugin_times[pkg] = max(plugin_times.get(pkg, 0), n['time_ms'])

    # Excluir internals del runtime (MinecraftServer, Thread, park, lambda de scheduler, etc)
    runtime_ignore = [
        'net.minecraft.server.MinecraftServer',
        'net.minecraft.server.dedicated.DedicatedServer',
        'java.lang.Thread',
        'org.bukkit.craftbukkit.scheduler',
        'com.destroystokyo.paper.ServerSchedulerReportingWrapper'
    ]
    non_jvm = [
        n for n in nodes 
        if not n['class'].startswith('java.') 
        and not n['class'].startswith('jdk.') 
        and not n['class'].startswith('native')
        and not n['class'].startswith('libc')
        and not n['class'].startswith('libjvm')
        and not any(n['class'].startswith(ign) for ign in runtime_ignore)
        and not '$$Lambda' in n['class']
    ]
    non_jvm.sort(key=lambda x: x['time_ms'], reverse=True)

    sorted_plugins = sorted(
        [(k, v) for k, v in plugin_times.items() if k != 'Motor Vanilla/Paper'],
        key=lambda x: x[1], reverse=True
    )

    return {
        'url': spark_url,
        'top_methods': non_jvm[:8],
        'plugin_impact': sorted_plugins
    }

def run_live_spark_profiler(timeout_secs=60):
    if not os.path.exists(PTERO_KEY_PATH):
        return {'error': 'Falta la credencial de Pterodactyl en ~/.pterodactyl_key'}

    with open(PTERO_KEY_PATH) as f:
        key = f.read().strip()
    headers = {'Authorization': f'Bearer {key}', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0'}

    def get_logs():
        req = urllib.request.Request(f'{PTERO_BASE}/files/download?file=%2Flogs%2Flatest.log', headers=headers)
        with urllib.request.urlopen(req, timeout=5) as resp:
            dl_url = json.loads(resp.read().decode()).get('attributes', {}).get('url')
        dl_req = urllib.request.Request(dl_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(dl_req, timeout=8) as dl_resp:
            return dl_resp.read().decode('utf-8', errors='ignore').splitlines()

    cmd_req = urllib.request.Request(
        f'{PTERO_BASE}/command',
        data=json.dumps({'command': f'spark profiler start --timeout {timeout_secs}'}).encode(),
        headers={**headers, 'Content-Type': 'application/json'}
    )
    try:
        urllib.request.urlopen(cmd_req, timeout=5)
    except Exception as e:
        return {'error': f'Error enviando comando a Dallas: {e}'}

    time.sleep(timeout_secs + 2)
    for _ in range(15):
        time.sleep(2)
        lines = get_logs()
        for line in reversed(lines[-25:]):
            m = re.search(r'https://spark\.lucko\.me/([a-zA-Z0-9]+)', line)
            if m:
                url = m.group(0)
                return analyze_spark_url(url)

    return {'error': 'El perfilador no devolvió el enlace en el tiempo esperado.'}

def formatear_diagnostico_tps(analisis):
    if not analisis or 'error' in analisis:
        return f"❌ No se pudo completar el análisis Spark: {analisis.get('error', 'Error desconocido')}"

    url = analisis.get('url', '')
    plugins = analisis.get('plugin_impact', [])
    metodos = analisis.get('top_methods', [])

    texto = [
        "⚡ **Diagnóstico Spark SRE (60s) · Hilo Principal**",
        f"🔗 **Spark Viewer:** {url}\n",
        "📊 **Consumo Acumulado por Plugins/Subsistemas:**"
    ]

    for pkg, t in plugins[:6]:
        texto.append(f"• **{pkg}**: `{t:,.1f} ms`")

    if metodos:
        texto.append("\n🔍 **Operaciones / Métodos Críticos en el Hilo Principal:**")
        for m in metodos[:5]:
            c_short = m['class'].split('.')[-1]
            texto.append(f"• `{c_short}.{m['method']}()`: `{m['time_ms']:,.1f} ms`")

    # Diagnóstico de causa raíz
    texto.append("\n📋 **Causa Raíz Identificada:**")
    top_plugin = plugins[0][0] if plugins else ""
    if 'Slimefun' in top_plugin:
        texto.append(
            "Los tirones se deben principalmente al **ticking de bloques de Slimefun** (`TickerTask`) "
            "y los procesadores de red/cables de **Networks** (`NetworkDirectional`, `NetworkAutoCrafter`). "
            "No son entidades sueltas ni chunks corruptos, sino alta carga de máquinas/redes activas de jugadores."
        )
    elif 'MultiverseNets' in top_plugin:
        texto.append("Se detecta alta actividad de lectura/escritura en nodos de MultiverseNets.")
    elif 'LevelledMobs' in top_plugin:
        texto.append("Cálculo intensivo de multiplicadores y spawns en LevelledMobs.")
    else:
        texto.append("La carga se divide de forma equilibrada entre eventos de servidor y plugins activos.")

    return "\n".join(texto)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1].startswith('http'):
        res = analyze_spark_url(sys.argv[1])
    else:
        print("Ejecutando perfilador Spark en vivo de 60 segundos...")
        res = run_live_spark_profiler(60)
    print(formatear_diagnostico_tps(res))
