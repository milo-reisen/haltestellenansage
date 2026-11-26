# Hinweise für Claude

Statische Web-App (PWA) auf GitHub Pages: https://milo-reisen.github.io/haltestellenansage/ – kein Build-Schritt,
keine Abhängigkeiten. Läuft auf Android-Tablets in Chrome, die 1:1 auf die Monitore im Bus gespiegelt werden.
Nutzer und Texte sind deutsch; Code-Bezeichner ebenfalls deutsch halten.

- Bedienung ohne GPS (Nutzer hat GPS/Samsara verworfen): Fahrer tippt Fahrplan → Begrüßung; „Nächste Haltestelle“
  groß in zart getönter Fläche mit feinem Rand, ohne Symbol (Fahrer soll sie als Schaltfläche erkennen, Fahrgästen soll sie
  kaum auffallen) → Ansage; 2 Minuten nach Ende der Ansage rückt die
  Anzeige weiter; nach Endhalt Rückfahrt.
- Vorher immer `git pull`: Der Admin-Bereich der App (verwaltung.js) löscht Fahrpläne und ändert PINs direkt im
  Repository über die GitHub-API (Schlüssel nur auf dem Admin-Gerät). Anmeldung: eine Fahrer-PIN für alle (5554),
  eigene Admin-PIN; in `zugang.json` nur SHA-256 von „milo-hsa:“ + PIN. Fahrer dürfen nichts löschen oder umstellen –
  Einstellungen nur im Admin-Bereich.
- Nach jeder Änderung `python3 werkzeug/fertig.py` ausführen (prüft Fahrpläne, setzt Kennungen, `sw.js`, `version.json`),
  dann `node werkzeug/test-fahrt.js`. Erst danach committen.
- Neuer Fahrplan = eine JSON-Datei je Fahrtrichtung in `strecken/` (Format siehe README), Gegenrichtung über `rueckfahrt`.
  Ansagen mit ElevenLabs, Stimme „Paula – Casual & normal“ (Geschwindigkeit 1,00, Stabilität 50, Ähnlichkeit 75),
  als MP3 in `ton/`; Wortlaut immer auch als `text` eintragen. Muster: Begrüßung „Sehr geehrte Fahrgäste, wir begrüßen
  Sie im Schienenersatzverkehr der Linie … Dieser Bus fährt über … nach … Milo Reisen wünscht Ihnen einen schönen Tag.
  Bis bald. Nächste Haltestelle: …“; je Halt „Nächste Haltestelle: X.“; Endhalt zusätzlich „Diese Linie endet hier.
  Wir bitten alle Fahrgäste auszusteigen. Milo Reisen wünscht Ihnen einen schönen Tag. Bis bald!“
  Gleiche Texte nur einmal aufnehmen und in mehreren Fahrplänen verwenden.
- Fahrgastanzeige Design „Tag“ (vom Nutzer gewählt; das PowerPoint-Design und eine gelbe Schaltfläche hat er abgelehnt):
  weiß, Kopfband in Linienfarbe (#9C1963) mit SEV-Piktogramm, Linien-Plakette, „Ersatzverkehr nach Ziel“, Uhr;
  nächste Haltestelle groß (Barlow Semi Condensed 700); unten Streckenverlauf als Linie mit festem Abstand zwischen den
  Halten (Linie wird zum Ende hin kürzer), alle Zwischenhalte schräg in gleicher Schrift und Größe (für die ganze Fahrt),
  Endhalt deutlich: großes H-Schild, Name groß rechts daneben.
  Maße in vh/vw. Änderungen am Aussehen mit einem Bildschirmfoto bei 1600×900 und 1280×800 prüfen.
- Ablauf-Logik nur in `fahrt.js` (rein rechnend, Zeit von außen, in Node testbar); `app.js` macht Bildschirm, Ton, Bedienung.
