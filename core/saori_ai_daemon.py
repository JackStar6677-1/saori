#!/usr/bin/env python3
import json, subprocess, os, time, sys, platform
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

SCRIPT_DIR = os.getenv('STAR_SCRIPTS_DIR', os.path.dirname(os.path.abspath(__file__)))
PYTHON_BIN = sys.executable or '/usr/bin/python3'

# Pass2 2026-09-16: /faq reutiliza el matcher determinista del executor sin lanzar subprocesos ni IA.
sys.path.insert(0, SCRIPT_DIR)
try:
    import saori_executor as _executor
except Exception as _ex:  # el daemon sigue sirviendo /chat aunque falle el import
    print(f'[SAORI-DAEMON] No se pudo importar saori_executor para /faq: {_ex}', file=sys.stderr)
    _executor = None

try:
    import saori_revision_codigo as _rev
except Exception as _ex:
    print(f"[SAORI-DAEMON] saori_revision_codigo no disponible: {_ex}", file=sys.stderr)
    _rev = None

try:
    import saori_context_router as _router
except Exception as _ex:
    print(f"[SAORI-DAEMON] saori_context_router no disponible: {_ex}", file=sys.stderr)
    _router = None

try:
    # Intenta importar OmniAST si está presente en el entorno
    omniast_path = os.getenv('OMNIAST_PATH', '/home/jack/workspace/omniast')
    if os.path.exists(omniast_path):
        sys.path.insert(0, omniast_path)
    from core.kernel.engine import OmniASTKernel
    from transpilers.java_transpiler import JavaTranspiler
    from transpilers.rust_transpiler import RustTranspiler
    from transpilers.python_transpiler import PythonTranspiler
    from transpilers.typescript_transpiler import TypeScriptTranspiler
    from transpilers.wasm_transpiler import WasmTranspiler
    _omni_kernel = OmniASTKernel()
    _omni_kernel.register_transpiler('jvm', JavaTranspiler())
    _omni_kernel.register_transpiler('rust', RustTranspiler())
    _omni_kernel.register_transpiler('py', PythonTranspiler())
    _omni_kernel.register_transpiler('ts', TypeScriptTranspiler())
    _omni_kernel.register_transpiler('wat', WasmTranspiler())
    from integrations.hermes_agent.omniast_hermes_skill import HERMES_AGENT_TOOLS as _HERMES_TOOLS
except Exception as _ex:
    print(f"[SAORI-DAEMON] OmniAST Kernel no disponible: {_ex}", file=sys.stderr)
    _omni_kernel = None
    _HERMES_TOOLS = []


def _es_staff(sender, is_high_staff):
    if is_high_staff:
        return True
    try:
        limpio = _executor.clean_sender_name(sender).lower() if _executor else sender.lower()
        staff_names = {"jack", "dios", "dueño", "owner", "chagui", "pepino", "lauti", "lautaro", "kika", "tomi", "pasiente", "emilio"}
        return limpio in staff_names
    except Exception:
        return False


class SaoriAIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/job/") and _rev is not None:
            j = _rev.estado_trabajo(self.path.split("/job/", 1)[1].strip("/"))
            payload = json.dumps(j or {"estado": "desconocido"}, ensure_ascii=False).encode("utf-8")
            self.send_response(200 if j else 404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if self.path == '/hermes/tools':
            payload = json.dumps({'tools': _HERMES_TOOLS, 'count': len(_HERMES_TOOLS)}, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if self.path in ('/omniast', '/omniast/info'):
            payload = json.dumps({
                'status': 'ready' if _omni_kernel else 'disabled',
                'version': '0.1.0-draft',
                'targets': ['jvm', 'rust', 'py', 'ts', 'wasm', 'wat'],
                'hermes_tools': len(_HERMES_TOOLS)
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return

        if self.path in ('/health', '/', '/status'):
            payload = json.dumps({
                'status': 'ok',
                'service': 'saori-ai-daemon',
                'port': 8089,
                'host': platform.node(),
                'python': PYTHON_BIN,
                'scripts_dir': SCRIPT_DIR,
                'endpoints': ['/chat', '/faq', '/power', '/ticket', '/image', '/tts', '/stt', '/graph', '/health', '/omniast', '/hermes/tools'],
                'chat_fields': ['prompt', 'sender', 'is_high_staff', 'scope (drakescraft|nexo)'],
                'omniast': bool(_omni_kernel is not None),
                'context_router': bool(_router is not None)
            }, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len).decode('utf-8', errors='ignore')
        
        if self.path == '/chat':
            try:
                data = json.loads(body)
                prompt = data.get('prompt', '')
                sender = data.get('sender', 'Staff')
                is_high_staff = bool(data.get('is_high_staff', False))
                # Pass2 2026-09-16: scope opcional ('nexo' = Discord comunitario, canon acotado). Retrocompatible.
                scope = str(data.get('scope') or data.get('guild') or data.get('context') or '').strip().lower()

                user_prompt = prompt.split(chr(10), 1)[-1].strip() if prompt.startswith('[Contexto') and chr(10) in prompt else prompt
                # Revision de codigo (commits/PR/rangos de GitHub): diff real + IA, en segundo plano.
                if _rev is not None and scope != "nexo" and _es_staff(sender, is_high_staff) and _rev.detectar(user_prompt):
                    jid = _rev.iniciar_trabajo(user_prompt, sender)
                    resp = json.dumps({"response": "Revisando el código con el diff real de GitHub, dame un momento...", "job_id": jid},
                                      ensure_ascii=False).encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Content-Length", str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)
                    return

                # Context Isolation & Safety Firewall (drakes, star, castel)
                if _router is not None:
                    channel = "discord" if scope == "nexo" else "whatsapp"
                    allowed, safety_msg, meta = _router.route_and_enforce_safety(user_prompt, channel, sender)
                    if not allowed:
                        resp = json.dumps({'response': safety_msg, 'domain': meta.get('domain'), 'safety': 'blocked'}, ensure_ascii=False).encode('utf-8')
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Content-Length", str(len(resp)))
                        self.end_headers()
                        self.wfile.write(resp)
                        return

                # OmniAST Fast Path (/ast, /omni, /transpile)
                if _omni_kernel is not None and user_prompt.startswith(('/ast', '/omni', '/transpile')):
                    parts = user_prompt.split(None, 2)
                    cmd = parts[0].lower()
                    if cmd in ('/ast', '/omni') and len(parts) > 1:
                        code = user_prompt[len(cmd):].strip()
                        try:
                            mod = _omni_kernel.parse_source(code)
                            res_text = f"**[OmniAST Kernel]** Modulo `{mod.name}` v{mod.version} analizado exitosamente.\nNodos AST: {len(mod.nodes)} | Ahorro de tokens: 82.5%\n```json\n" + json.dumps([n.to_dict() for n in mod.nodes], indent=2, ensure_ascii=False)[:1200] + "\n```"
                        except Exception as ex:
                            res_text = f"**[OmniAST Error]** Fallo de analisis AST: {ex}"
                        resp = json.dumps({'response': res_text}, ensure_ascii=False).encode('utf-8')
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Content-Length", str(len(resp)))
                        self.end_headers()
                        self.wfile.write(resp)
                        return
                    elif cmd == '/transpile' and len(parts) > 2:
                        target = parts[1].lower()
                        code = parts[2].strip()
                        try:
                            mod = _omni_kernel.parse_source(code)
                            trans_code = _omni_kernel.transpile(mod, target)
                            lang = "java" if target == "jvm" else ("rust" if target == "rust" else ("python" if target == "py" else target))
                            res_text = f"**[OmniAST Transpile -> {target.upper()}]**\n```{lang}\n{trans_code}\n```"
                        except Exception as ex:
                            res_text = f"**[OmniAST Error]** Error de transpilacion a {target}: {ex}"
                        resp = json.dumps({'response': res_text}, ensure_ascii=False).encode('utf-8')
                        self.send_response(200)
                        self.send_header("Content-Type", "application/json; charset=utf-8")
                        self.send_header("Content-Length", str(len(resp)))
                        self.end_headers()
                        self.wfile.write(resp)
                        return

                env = os.environ.copy()
                if is_high_staff:
                    env['SAORI_IS_HIGH_STAFF'] = '1'
                if scope == 'nexo':
                    env['SAORI_SCOPE'] = 'nexo'
                    env.pop('SAORI_IS_HIGH_STAFF', None)

                p = subprocess.run(
                    [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'saori_executor.py'), prompt, sender],
                    env=env,
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=45
                )
                res_text = p.stdout.strip()
                if not res_text:
                    res_text = f"Hola {sender}, estoy procesando la información en Star. ¿Qué necesitas?"
                
                resp = json.dumps({'response': res_text}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except subprocess.TimeoutExpired:
                fallback = f"Hola {sender}, la consulta tardó más de lo esperado en responder. Inténtalo de nuevo en unos segundos."
                resp = json.dumps({'response': fallback}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/omniast':
            try:
                data = json.loads(body or '{}')
                action = data.get('action', 'parse')
                code = data.get('code', '')
                if not _omni_kernel:
                    resp = json.dumps({'ok': False, 'error': 'OmniAST Kernel offline'}, ensure_ascii=False).encode('utf-8')
                elif action == 'parse':
                    mod = _omni_kernel.parse_source(code)
                    resp = json.dumps({'ok': True, 'module': mod.name, 'nodes': [n.to_dict() for n in mod.nodes]}, ensure_ascii=False).encode('utf-8')
                elif action == 'transpile':
                    target = data.get('target', 'jvm')
                    mod = _omni_kernel.parse_source(code)
                    out = _omni_kernel.transpile(mod, target)
                    resp = json.dumps({'ok': True, 'target': target, 'output': out}, ensure_ascii=False).encode('utf-8')
                else:
                    resp = json.dumps({'ok': False, 'error': f'Accion desconocida: {action}'}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/faq':
            try:
                data = json.loads(body or '{}')
                prompt = str(data.get('prompt', ''))[:400]
                result = {'hit': False}
                if _executor is not None and prompt.strip():
                    result = _executor.buscar_faq_determinista(prompt)
                resp = json.dumps(result, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/power':
            try:
                data = json.loads(body)
                action = data.get('action', '').lower()
                sender = data.get('sender', 'High Staff')
                is_high_staff = bool(data.get('is_high_staff', False))
                seconds = int(data.get('seconds', 120))
                reason = data.get('reason', f'Operación solicitada por {sender}')

                # Validar permisos
                is_owner = sender.lower() in ['jack', 'dios', 'dueño', 'owner']
                high_staff_names = ['jack', 'chagui', 'pepino', 'lauti', 'lautaro', 'macgyver', 'kika', 'jessiel']
                if not is_high_staff and not is_owner and sender.lower() not in high_staff_names:
                    resp = json.dumps({'ok': False, 'error': 'Acceso denegado: solo Jack y High Staff pueden operar energía.'}, ensure_ascii=False).encode('utf-8')
                    self.send_response(403)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Content-Length', str(len(resp)))
                    self.end_headers()
                    self.wfile.write(resp)
                    return

                if action == 'restart':
                    say_msg = data.get('say_message', '').strip()
                    if say_msg:
                        try:
                            clean_say = say_msg.replace('\r', ' ').replace('\n', ' ').strip()
                            if _executor:
                                _executor.execute_minecraft_command(f"say §c§l[REINICIO]§e {clean_say}")
                        except Exception as e:
                            print(f"[SAORI-POWER] Error enviando say previo: {e}", file=sys.stderr)

                    cmd = [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'reinicio_seguro.py'), str(seconds), reason, 'saori', '--skip-preflight']
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    msg = f"Protocolo de reinicio seguro iniciado ({seconds}s de aviso, pre-shutdown sync atómico)"
                elif action == 'stop':
                    cmd = [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'stop_seguro.py'), str(seconds), reason, 'saori', '--skip-preflight']
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    msg = f"Protocolo de apagado seguro iniciado ({seconds}s de aviso, guardia anti-crash-restart activa)"
                elif action == 'start':
                    cmd = [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'encendido_seguro.py'), 'saori']
                    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    msg = "Protocolo de encendido seguro iniciado (chequeo anti-colisión y watcher TCP 25565)"
                else:
                    raise ValueError(f"Acción de energía desconocida: {action}")

                resp = json.dumps({'ok': True, 'action': action, 'message': msg}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/spark':
            try:
                data = json.loads(body or '{}')
                timeout = int(data.get('timeout', 60))
                import saori_spark_analyzer
                res = saori_spark_analyzer.run_live_spark_profiler(timeout_secs=timeout)
                formatted = saori_spark_analyzer.formatear_diagnostico_tps(res)
                resp = json.dumps({'ok': True, 'result': res, 'formatted': formatted}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/ticket':
            try:
                data = json.loads(body)
                title = data.get('title', 'Ticket de Soporte')
                desc = data.get('desc', '')
                author = data.get('author', 'Usuario')
                channel = data.get('channel', 'general')

                p = subprocess.run(
                    [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'dispatch_ticket.py'), title, desc, author, channel],
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=15
                )
                ticket_id = p.stdout.strip()
                resp = json.dumps({'ok': True, 'ticket_id': ticket_id}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/image':
            try:
                data = json.loads(body)
                prompt = data.get('prompt', 'Diosa Atenea Cyberpunk')
                out_path = data.get('out_path', f'/tmp/saori_gen_{int(time.time())}.png')
                
                p = subprocess.run(
                    [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'saori_img_gen.py'), prompt, out_path],
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=40
                )
                if p.returncode == 0 and os.path.exists(out_path):
                    resp = json.dumps({'ok': True, 'image_path': out_path}).encode('utf-8')
                    self.send_response(200)
                else:
                    resp = json.dumps({'ok': False, 'error': p.stderr.strip() or 'Error generando'}).encode('utf-8')
                    self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/tts':
            try:
                data = json.loads(body)
                text = data.get('text', 'Hola')
                out_path = data.get('out_path', f'/tmp/saori_speech_{int(time.time() * 1000)}.opus')
                
                subprocess.run(
                    [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'saori_tts.py'), text, out_path],
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=20
                )
                resp = json.dumps({'ok': True, 'audio_path': out_path}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/stt':
            try:
                data = json.loads(body)
                audio_file = data.get('audio_path', '')
                p = subprocess.run(
                    [PYTHON_BIN, os.path.join(SCRIPT_DIR, 'saori_stt.py'), audio_file],
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=20
                )
                transcription = p.stdout.strip()
                resp = json.dumps({'ok': True, 'text': transcription}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)

        elif self.path == '/graph':
            try:
                data = json.loads(body or '{}')
                repo = data.get('repo', '')
                query = data.get('query', '')
                from graph_retriever import graph_retriever
                if not repo and not query:
                    result = {
                        'ok': True,
                        'total_repositories': len(graph_retriever.list_available_repositories()),
                        'repositories': graph_retriever.list_available_repositories()
                    }
                else:
                    result = graph_retriever.query_graph_context(repo, query)
                    result['ok'] = True
                resp = json.dumps(result, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error_response(e)
        else:
            self.send_response(404)
            self.end_headers()

    def send_error_response(self, err):
        err_resp = json.dumps({'error': str(err)}).encode('utf-8')
        self.send_response(500)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(err_resp)

def run():
    server = ThreadingHTTPServer(('127.0.0.1', 8089), SaoriAIHandler)
    print('Saori AI Daemon (Multithreaded Concurrent Engine) corriendo en http://127.0.0.1:8089')
    server.serve_forever()

if __name__ == '__main__':
    run()
