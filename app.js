/* Haltestellenansage – Milo Reisen
 * Der Fahrer tippt eine Strecke an, alles Weitere läuft von selbst:
 * Anzeige auf den Monitoren, Begrüßung, „Nächste Haltestelle …“ per GPS.
 * Ablauf (Schritte) steht in fahrt.js, hier sind Bildschirm, Ton, GPS und Bedienung.
 */
(function () {
  'use strict';
  const { Fahrt, abstand } = window.HSAFahrt;
  const $ = s => document.querySelector(s);
  const CFG = window.HSA || {};

  /* ---------- Speicher auf dem Tablet ---------- */
  const lies = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* voll oder gesperrt */ } };
  let einst = Object.assign({ begr: 'abfahrt', abstand: '', tempo: 10 }, lies('hsa.einst', {}));
  let positionen = lies('hsa.positionen', {});   // { streckeId: { haltIndex: {lat, lon, zeit} } }

  /* ---------- Zustand ---------- */
  let strecken = [];          // geladene Strecken (mit id)
  let fahrt = null;           // laufende Fahrt
  let aktiv = null;           // { strecke, test }
  let gpsLetzt = null;        // letzter echter GPS-Punkt
  let testModus = false;
  let sim = null;

  /* ---------- Ton: Aufnahmen (MP3) oder Computerstimme ---------- */
  const Ton = (() => {
    const schlange = [];
    let laeuft = false, audio = null, wache = null, stimme = null;
    const STILLE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

    function waehleStimme() {
      if (!('speechSynthesis' in window)) return;
      const alle = speechSynthesis.getVoices().filter(v => /^de(-|_|$)/i.test(v.lang));
      stimme = alle.find(v => /de-DE/i.test(v.lang) && v.localService) || alle.find(v => /de-DE/i.test(v.lang)) || alle[0] || null;
    }
    if ('speechSynthesis' in window) { waehleStimme(); speechSynthesis.onvoiceschanged = waehleStimme; }

    function fertig() { clearTimeout(wache); laeuft = false; audio = null; setTimeout(naechster, 350); }

    function sprich(text) {
      if (!text || !('speechSynthesis' in window)) return fertig();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; if (stimme) u.voice = stimme; u.rate = 0.95; u.pitch = 1; u.volume = 1;
      u.onend = fertig; u.onerror = fertig;
      clearTimeout(wache); wache = setTimeout(fertig, 4000 + text.length * 110);   // falls die Stimme hängt
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    }

    function naechster() {
      if (laeuft || !schlange.length) return;
      const t = schlange.shift();
      laeuft = true;
      if (t.datei) {
        audio = new Audio(t.datei);
        audio.onended = fertig;
        audio.onerror = () => { audio = null; sprich(t.text); };
        audio.play().catch(() => { if (audio) { audio.onerror = null; audio = null; } sprich(t.text); });
        clearTimeout(wache); wache = setTimeout(() => { if (audio) { audio.pause(); fertig(); } }, 90000);
      } else sprich(t.text);
    }

    return {
      /* ersetzen: noch wartende (veraltete) Ansagen verwerfen, die laufende darf zu Ende sprechen */
      spiele(t, ersetzen) { if (t && (t.datei || t.text)) { if (ersetzen) schlange.length = 0; schlange.push(t); naechster(); } },
      stopp() { schlange.length = 0; clearTimeout(wache); if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; } if ('speechSynthesis' in window) speechSynthesis.cancel(); laeuft = false; },
      /* Beim ersten Antippen freischalten: danach darf die App von selbst Ton abspielen. */
      freischalten() {
        try { const a = new Audio(STILLE); a.volume = 0; a.play().catch(() => {}); } catch (e) { /* egal */ }
        if ('speechSynthesis' in window) { try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* egal */ } }
      },
      get spieltGerade() { return laeuft; }
    };
  })();

  /* ---------- Bildschirm wach halten, Vollbild ---------- */
  let wachSperre = null;
  async function wachHalten() {
    try { if ('wakeLock' in navigator && document.visibilityState === 'visible') wachSperre = await navigator.wakeLock.request('screen'); } catch (e) { /* nicht unterstützt */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && aktiv) wachHalten(); });
  function vollbild() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen && !matchMedia('(display-mode: fullscreen)').matches) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
  }

  /* ---------- Strecken laden ---------- */
  async function ladeStrecken() {
    const liste = await (await fetch('strecken/index.json', { cache: 'no-cache' })).json();
    const geladen = await Promise.all(liste.strecken.map(async id => {
      try { const s = await (await fetch('strecken/' + id + '.json', { cache: 'no-cache' })).json(); s.id = id; return s; }
      catch (e) { console.warn('Strecke nicht lesbar:', id, e); return null; }
    }));
    strecken = geladen.filter(Boolean);
  }

  /* Gespeicherte, genauere Positionen der Haltestellen einrechnen. */
  function mitPositionen(s) {
    const eigen = positionen[s.id] || {};
    const k = JSON.parse(JSON.stringify(s));
    k.halte.forEach((h, i) => { if (eigen[i]) { h.lat = eigen[i].lat; h.lon = eigen[i].lon; h.gespeichert = true; } });
    return k;
  }

  /* ---------- GPS ---------- */
  function km(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1).replace('.', ',') + ' km'; }

  function gpsStarten() {
    if (!('geolocation' in navigator)) { zeigeGps(); return; }
    navigator.geolocation.watchPosition(p => {
      gpsLetzt = { lat: p.coords.latitude, lon: p.coords.longitude, genauigkeit: p.coords.accuracy, zeit: Date.now() };
      zeigeGps();
      if (aktiv && !aktiv.test) neuerPunkt(gpsLetzt);
      if (!aktiv) zeichneListe(true);
    }, err => { console.warn('GPS', err); zeigeGps(err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    setInterval(() => zeigeGps(), 5000);
  }

  function gpsFrisch() { return gpsLetzt && Date.now() - gpsLetzt.zeit < 20000; }

  function zeigeGps(err) {
    const el = $('#aw-gps');
    let text, klasse;
    if (err && err.code === 1) { text = 'GPS nicht erlaubt'; klasse = 'chip-schlecht'; }
    else if (!gpsFrisch()) { text = 'GPS wird gesucht …'; klasse = 'chip-aus'; }
    else if (gpsLetzt.genauigkeit <= 25) { text = 'GPS gut (± ' + Math.round(gpsLetzt.genauigkeit) + ' m)'; klasse = 'chip-gut'; }
    else if (gpsLetzt.genauigkeit <= 100) { text = 'GPS ungenau (± ' + Math.round(gpsLetzt.genauigkeit) + ' m)'; klasse = 'chip-mittel'; }
    else { text = 'GPS zu ungenau'; klasse = 'chip-schlecht'; }
    el.textContent = text; el.className = 'chip ' + klasse;
    if (aktiv) {
      $('#az-gps').hidden = aktiv.test || gpsFrisch();
      if (!$('#steuer').hidden) zeigeStatus();
    }
  }

  /* ---------- Streckenauswahl ---------- */
  let listeZuletzt = 0;
  function zeichneListe(nurWennAlt) {
    if (nurWennAlt && Date.now() - listeZuletzt < 15000) return;
    listeZuletzt = Date.now();
    const ort = gpsFrisch() ? gpsLetzt : null;
    const box = $('#aw-liste');
    box.classList.toggle('test', testModus);
    if (!strecken.length) { box.innerHTML = '<p class="leer">Keine Strecken gefunden.</p>'; return; }
    const sortiert = strecken.map(s => {
      const k = mitPositionen(s);
      return { s, d: ort ? abstand(ort, k.halte[0]) : null };
    }).sort((a, b) => (a.d == null || b.d == null) ? 0 : a.d - b.d);
    box.innerHTML = '';
    for (const { s, d } of sortiert) {
      const h = s.halte, m = h.length - 1;
      const ueber = h.slice(1, m).map(x => x.name);
      const aufnahmen = [s.begruessung, ...h.slice(1).map(x => x.ansage)].filter(t => t && t.ton).length;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'karte';
      b.style.setProperty('--k', s.farbe || '#9C1963');
      b.innerHTML =
        '<span class="karte-linie"></span>' +
        '<span class="karte-text"><span class="karte-ziel"></span><span class="karte-weg"></span><span class="karte-info"></span></span>';
      b.querySelector('.karte-linie').textContent = s.linie || '';
      b.querySelector('.karte-ziel').textContent = 'nach ' + (s.ziel || h[m].name);
      b.querySelector('.karte-weg').textContent = 'ab ' + h[0].name + (ueber.length ? ' · über ' + ueber.join(', ') : '');
      const info = b.querySelector('.karte-info');
      const marke = (t, k) => { const x = document.createElement('span'); x.className = 'marke ' + (k || ''); x.textContent = t; info.appendChild(x); };
      if (d != null) d < 600 ? marke('Startpunkt hier', 'marke-hier') : marke(km(d) + ' bis zum Start');
      marke(h.length + ' Haltestellen');
      if (aufnahmen < h.length) marke(aufnahmen ? 'teils Computerstimme' : 'Computerstimme', 'marke-tts');
      b.addEventListener('click', () => starteFahrt(s.id, testModus));
      box.appendChild(b);
    }
  }

  /* ---------- Fahrt ---------- */
  function starteFahrt(id, test) {
    const s = strecken.find(x => x.id === id);
    if (!s) return;
    Ton.stopp(); Ton.freischalten(); vollbild(); wachHalten();
    if (sim) { sim.stopp(); sim = null; }
    const strecke = mitPositionen(s);
    fahrt = new Fahrt(strecke, { ansageVorHalt: einst.abstand ? Number(einst.abstand) : undefined });
    aktiv = { strecke, test: !!test, id };
    document.documentElement.style.setProperty('--linie', strecke.farbe || '#9C1963');
    $('#az-symbol').src = strecke.symbol || 'bilder/sev.png';
    $('#az-symbol').hidden = strecke.symbol === false;
    $('#az-kopf').textContent = strecke.kopf || ('Linie ' + (strecke.linie || ''));
    $('#az-ziel').textContent = strecke.ziel || strecke.halte[strecke.halte.length - 1].name;
    $('#az-test').hidden = !test;
    $('#auswahl').hidden = true; $('#anzeige').hidden = false;
    versteckeSteuerung();
    zeichneAnzeige();
    if (einst.begr === 'sofort') verarbeite([fahrt.begruessen()]);
    if (test) { sim = new Simulation(strecke, Number(einst.tempo) || 10, neuerPunkt); sim.start(); }
    else if (gpsFrisch()) neuerPunkt(gpsLetzt);
    zeigeGps();
    schreib('hsa.letzte', { id, zeit: Date.now() });
  }

  function beendeFahrt() {
    Ton.stopp();
    if (sim) { sim.stopp(); sim = null; }
    fahrt = null; aktiv = null;
    try { if (wachSperre) wachSperre.release(); } catch (e) { /* egal */ }
    wachSperre = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    versteckeSteuerung();
    $('#anzeige').hidden = true; $('#auswahl').hidden = false;
    zeichneListe();
    pruefeVersion();
  }

  function neuerPunkt(p) {
    if (!fahrt) return;
    verarbeite(fahrt.gps(p));
  }

  function verarbeite(ereignisse) {
    let neu = false;
    for (const e of ereignisse) {
      if (!e) continue;
      neu = true;
      if (e.ton) Ton.spiele(e.ton, true);
    }
    if (neu) { zeichneAnzeige(); if (!$('#steuer').hidden) zeigeStatus(); }
  }

  /* ---------- Fahrgastanzeige zeichnen ---------- */
  function passe(el, box) {
    // Text verkleinern, bis er in seinen Bereich passt (wie „Text an Form anpassen“ in PowerPoint)
    el.style.transform = '';
    const platz = box.clientWidth - (parseFloat(getComputedStyle(box).paddingLeft) || 0) - (parseFloat(getComputedStyle(box).paddingRight) || 0);
    const breit = el.scrollWidth;
    if (breit > platz && platz > 0) el.style.transform = 'scale(' + (platz / breit) + ')';
  }

  function zeichneAnzeige() {
    if (!fahrt) return;
    const namen = fahrt.anzeige;                  // nächster Halt zuerst, Endhalt zuletzt
    let zeilen = namen.slice(), luecke = false;
    if (namen.length > 4) { zeilen = [namen[0], namen[1], namen[2], namen[namen.length - 1]]; luecke = true; }
    const n = zeilen.length;
    const leiter = $('#az-leiter');
    leiter.innerHTML = '';
    const hoeheVh = leiter.clientHeight / window.innerHeight * 100;
    const G = 3.3;
    const R = Math.min(13.8, (hoeheVh - 5 - (n - 1) * G) / n);
    const F = 7.4 * R / 13.8;
    leiter.style.setProperty('--r', R + 'vh');
    leiter.style.setProperty('--f', F + 'vh');
    const basis = (hoeheVh - (n * R + (n - 1) * G)) / 2;   // Block senkrecht mittig wie in der PowerPoint
    const unten = i => basis + i * (R + G);       // Zeile 0 (nächster Halt) ganz unten
    if (n > 1) {
      const v = document.createElement('div');
      v.className = 'verbinder';
      v.style.left = 'calc(13.7vw + ' + (R / 2) + 'vh - 2.1vh)';
      v.style.bottom = (basis + R / 2) + 'vh';
      v.style.height = (unten(n - 1) - basis) + 'vh';
      leiter.appendChild(v);
      if (luecke) {
        const d = document.createElement('div');
        d.className = 'mehr';
        d.style.left = v.style.left;
        d.style.bottom = (unten(n - 2) + R) + 'vh';
        d.style.height = G + 'vh';
        d.innerHTML = '<i></i><i></i>';
        leiter.appendChild(d);
      }
    }
    zeilen.forEach((name, i) => {
      const z = document.createElement('div');
      z.className = 'halt';
      z.style.bottom = unten(i) + 'vh';
      z.innerHTML = '<div class="halt-balken"></div><img class="halt-h" src="bilder/haltestelle.png" alt=""><div class="halt-t"><span></span></div>';
      z.querySelector('span').textContent = name;
      leiter.appendChild(z);
    });
    requestAnimationFrame(() => {
      leiter.querySelectorAll('.halt-t').forEach(t => passe(t.firstChild, t));
      passe($('#az-kopf'), $('#az-kopf').parentNode);
      passe($('#az-ziel'), $('#az-ziel').parentNode);
    });
  }
  window.addEventListener('resize', () => zeichneAnzeige());

  /* ---------- Bedienung während der Fahrt ---------- */
  let steuerZeit = null, endeArmiert = null;
  function zeigeSteuerung() {
    $('#steuer').hidden = false;
    zeigeStatus();
    clearTimeout(steuerZeit);
    steuerZeit = setTimeout(versteckeSteuerung, 10000);
  }
  function versteckeSteuerung() {
    clearTimeout(steuerZeit);
    $('#steuer').hidden = true; $('#st-meldung').hidden = true;
    endeArmiert = null; $('#st-ende').textContent = 'Fahrt beenden'; $('#st-ende').classList.remove('warn');
  }
  function meldung(t) { const m = $('#st-meldung'); m.textContent = t; m.hidden = false; }

  function naheHaltestelle() {
    if (!fahrt || !aktiv || aktiv.test || !gpsFrisch()) return null;
    let best = null;
    fahrt.halte.forEach((h, i) => { const d = abstand(h, gpsLetzt); if (d < 500 && (!best || d < best.d)) best = { i, d, name: h.name }; });
    return best;
  }

  function zeigeStatus() {
    if (!fahrt) return;
    const s = fahrt.schritt, h = fahrt.halte;
    const ziel = fahrt.naechsterGpsSchritt();
    let text;
    if (s.typ === 'ende') text = 'Endhaltestelle erreicht: ' + h[s.halt].name;
    else {
      const pos = aktiv.test ? (sim && sim.pos) : (gpsFrisch() ? gpsLetzt : null);
      const entf = pos && ziel ? ' – noch ' + km(abstand(pos, h[ziel.halt])) : '';
      text = 'Als Nächstes: ' + ziel.was + ' „' + h[ziel.halt].name + '“' + entf;
      if (fahrt.sperre) text += ' (Automatik ruht nach „Zurück“ kurz)';
    }
    $('#st-status').textContent = text;
    $('#st-gps').textContent = aktiv.test ? 'Testfahrt' : (gpsFrisch() ? 'GPS ± ' + Math.round(gpsLetzt.genauigkeit) + ' m' : 'kein GPS – mit „Weiter“ schalten');
    const rs = aktiv.strecke.rueckfahrt && strecken.find(x => x.id === aktiv.strecke.rueckfahrt);
    $('#st-rueck').hidden = !(rs && (s.typ === 'ende' || (s.typ === 'ansage' && s.halt === h.length - 1)));
    if (rs) $('#st-rueck').textContent = 'Rückfahrt nach ' + (rs.ziel || rs.halte[rs.halte.length - 1].name);
    $('#steuer [data-a=weiter]').disabled = s.typ === 'ende';
    $('#steuer [data-a=zurueck]').disabled = fahrt.i === 0;
    const nah = naheHaltestelle();
    const pb = $('#st-pos');
    pb.disabled = !nah;
    pb.textContent = nah ? 'Position für „' + nah.name + '“ speichern' : 'Position speichern (kein Halt in der Nähe)';
    pb.dataset.halt = nah ? nah.i : '';
  }

  $('#anzeige').addEventListener('click', () => { if ($('#steuer').hidden) zeigeSteuerung(); else versteckeSteuerung(); });
  $('#steuer').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    clearTimeout(steuerZeit); steuerZeit = setTimeout(versteckeSteuerung, 10000);
    if (!b || !fahrt) return;
    const a = b.dataset.a;
    if (a === 'weiter') { const ev = fahrt.weiter(); if (ev && ev.ton) Ton.stopp(); verarbeite([ev]); }
    else if (a === 'zurueck') { Ton.stopp(); verarbeite([fahrt.zurueck()]); }
    else if (a === 'wiederholen') { Ton.stopp(); Ton.spiele(fahrt.letzterTon || (fahrt.schritt.ton) || null); if (!fahrt.letzterTon && !fahrt.schritt.ton) meldung('Für diesen Schritt gibt es keine Ansage. Mit „Weiter“ kommt die nächste.'); }
    else if (a === 'position') {
      const i = Number(b.dataset.halt);
      if (!gpsFrisch() || isNaN(i)) return;
      positionen[aktiv.id] = positionen[aktiv.id] || {};
      positionen[aktiv.id][i] = { lat: gpsLetzt.lat, lon: gpsLetzt.lon, zeit: Date.now() };
      schreib('hsa.positionen', positionen);
      fahrt.halte[i].lat = gpsLetzt.lat; fahrt.halte[i].lon = gpsLetzt.lon;
      meldung('Gespeichert: „' + fahrt.halte[i].name + '“ liegt jetzt hier (± ' + Math.round(gpsLetzt.genauigkeit) + ' m). Gilt ab jetzt auf diesem Tablet.');
    }
    else if (a === 'rueck') { const r = aktiv.strecke.rueckfahrt, t = aktiv.test; starteFahrt(r, t); return; }
    else if (a === 'beenden') {
      if (endeArmiert && Date.now() - endeArmiert < 4000) { beendeFahrt(); return; }
      endeArmiert = Date.now(); b.textContent = 'Wirklich beenden? Nochmal tippen'; b.classList.add('warn');
      return;
    }
    zeigeStatus();
  });

  /* ---------- Testfahrt: Bus fährt die Strecke im Zeitraffer ab ---------- */
  class Simulation {
    constructor(strecke, tempo, ziel) { this.s = strecke; this.tempo = tempo; this.ziel = ziel; this.pos = null; }
    start() {
      const h = this.s.halte, pts = [];
      const v = 11;                                   // m/s ≈ 40 km/h
      const warte = (p, sek) => { for (let i = 0; i < sek; i++) pts.push(p); };
      warte(h[0], 6);
      for (let k = 0; k < h.length - 1; k++) {
        const a = h[k], b = h[k + 1], n = Math.max(1, Math.ceil(abstand(a, b) / v));
        for (let i = 1; i <= n; i++) pts.push({ lat: a.lat + (b.lat - a.lat) * i / n, lon: a.lon + (b.lon - a.lon) * i / n });
        warte(b, k + 1 < h.length - 1 ? 20 : 8);
      }
      let i = 0;
      this.t = setInterval(() => {
        if (i >= pts.length) return this.stopp();
        this.pos = Object.assign({ genauigkeit: 5, zeit: Date.now() }, pts[i++]);
        this.ziel(this.pos);
      }, 1000 / this.tempo);
    }
    stopp() { clearInterval(this.t); }
  }

  /* ---------- Einstellungen ---------- */
  function oeffneEinstellungen() {
    const d = $('#einst');
    d.querySelectorAll('input[name=begr]').forEach(r => { r.checked = r.value === einst.begr; });
    $('#ei-abstand').value = einst.abstand || '';
    $('#ei-tempo').value = String(einst.tempo || 10);
    const anz = Object.values(positionen).reduce((n, x) => n + Object.keys(x).length, 0);
    $('#ei-pos-text').textContent = 'Gespeicherte Haltestellen-Positionen: ' + anz;
    $('#ei-version').textContent = 'Version ' + CFG.version + (CFG.stand ? ' · Stand ' + CFG.stand : '');
    d.showModal();
  }
  $('#einst').addEventListener('change', () => {
    einst.begr = ($('#einst input[name=begr]:checked') || {}).value || 'abfahrt';
    einst.abstand = $('#ei-abstand').value;
    einst.tempo = Number($('#ei-tempo').value) || 10;
    schreib('hsa.einst', einst);
  });
  $('#ei-tontest').addEventListener('click', () => { Ton.freischalten(); Ton.stopp(); Ton.spiele({ text: 'Dies ist eine Testansage der Haltestellenansage von Milo Reisen.' }); });
  $('#ei-pos-loeschen').addEventListener('click', () => { positionen = {}; schreib('hsa.positionen', positionen); $('#ei-pos-text').textContent = 'Gespeicherte Haltestellen-Positionen: 0'; zeichneListe(); });
  $('#ei-neu').addEventListener('click', () => location.reload());
  $('#bt-einst').addEventListener('click', oeffneEinstellungen);
  $('#bt-test').addEventListener('click', e => {
    testModus = !testModus;
    e.currentTarget.setAttribute('aria-pressed', String(testModus));
    $('#aw-test').hidden = !testModus;
    zeichneListe();
  });

  /* ---------- Neue Version holen (nur wenn keine Fahrt läuft) ---------- */
  async function pruefeVersion() {
    if (aktiv || !CFG.stand) return;
    try {
      const v = await (await fetch('version.json?t=' + Date.now(), { cache: 'no-store' })).json();
      if (v.stand && v.stand !== CFG.stand && !aktiv) location.reload();
    } catch (e) { /* offline */ }
  }
  setInterval(pruefeVersion, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pruefeVersion(); });

  /* ---------- Start ---------- */
  $('#aw-version').textContent = 'Version ' + CFG.version;
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  ladeStrecken().then(() => zeichneListe()).catch(e => { $('#aw-liste').innerHTML = '<p class="leer">Strecken konnten nicht geladen werden.</p>'; console.error(e); });
  gpsStarten();

  // Für Tests im Browser
  window.HSAApp = { starteFahrt, beendeFahrt, get fahrt() { return fahrt; }, neuerPunkt, zeigeSteuerung };
})();
