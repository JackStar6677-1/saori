#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SAORI Voice Transcriber (STT)
Transcribe audios entrantes de WhatsApp o Discord a texto en español usando SpeechRecognition / Google STT.
"""

import sys, os, subprocess, time, speech_recognition as sr

def transcribe_audio(input_audio_path):
    # Convertir a WAV 16kHz mono para compatibilidad universal con SpeechRecognition
    wav_path = f'/tmp/saori_in_transcribe_{os.getpid()}_{int(time.time() * 1000)}.wav'
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', input_audio_path,
            '-ar', '16000', '-ac', '1', wav_path
        ], capture_output=True, check=True)
    except Exception as e:
        return f"[Error convirtiendo audio: {e}]"

    r = sr.Recognizer()
    try:
        with sr.AudioFile(wav_path) as source:
            audio_data = r.record(source)
            text = r.recognize_google(audio_data, language='es-CL')
            return text
    except sr.UnknownValueError:
        return "[Audio inaudible o vacío]"
    except Exception as e:
        return f"[Error transcribiendo: {e}]"
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)

if __name__ == '__main__':
    if len(sys.argv) > 1:
        path = sys.argv[1]
        print(transcribe_audio(path))
