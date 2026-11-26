# Haltestellenansage – Milo Reisen

App für die Tablets in den Bussen von Milo Reisen. Das Tablet ist mit den Monitoren im Bus verbunden und wird
1:1 gespiegelt. Der Fahrer tippt nur die Strecke an – den Rest macht die App:

- Anzeige auf den Monitoren im Design der bisherigen PowerPoint (Linie oben, nächste Haltestellen in der Mitte, Ziel unten)
- Begrüßungsansage bei Abfahrt vom ersten Halt
- „Nächste Haltestelle …“ automatisch per GPS kurz vor jedem Halt
- nach der Abfahrt rückt die Anzeige zum nächsten Halt weiter
- am Endhalt: Knopf „Rückfahrt“

Adresse der App: **https://milo-reisen.github.io/haltestellenansage/**

## Tablet einrichten (einmalig)

1. Auf dem Tablet **Chrome** öffnen und die Adresse oben aufrufen.
2. Menü (⋮) → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“. Danach liegt „Ansage“ als App auf dem Tablet.
3. App öffnen und **Standort erlauben** (wird für die automatischen Ansagen gebraucht).
4. In der App unter *Einstellungen → Testansage* prüfen, ob der Ton aus den Monitoren kommt. Lautstärke mit den Tasten am Tablet.
5. Einmal kurz mit Internet öffnen – danach funktioniert alles auch ohne Netz (Anzeige, GPS, Ansagen).

Tipp: Unter Android kann die App „angeheftet“ werden (Einstellungen → Sicherheit → App anheften). Dann kann der
Fahrer nicht aus Versehen etwas anderes öffnen.

## Bedienung für den Fahrer

- **Strecke antippen** – fertig. Ganz oben steht die Strecke, deren Startpunkt am nächsten ist („Startpunkt hier“).
- **Einmal auf den Bildschirm tippen** zeigt für 10 Sekunden die Knöpfe (sehen die Fahrgäste kurz mit):
  - **Weiter ▶ / ◀ Zurück** – schaltet wie früher in der PowerPoint einen Schritt vor oder zurück (falls das GPS mal danebenliegt).
  - **Ansage wiederholen**
  - **Position speichern** – speichert, wo die (Ersatz-)Haltestelle wirklich ist. Gilt danach auf diesem Tablet.
  - **Rückfahrt nach …** – am Endhalt, startet die Gegenrichtung.
  - **Fahrt beenden** – zweimal tippen.
- **Testfahrt** (unten auf der Startseite): Die Fahrt wird im Zeitraffer abgespielt, mit Anzeige und Ton – ideal zum Ausprobieren im Büro.

## So funktioniert die Automatik

Die Fahrt läuft in denselben Schritten wie die PowerPoint-Folien:

| Schritt | Anzeige | Ton | ausgelöst durch |
|---|---|---|---|
| Start | alle Halte | – | Strecke antippen |
| Begrüßung | alle Halte | Begrüßung | Abfahrt vom ersten Halt (Bus verlässt 250 m um den Halt) |
| Ansage Halt X | ab Halt X | „Nächste Haltestelle X“ | 400 m vor Halt X |
| Abfahrt Halt X | ab Halt danach | – | Bus war am Halt und ist wieder weg |
| Ende | Endhalt | – | Ankunft am Endhalt |

Die 400 m stehen in jeder Strecke (`ansageVorHalt`) und lassen sich in den Einstellungen für das Tablet ändern.
Die Begrüßung kann in den Einstellungen auch „sofort beim Antippen“ kommen.

## Neue Strecke anlegen

Jede Fahrtrichtung ist eine Datei in `strecken/`, z. B. `strecken/s28-nach-vohwinkel.json`:

```json
{
  "linie": "S28",
  "kopf": "Ersatzverkehr S28",
  "farbe": "#9C1963",
  "symbol": "bilder/sev.png",
  "ziel": "Wuppertal-Vohwinkel",
  "rueckfahrt": "s28-nach-mettmann",
  "ansageVorHalt": 400,
  "begruessung": { "ton": "ton/….mp3", "text": "Sehr geehrte Fahrgäste, …" },
  "halte": [
    { "name": "Mettmann Stadtwald", "lat": 51.250901, "lon": 6.987358 },
    { "name": "Wuppertal - Hahnenfurth/Düssel", "lat": 51.254262, "lon": 7.056441,
      "ansage": { "ton": "ton/….mp3", "text": "Nächste Haltestelle: …" } }
  ]
}
```

- `kopf` steht oben im Band, `ziel` unten, `farbe` ist die Farbe der Bänder und Balken.
- Der erste Halt ist der Startpunkt (wird nicht angesagt). Jeder weitere Halt bekommt seine Ansage.
- `ton`: Aufnahme (z. B. aus ElevenLabs) als MP3 im Ordner `ton/`. Fehlt sie, liest die **Computerstimme** des Tablets
  den `text` vor. Fehlt auch der Text, wird er automatisch gebildet („Nächste Haltestelle: …“, am Endhalt mit
  „Diese Linie endet hier …“).
- Optional pro Halt: `"sprich": "…"`, wenn die Computerstimme den Namen anders aussprechen soll.
- `rueckfahrt`: Dateiname (ohne `.json`) der Gegenrichtung.
- Koordinaten: in Google Maps auf die Haltestelle tippen → die Zahlen oben sind `lat, lon`. Genauer geht es im Bus mit
  „Position speichern“.

Am einfachsten: Claude die PowerPoint bzw. den Fahrplan geben und sagen „leg die Strecke in der Haltestellenansage an“.

## Neue Version veröffentlichen

1. Dateien ändern (Strecken, Ansagen, `app.js`, `app.css` …).
2. `python3 werkzeug/fertig.py` ausführen. Das prüft alle Strecken, schreibt `strecken/index.json`, setzt die Kennungen
   in `index.html`, die Dateiliste in `sw.js` und `version.json`. Neue Versionsnummer: `--version 1.1.0`.
3. Hochladen (commit und push auf `main`). GitHub veröffentlicht nach etwa einer Minute.

Die Tablets holen sich die neue Fassung von selbst, sobald sie Netz haben und gerade keine Fahrt läuft.

Prüfen des Ablaufs ohne Tablet: `node werkzeug/test-fahrt.js`

## Dateien

- `index.html`, `app.css`, `app.js` – Oberfläche, Ton, GPS, Bedienung
- `fahrt.js` – Ablauf einer Fahrt (Schritte, GPS-Regeln), ohne Bildschirm
- `sw.js` – Gerätespeicher, damit die App ohne Netz läuft
- `strecken/` – Strecken, `ton/` – Ansagen, `bilder/` – SEV-Piktogramm und Haltestellen-Symbol

## Fremde Bestandteile

Schrift: Carlito (SIL Open Font License, siehe `fonts/OFL-Carlito.txt`), gleich breit wie Calibri aus der PowerPoint.
SEV-Piktogramm, Haltestellen-Symbol und die Ansagen der S28 stammen aus der PowerPoint „Ersatzverkehr S28“ von Milo Reisen.
