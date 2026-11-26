#!/usr/bin/env python3
"""Macht die App nach einer Änderung fertig zum Veröffentlichen.

Aufruf im Projektordner:   python3 werkzeug/fertig.py
Mit neuer Versionsnummer:  python3 werkzeug/fertig.py --version 1.1.0

Was hier passiert:
- Alle Strecken in strecken/*.json werden geprüft (Haltestellen, Koordinaten, Ansage-Dateien,
  Rückfahrt). Bei einem Fehler bricht das Werkzeug ab und sagt, was nicht stimmt.
- strecken/index.json wird neu geschrieben (Liste aller Strecken, die die App anzeigt).
- zugang.json wird geprüft (Prüfsummen der Fahrer- und Admin-PIN; ändern geht im Admin-Bereich der App).
- app.css, fahrt.js, app.js und verwaltung.js bekommen in index.html eine neue Kennung (?v=…),
  damit jedes Tablet die geänderte Datei wirklich neu lädt.
- sw.js bekommt die Liste aller Dateien (inkl. Ansagen), damit die App ohne Netz läuft.
- version.json wird neu geschrieben. Daran erkennt die offene App, dass es eine neuere
  Fassung gibt, und lädt sie, sobald keine Fahrt läuft.
Mehrfaches Ausführen ändert nichts.
"""
import argparse, hashlib, json, pathlib, re, sys

APP = 'milo-haltestellenansage'
PROGRAMM = ('app.css', 'fahrt.js', 'app.js', 'verwaltung.js')
ORDNER = {'fonts': ('.ttf', '.woff2'), 'bilder': ('.png', '.jpg', '.svg', '.webp'), 'logo': ('.png',),
          'icons': ('.png',), 'ton': ('.mp3', '.m4a', '.ogg', '.wav')}


def fehler(text):
    print('FEHLER: ' + text)
    sys.exit(1)


def pruefe_strecken(o):
    ids, daten = [], {}
    for f in sorted((o / 'strecken').glob('*.json')):
        if f.name == 'index.json':
            continue
        try:
            s = json.loads(f.read_text(encoding='utf-8'))
        except json.JSONDecodeError as e:
            fehler(f'{f.name}: kein gültiges JSON ({e})')
        h = s.get('halte')
        if not isinstance(h, list) or len(h) < 2:
            fehler(f'{f.name}: „halte“ braucht mindestens zwei Haltestellen')
        for i, x in enumerate(h):
            if not x.get('name'):
                fehler(f'{f.name}: Haltestelle {i + 1} hat keinen Namen')
            lat, lon = x.get('lat'), x.get('lon')
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or not (47 < lat < 56 and 5 < lon < 16):
                fehler(f'{f.name}: „{x.get("name")}“ hat keine gültigen Koordinaten (lat/lon)')
        tons = [s.get('begruessung') or {}] + [x.get('ansage') or {} for x in h[1:]]
        for t in tons:
            if isinstance(t, dict) and t.get('ton') and not (o / t['ton']).is_file():
                fehler(f'{f.name}: Ansage-Datei {t["ton"]} fehlt')
        if s.get('symbol') and not (o / s['symbol']).is_file():
            fehler(f'{f.name}: Bild {s["symbol"]} fehlt')
        ids.append(f.stem)
        daten[f.stem] = s
    for i, s in daten.items():
        r = s.get('rueckfahrt')
        if r and r not in daten:
            fehler(f'{i}.json: Rückfahrt „{r}“ gibt es nicht (Dateiname ohne .json angeben)')
    if not ids:
        fehler('keine Strecken in strecken/')
    return ids, daten


def pruefe_zugang(o):
    try:
        z = json.loads((o / 'zugang.json').read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as e:
        fehler(f'zugang.json fehlt oder ist kein gültiges JSON ({e})')
    pruef = re.compile(r'^[0-9a-f]{64}$')
    if not pruef.match(z.get('fahrer') or ''):
        fehler('zugang.json: „fahrer“ braucht die Prüfsumme der Fahrer-PIN')
    if z.get('admin') and not pruef.match(z['admin']):
        fehler('zugang.json: „admin“ ist keine gültige Prüfsumme')
    if z.get('admin') == z['fahrer']:
        fehler('zugang.json: Fahrer-PIN und Admin-PIN sind gleich')
    return z


def fertig(ordner, version=None):
    o = pathlib.Path(ordner)
    kurz = lambda p: hashlib.sha256((o / p).read_bytes()).hexdigest()[:10]

    ids, daten = pruefe_strecken(o)
    zugang = pruefe_zugang(o)
    (o / 'strecken' / 'index.json').write_text(json.dumps({'strecken': ids}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    index = (o / 'index.html').read_text(encoding='utf-8')
    for datei in PROGRAMM:
        index, n = re.subn(re.escape(datei) + r'\?v=[0-9a-zA-Z]*', datei + '?v=' + kurz(datei), index)
        assert n == 1, f'{datei}: in index.html {n}-mal gefunden, erwartet 1-mal'
    m = re.search(r'<script>window\.HSA = (\{.*?\});</script>', index, flags=re.S)
    assert m, 'window.HSA in index.html nicht gefunden'
    cfg = json.loads(m.group(1))
    if version:
        cfg['version'] = version

    dateien = [d + '?v=' + kurz(d) for d in PROGRAMM] + ['manifest.webmanifest', 'zugang.json', 'strecken/index.json']
    dateien += ['strecken/' + i + '.json' for i in ids]
    for unter, endungen in ORDNER.items():
        if (o / unter).is_dir():
            dateien += [unter + '/' + f.name for f in sorted((o / unter).iterdir()) if f.suffix.lower() in endungen]

    setze = lambda c: index[:m.start(1)] + json.dumps(c, ensure_ascii=False) + index[m.end(1):]
    sw = (o / 'sw.js').read_text(encoding='utf-8')
    kopf = re.compile(r'^const CACHE = .*;$', flags=re.M)
    assert len(kopf.findall(sw)) == 1, 'sw.js: Zeile „const CACHE = …;“ nicht eindeutig'
    h = hashlib.sha256()
    for d in dateien:
        h.update(d.split('?')[0].encode())
        h.update((o / d.split('?')[0]).read_bytes())
    h.update(setze(dict(cfg, stand='')).encode())
    h.update(kopf.sub('const CACHE = "", DATEIEN = [];', sw).encode())
    cfg['stand'] = h.hexdigest()[:10]

    (o / 'index.html').write_text(setze(cfg), encoding='utf-8')
    zeile = 'const CACHE = ' + json.dumps('hsa-' + cfg['version'] + '-' + cfg['stand']) + ', DATEIEN = ' + json.dumps(dateien, ensure_ascii=False) + ';'
    (o / 'sw.js').write_text(kopf.sub(lambda _: zeile, sw), encoding='utf-8')
    (o / 'version.json').write_text(json.dumps({'app': APP, 'version': cfg['version'], 'stand': cfg['stand']}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    print(f'Fertig: Version {cfg["version"]}, Stand {cfg["stand"]}, {len(ids)} Strecken, {len(dateien)} Dateien im Gerätespeicher.')
    if not zugang.get('admin'):
        print('  Hinweis: noch keine Admin-PIN in zugang.json – der Admin-Bereich ist gesperrt.')
    for i in ids:
        s = daten[i]
        aufn = sum(1 for t in [s.get('begruessung') or {}] + [x.get('ansage') or {} for x in s['halte'][1:]] if isinstance(t, dict) and t.get('ton'))
        print(f'  {i}: {s["halte"][0]["name"]} → {s.get("ziel") or s["halte"][-1]["name"]}, {len(s["halte"])} Halte, {aufn} Aufnahmen')


if __name__ == '__main__':
    a = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    a.add_argument('--version')
    a.add_argument('ordner', nargs='?', default=str(pathlib.Path(__file__).resolve().parent.parent))
    x = a.parse_args()
    fertig(x.ordner, x.version)
