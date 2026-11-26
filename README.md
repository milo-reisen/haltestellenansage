# Haltestellenansage – Milo Reisen

App für die Tablets in den Bussen von Milo Reisen. Das Tablet ist mit den Monitoren im Bus verbunden und wird
1:1 gespiegelt. Die Fahrpläne mit den Haltestellen werden vorher im Büro angelegt.

Adresse der App: **https://milo-reisen.github.io/haltestellenansage/**

## So funktioniert es

1. Der Fahrer tippt den **Fahrplan** an. Die Monitore zeigen oben Linie, Ziel und Uhrzeit, in der Mitte groß
   die nächste Haltestelle und unten den weiteren Streckenverlauf als Linie. Paula begrüßt die Fahrgäste.
2. Über dem großen Haltestellennamen steht **„Nächste Haltestelle“** in einer zart getönten Fläche – für die
   Fahrgäste eine Überschrift, für den Fahrer die Schaltfläche. Tippt er darauf, sagt Paula „Nächste Haltestelle: …“.
3. **2 Minuten nach dieser Ansage** rückt die Anzeige von selbst weiter zum folgenden Halt. Der feine Strich in der
   Fläche „Nächste Haltestelle“ zeigt die verbleibende Zeit.
4. Nach dem Endhalt zeigt die App von selbst die **Rückfahrt** an und begrüßt die neuen Fahrgäste.

Kein GPS nötig. Nochmal Tippen während der Wartezeit wiederholt die Ansage, die 2 Minuten beginnen dann neu.

**Fahrermenü:** einmal irgendwo auf die Anzeige tippen (verschwindet nach 10 Sekunden von selbst):
Halt zurück · Halt weiter (ohne Ansage) · Ansage wiederholen · Begrüßung abspielen · Rückfahrt · Fahrt beenden (zweimal tippen).

**Einstellungen** (auf der Startseite): Wechselzeit (1–5 Minuten, oder 10 Sekunden zum Ausprobieren im Büro),
Begrüßung beim Start an/aus, Rückfahrt von selbst an/aus, Testansage.

## Tablet einrichten (einmalig)

1. Auf dem Tablet **Chrome** öffnen und die Adresse oben aufrufen.
2. Menü (⋮) → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“. Danach liegt „Ansage“ als App auf dem Tablet.
3. In der App unter *Einstellungen → Testansage* prüfen, ob der Ton aus den Monitoren kommt. Lautstärke mit den Tasten am Tablet.
4. Einmal kurz mit Internet öffnen – danach läuft alles auch ohne Netz. Neue Fahrpläne kommen von selbst, sobald
   das Tablet wieder Internet hat und gerade keine Fahrt läuft.

Tipp: Unter Android kann die App „angeheftet“ werden (Einstellungen → Sicherheit → App anheften).

## Ansagen

Alle Ansagen sind mit **ElevenLabs, Stimme „Paula – Casual & normal“** aufgenommen (Geschwindigkeit 1,00,
Stabilität 50 %, Ähnlichkeit 75 %) und liegen als MP3 im Ordner `ton/`. Fehlt eine Aufnahme oder lädt sie nicht,
liest die Computerstimme des Tablets den `text` vor.

## Neuen Fahrplan anlegen

Jede Fahrtrichtung ist eine Datei in `strecken/`, z. B. `strecken/s11-nach-koeln-worringen.json`:

```json
{
  "linie": "S11",
  "kopf": "Ersatzverkehr S11",
  "farbe": "#9C1963",
  "symbol": "bilder/sev.png",
  "ziel": "Köln-Worringen",
  "rueckfahrt": "s11-nach-neuss-hbf",
  "hinweis": "optional: kurzer Hinweis für den Fahrer auf der Karte",
  "begruessung": { "ton": "ton/….mp3", "text": "Sehr geehrte Fahrgäste, …" },
  "halte": [
    { "name": "Neuss Hbf", "lat": 51.203962, "lon": 6.685509 },
    { "name": "Neuss Süd", "lat": 51.18575, "lon": 6.68925,
      "ansage": { "ton": "ton/….mp3", "text": "Nächste Haltestelle: Neuss Süd." } }
  ]
}
```

- `kopf` steht oben im Band, `ziel` unten, `farbe` ist die Farbe der Bänder und Balken.
- Der erste Halt ist der Startpunkt (wird nicht angesagt). Jeder weitere Halt bekommt seine Ansage.
- `ton`: Aufnahme als MP3 in `ton/`; `text`: Wortlaut (Ersatz für die Computerstimme). Optional pro Halt `"sprich"`,
  wenn der Name anders ausgesprochen werden soll (z. B. „Neuss Hauptbahnhof“ für „Neuss Hbf“).
- `rueckfahrt`: Dateiname (ohne `.json`) der Gegenrichtung. `lat`/`lon`: Lage der (Ersatz-)Haltestelle – derzeit nur
  zur Dokumentation.

Am einfachsten: Claude den Fahrplan (PDF, Excel oder PowerPoint) geben und sagen „leg den Fahrplan in der
Haltestellenansage an, Ansagen mit Paula“.

## Neue Version veröffentlichen

1. Dateien ändern (Fahrpläne, Ansagen, `app.js`, `app.css` …).
2. `python3 werkzeug/fertig.py` ausführen (prüft alle Fahrpläne und Ansage-Dateien, setzt Kennungen, Dateiliste für
   den Offline-Speicher und `version.json`). Neue Versionsnummer: `--version 2.1.0`.
3. `node werkzeug/test-fahrt.js` – prüft den Ablauf.
4. Hochladen (commit und push auf `main`). GitHub veröffentlicht nach etwa einer Minute.

## Dateien

- `index.html`, `app.css`, `app.js` – Oberfläche, Ton, Bedienung
- `fahrt.js` – Ablauf einer Fahrt (Schaltfläche, Wechselzeit), ohne Bildschirm – in Node testbar
- `sw.js` – Offline-Speicher; `strecken/` – Fahrpläne; `ton/` – Ansagen; `bilder/` – SEV-Piktogramm, Haltestellen-Symbol

## Fremde Bestandteile

Schrift: Barlow und Barlow Semi Condensed (SIL Open Font License, siehe `fonts/OFL-Barlow.txt`).
SEV-Piktogramm, Haltestellen-Symbol und die ersten S28-Ansagen stammen aus der PowerPoint „Ersatzverkehr S28“ von Milo Reisen.
