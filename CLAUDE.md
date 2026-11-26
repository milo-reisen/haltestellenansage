# Hinweise für Claude

Statische Web-App (PWA) auf GitHub Pages: https://milo-reisen.github.io/haltestellenansage/ – kein Build-Schritt,
keine Abhängigkeiten. Läuft auf Android-Tablets in Chrome, die 1:1 auf die Monitore im Bus gespiegelt werden.
Nutzer und Texte sind deutsch; Code-Bezeichner ebenfalls deutsch halten.

- Nach jeder Änderung `python3 werkzeug/fertig.py` ausführen (prüft Strecken, setzt Kennungen, `sw.js`, `version.json`),
  dann `node werkzeug/test-fahrt.js`. Erst danach committen.
- Neue Strecke = eine JSON-Datei je Fahrtrichtung in `strecken/` (Format siehe README). Aufnahmen als MP3 in `ton/`.
  Kommt eine PowerPoint: Folien zeigen Kopf (Linie), Haltestellenleiter, Ziel; die eingebetteten MP3 sind die Ansagen
  (Reihenfolge: Begrüßung, dann je Halt „Nächste Haltestelle“). Texte der MP3 als `text` mit eintragen (Ersatz, falls die
  Datei nicht lädt). Koordinaten der Ersatzhaltestellen recherchieren; Gegenrichtung über `rueckfahrt` verknüpfen.
- Fahrgastanzeige nachgebaut nach der PowerPoint „Ersatzverkehr S28“ (Farbe #9C1963, Calibri → Carlito). Maße in vh/vw.
  Änderungen am Aussehen mit einem Bildschirmfoto bei 1600×900 und 1280×800 prüfen.
- Ablauf-Logik nur in `fahrt.js` (rein rechnend, in Node testbar); `app.js` macht Bildschirm, Ton, GPS, Bedienung.
