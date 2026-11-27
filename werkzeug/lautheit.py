#!/usr/bin/env python3
"""Ansagen gleich laut und kräftig machen:  python3 werkzeug/lautheit.py [Dateien …]

Ohne Angabe werden alle ton/*.mp3 bearbeitet. ElevenLabs liefert die Aufnahmen sehr leise
(Paula: −27 bis −31 LUFS). Im Bus mit kleinen Lautsprechern und Motorgeräusch braucht es
mehr: Ziel sind −16 LUFS, Spitzen höchstens −1,5 dBFS.

Ablauf je Datei: auf −20 LUFS bringen → sanft verdichten (leise Silben etwas lauter) →
auf −16 LUFS anheben → Spitzen mit einem Begrenzer abfangen → MP3 44,1 kHz mono 128 kbit/s.
Dateien, die schon passen (±0,5 LU, Spitze ≤ −1 dBFS), bleiben unverändert – das Werkzeug
kann also nach jeder neuen Aufnahme einfach wieder über alle laufen.
Braucht ffmpeg.
"""
import pathlib
import re
import subprocess
import sys
import tempfile

ZIEL = -16.0          # LUFS
SPITZE_MAX = -1.0     # dBFS, gemessen nach dem MP3-Kodieren
TOLERANZ = 0.5        # LU
BEGRENZER = 10 ** (-1.5 / 20)
VERDICHTER = 'acompressor=threshold={:.4f}:ratio=3:attack=5:release=100:knee=6:makeup=1'.format(10 ** (-24 / 20))


def miss(datei, filter_=None):
    """Integrierte Lautheit (LUFS) und Spitzenpegel (dBFS) nach EBU R 128."""
    af = (filter_ + ',' if filter_ else '') + 'ebur128=peak=sample'
    aus = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(datei), '-af', af, '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    lufs = float(re.findall(r'I:\s+(-?[\d.]+|-inf) LUFS', aus)[-1])
    spitze = float(re.findall(r'Peak:\s+(-?[\d.]+|-inf) dBFS', aus)[-1])
    return lufs, spitze


def bearbeite(datei):
    vorher, spitze_vorher = miss(datei)
    if abs(vorher - ZIEL) <= TOLERANZ and spitze_vorher <= SPITZE_MAX:
        return f'{datei.name}: passt schon ({vorher:.1f} LUFS)'
    kette1 = f'volume={-20 - vorher:.2f}dB,{VERDICHTER}'
    mitte, _ = miss(datei, kette1)
    anhebung = ZIEL - mitte
    with tempfile.TemporaryDirectory() as tmp:
        neu = pathlib.Path(tmp) / datei.name
        for _ in range(3):
            kette = f'{kette1},volume={anhebung:.2f}dB,alimiter=limit={BEGRENZER:.4f}:attack=5:release=50:level=0'
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', str(datei), '-af', kette,
                            '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', str(neu)], check=True)
            nachher, spitze = miss(neu)
            if abs(nachher - ZIEL) <= TOLERANZ / 2:
                break
            anhebung += ZIEL - nachher       # Begrenzer hat etwas weggenommen: nachjustieren
        if spitze > SPITZE_MAX:
            sys.exit(f'{datei.name}: Spitze {spitze:.1f} dBFS zu hoch – nicht übernommen')
        datei.write_bytes(neu.read_bytes())
    return f'{datei.name}: {vorher:.1f} → {nachher:.1f} LUFS (+{nachher - vorher:.1f} dB), Spitze {spitze_vorher:.1f} → {spitze:.1f} dBFS'


if __name__ == '__main__':
    ordner = pathlib.Path(__file__).resolve().parent.parent
    dateien = [pathlib.Path(a).resolve() for a in sys.argv[1:]] or sorted((ordner / 'ton').glob('*.mp3'))
    for d in dateien:
        print(bearbeite(d), flush=True)
