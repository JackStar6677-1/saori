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

class SaoriAIHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/health', '/', '/status'):
            payload = json.dumps({
                'status': 'ok',
                'service': 'saori-ai-daemon',
                'port': 8089,
                'host': platform.node(),
                'python': PYTHON_BIN,
                'scripts_dir': SCRIPT_DIR,
                'endpoints': ['/chat', '/faq', '/power', '/ticket', '/image', '/tts', '/stt', '/health'],
                'chat_fields': ['prompt', 'sender', 'is_high_staff', 'scope (drakescraft|nexo)']
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

        elif self.path == '/faq':
            # Respuesta determinista desde el catálogo (sin IA). {'hit': bool, 'answer', 'url', 'id'}
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
