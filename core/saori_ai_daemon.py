#!/usr/bin/env python3
import json, subprocess, os, time, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

class SaoriAIHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_len = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_len).decode('utf-8', errors='ignore')
        
        if self.path == '/chat':
            try:
                data = json.loads(body)
                prompt = data.get('prompt', '')
                sender = data.get('sender', 'Staff')
                
                p = subprocess.run(
                    ['/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_executor.py', prompt, sender],
                    stdin=subprocess.DEVNULL,
                    capture_output=True, text=True, timeout=40
                )
                res_text = p.stdout.strip()
                if not res_text:
                    res_text = f"¡Hola {sender}! Mis circuitos están activos en Star. ¿Qué necesitas? 🌸"
                
                resp = json.dumps({'response': res_text}, ensure_ascii=False).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except subprocess.TimeoutExpired:
                fallback = f"¡Hola {sender}! Mis circuitos se demoraron un segundo de más en Star. ¿Me repites lo último? 🌸"
                resp = json.dumps({'response': fallback}, ensure_ascii=False).encode('utf-8')
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
                    ['/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_img_gen.py', prompt, out_path],
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
                    ['/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_tts.py', text, out_path],
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
                    ['/usr/bin/python3', '/home/jack/ai-hub/scripts/saori_stt.py', audio_file],
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
