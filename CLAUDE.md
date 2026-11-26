# Hinweise für Claude

Statische Web-App (PWA) auf GitHub Pages: https://milo-reisen.github.io/haltestellenansage/ – kein Build-Schritt,
keine Abhängigkeiten. Läuft auf Android-Tablets in Chrome, die 1:1 auf die Monitore im Bus gespiegelt werden.
Nutzer und Texte sind deutsch; Code-Bezeichner ebenfalls deutsch halten.

- Bedienung ohne GPS (Nutzer hat GPS/Samsara verworfen): Fahrer tippt Fahrplan → Begrüßung; gelbe Schaltfläche
  „Nächste Haltestelle“ → Ansage; 2 Minuten nach Ende der Ansage rückt die Anzeige weiter; nach Endhalt Rückfahrt.
- Nach jeder Änderung `python3 werkzeug/fertig.py` ausführen (prüft Fahrpläne, setzt Kennungen, `sw.js`, `version.json`),
  dann `node werkzeug/test-fahrt.js`. Erst danach committen.
- Neuer Fahrplan = eine JSON-Datei je Fahrtrichtung in `strecken/` (Format siehe README), Gegenrichtung über `rueckfahrt`.
  Ansagen mit ElevenLabs, Stimme „Paula – Casual & normal“ (Geschwindigkeit 1,00, Stabilität 50, Ähnlichkeit 75),
  als MP3 in `ton/`; Wortlaut immer auch als `text` eintragen. Muster: Begrüßung „Sehr geehrte Fahrgäste, wir begrüßen
  Sie im Schienenersatzverkehr der Linie … Dieser Bus fährt über … nach … Milo Reisen wünscht Ihnen einen schönen Tag.
  Bis bald. Nächste Haltestelle: …“; je Halt „Nächste Haltestelle: X.“; Endhalt zusätzlich „Diese Linie endet hier.
  Wir bitten alle Fahrgäste auszusteigen. Milo Reisen wünscht Ihnen einen schönen Tag. Bis bald!“
  Gleiche Texte nur einmal aufnehmen und in mehreren Fahrplänen verwenden.
- Fahrgastanzeige nachgebaut nach der PowerPoint „Ersatzverkehr S28“ (Farbe #9C1963, Calibri → Carlito). Maße in vh/vw.
  Änderungen am Aussehen mit einem Bildschirmfoto bei 1600×900 und 1280×800 prüfen.
- Ablauf-Logik nur in `fahrt.js` (rein rechnend, Zeit von außen, in Node testbar); `app.js` macht Bildschirm, Ton, Bedienung.
