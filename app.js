/* Haltestellenansage – Milo Reisen
 * Der Fahrer tippt den Fahrplan an; Paula begrüßt die Fahrgäste.
 * Vor jedem Halt tippt er auf „Nächste Haltestelle“ – Paula sagt den Halt an, 2 Minuten nach der Ansage
 * rückt die Anzeige zum folgenden Halt weiter. Nach dem Endhalt startet von selbst die Rückfahrt.
 * Ablauf steht in fahrt.js, hier sind Bildschirm, Ton und Bedienung.
 */
(function () {
  'use strict';
  const { Fahrt } = window.HSAFahrt;
  const $ = s => document.querySelector(s);
  const CFG = window.HSA || {};

  /* ---------- Speicher auf dem Tablet ---------- */
  const lies = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const schreib = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* voll oder gesperrt */ } };
  const einst = Object.assign({ wechselSek: 120, begruessung: true }, lies('hsa.einst2', {}));

  /* ---------- Zustand ---------- */
  let strecken = [];          // geladene Fahrpläne (mit id)
  let fahrt = null;           // laufende Fahrt
  let aktiv = null;           // { strecke, id }

  /* ---------- Ton: Aufnahmen (MP3) oder Computerstimme als Ersatz ---------- */
  const Ton = (() => {
    const schlange = [];
    let laeuft = null, audio = null, wache = null, stimme = null;
    const STILLE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

    function waehleStimme() {
      if (!('speechSynthesis' in window)) return;
      const alle = speechSynthesis.getVoices().filter(v => /^de(-|_|$)/i.test(v.lang));
      stimme = alle.find(v => /de-DE/i.test(v.lang) && v.localService) || alle.find(v => /de-DE/i.test(v.lang)) || alle[0] || null;
    }
    if ('speechSynthesis' in window) { waehleStimme(); speechSynthesis.onvoiceschanged = waehleStimme; }

    function fertig() {
      clearTimeout(wache);
      const t = laeuft; laeuft = null; audio = null;
      if (t && t.danach) { try { t.danach(); } catch (e) { console.error(e); } }
      melde();
      setTimeout(naechster, 350);
    }

    function sprich(text) {
      if (!text || !('speechSynthesis' in window)) return fertig();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'de-DE'; if (stimme) u.voice = stimme; u.rate = 0.95;
      u.onend = fertig; u.onerror = fertig;
      clearTimeout(wache); wache = setTimeout(fertig, 4000 + text.length * 110);   // falls die Stimme hängt
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    }

    function naechster() {
      if (laeuft || !schlange.length) return;
      const t = schlange.shift();
      laeuft = t; melde();
      if (t.datei) {
        audio = new Audio(t.datei);
        audio.onended = fertig;
        audio.onerror = () => { audio = null; sprich(t.text); };
        audio.play().catch(() => { if (audio) { audio.onerror = null; audio = null; } sprich(t.text); });
        clearTimeout(wache); wache = setTimeout(() => { if (audio) { audio.pause(); fertig(); } }, 90000);
      } else sprich(t.text);
    }

    let beobachter = () => {};
    function melde() { beobachter(!!laeuft); }

    return {
      /* danach: wird aufgerufen, wenn diese Ansage zu Ende ist */
      spiele(t, danach) { if (t && (t.datei || t.text)) { schlange.push(Object.assign({}, t, { danach })); naechster(); } },
      stopp() {
        schlange.length = 0; clearTimeout(wache);
        if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; }
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        laeuft = null; melde();
      },
      /* Beim Antippen freischalten: danach darf die App von selbst Ton abspielen. */
      freischalten() {
        try { const a = new Audio(STILLE); a.volume = 0; a.play().catch(() => {}); } catch (e) { /* egal */ }
      },
      beobachte(f) { beobachter = f; },
      get spieltGerade() { return !!laeuft; }
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

  /* ---------- Bildschirme ---------- */
  function zeige(welcher) {
    for (const id of ['anmeldung', 'auswahl', 'anzeige', 'verwaltung']) $('#' + id).hidden = id !== welcher;
  }

  /* ---------- Anmeldung: eine PIN für alle Fahrer, eine eigene für den Admin ----------
   * In zugang.json stehen nur Prüfsummen der PINs. Die Fahrer-Anmeldung hält 12 Stunden (oder bis „Abmelden“). */
  const ANGEMELDET_MS = 12 * 60 * 60 * 1000;
  const ZUGANG_ERSATZ = { fahrer: 'dd5263a0d4f796f5aa88248cbcae56c475a68904ea07ae7e8983f7ae9aea704f' };   // falls zugang.json fehlt
  let zugang = null;
  async function aktualisiereZugang() {
    try { zugang = await (await fetch('zugang.json', { cache: 'no-cache' })).json(); }
    catch (e) { if (!zugang) zugang = ZUGANG_ERSATZ; }
    return zugang;
  }
  async function pinHash(pin) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('milo-hsa:' + pin));
    return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
  }
  const angemeldet = () => Number(lies('hsa.anmeldung', 0)) > Date.now();

  let pin = '', fehlversuche = 0, gesperrtBis = 0;
  function zeichnePin() {
    $('#an-punkte').querySelectorAll('i').forEach((p, i) => p.classList.toggle('voll', i < pin.length));
  }
  function zeigeAnmeldung(text) {
    pin = ''; zeichnePin();
    $('#an-meldung').textContent = text || '';
    zeige('anmeldung');
  }
  function pinMeldung(text) {
    pin = ''; zeichnePin();
    $('#an-meldung').textContent = text;
    const p = $('#an-punkte');
    p.classList.remove('falsch'); void p.offsetWidth; p.classList.add('falsch');
  }
  async function pruefePin() {
    const z = zugang || await aktualisiereZugang();
    let h;
    try { h = await pinHash(pin); } catch (e) { pinMeldung('Die Anmeldung geht nur über https://milo-reisen.github.io/haltestellenansage/'); return; }
    if (h === z.fahrer) {
      fehlversuche = 0;
      schreib('hsa.anmeldung', Date.now() + ANGEMELDET_MS);
      pin = ''; zeichnePin(); $('#an-meldung').textContent = '';
      zeigeAuswahl();
    } else if (z.admin && h === z.admin) {
      fehlversuche = 0;
      pin = ''; zeichnePin(); $('#an-meldung').textContent = '';
      window.HSAVerwaltung.oeffne();
    } else if (++fehlversuche >= 5) {
      gesperrtBis = Date.now() + 30000; fehlversuche = 0;
      pinMeldung('Zu viele falsche Versuche. Bitte 30 Sekunden warten.');
    } else pinMeldung('Falsche PIN. Bitte noch einmal.');
  }
  function tippe(z) {
    if ($('#anmeldung').hidden) return;
    if (Date.now() < gesperrtBis) { $('#an-meldung').textContent = 'Zu viele falsche Versuche. Bitte 30 Sekunden warten.'; return; }
    if (z === 'x') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += z;
    if (pin.length) $('#an-meldung').textContent = '';
    zeichnePin();
    if (pin.length === 4) pruefePin();
  }
  $('#an-tasten').addEventListener('click', e => { const b = e.target.closest('button[data-z]'); if (b) tippe(b.dataset.z); });
  document.addEventListener('keydown', e => {
    if ($('#anmeldung').hidden) return;
    if (/^[0-9]$/.test(e.key)) tippe(e.key);
    else if (e.key === 'Backspace') tippe('x');
  });
  function abmelden() { schreib('hsa.anmeldung', 0); zeigeAnmeldung(); }

  function zeigeAuswahl() {
    if (!angemeldet()) { zeigeAnmeldung(); return; }
    zeige('auswahl');
    zeichneListe();
  }

  /* ---------- Fahrpläne laden ---------- */
  async function ladeStrecken() {
    const liste = await (await fetch('strecken/index.json', { cache: 'no-cache' })).json();
    const geladen = await Promise.all(liste.strecken.map(async id => {
      try { const s = await (await fetch('strecken/' + id + '.json', { cache: 'no-cache' })).json(); s.id = id; return s; }
      catch (e) { console.warn('Fahrplan nicht lesbar:', id, e); return null; }
    }));
    strecken = geladen.filter(Boolean);
  }

  /* Gelöschte oder neue Fahrpläne und geänderte PINs kommen ohne Neustart an – nur wenn keine Fahrt läuft. */
  let streckenStand = '';
  async function aktualisiereStrecken(sofort) {
    if (aktiv && !sofort) return;
    aktualisiereZugang();
    try {
      await ladeStrecken();
      const neu = JSON.stringify(strecken);
      if (neu !== streckenStand) { streckenStand = neu; if (!$('#auswahl').hidden) zeichneListe(); }
    } catch (e) { /* offline: alte Liste bleibt */ }
    if (!aktiv && !$('#auswahl').hidden && !angemeldet()) zeigeAnmeldung();
  }
  setInterval(aktualisiereStrecken, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') aktualisiereStrecken(); });

  /* ---------- Fahrplanauswahl ---------- */
  function zeichneListe() {
    const box = $('#aw-liste');
    if (!strecken.length) { box.innerHTML = '<p class="leer">Keine Fahrpläne gefunden.</p>'; return; }
    const letzte = (lies('hsa.letzte', {}) || {}).id;
    box.innerHTML = '';
    for (const s of strecken) {
      const h = s.halte, m = h.length - 1;
      const ueber = h.slice(1, m).map(x => x.name);
      const ohneAufnahme = [s.begruessung, ...h.slice(1).map(x => x.ansage)].filter(t => !(t && t.ton)).length;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'karte';
      b.style.setProperty('--k', s.farbe || '#9C1963');
      b.innerHTML = '<span class="karte-linie"></span><span class="karte-text"><span class="karte-ziel"></span><span class="karte-weg"></span><span class="karte-info"></span></span>';
      b.querySelector('.karte-linie').textContent = s.linie || '';
      b.querySelector('.karte-ziel').textContent = 'nach ' + (s.ziel || h[m].name);
      const ueberKurz = ueber.length > 4 ? ueber.slice(0, 3).join(', ') + ' …' : ueber.join(', ');
      b.querySelector('.karte-weg').textContent = 'ab ' + h[0].name + (ueber.length ? ' · über ' + ueberKurz : '');
      const info = b.querySelector('.karte-info');
      const marke = (t, k) => { const x = document.createElement('span'); x.className = 'marke ' + (k || ''); x.textContent = t; info.appendChild(x); };
      if (s.id === letzte) marke('zuletzt gefahren', 'marke-hier');
      marke(h.length + ' Haltestellen');
      if (ohneAufnahme) marke(ohneAufnahme + ' Ansage' + (ohneAufnahme > 1 ? 'n' : '') + ' mit Computerstimme', 'marke-tts');
      if (s.hinweis) marke(s.hinweis, 'marke-hinweis');
      b.addEventListener('click', () => starteFahrt(s.id, false));
      box.appendChild(b);
    }
  }

  /* ---------- Fahrt ---------- */
  function starteFahrt(id, automatisch) {
    const s = strecken.find(x => x.id === id);
    if (!s) return;
    if (!automatisch) { Ton.stopp(); Ton.freischalten(); vollbild(); }
    wachHalten();
    fahrt = new Fahrt(s, { wechselNachMs: (Number(einst.wechselSek) || 120) * 1000 });
    aktiv = { strecke: s, id };
    document.documentElement.style.setProperty('--linie', s.farbe || '#9C1963');
    $('#az-symbol').src = s.symbol || 'bilder/sev.png';
    $('#az-symbol').hidden = s.symbol === false;
    $('#az-linie').textContent = s.linie || '';
    $('#az-linie').hidden = !s.linie;
    const art = (s.kopf || '').replace(s.linie || '', '').trim();   // „Ersatzverkehr S11“ → „Ersatzverkehr“
    $('#az-art').textContent = (art ? art + ' ' : '') + 'nach';
    $('#az-ziel').textContent = s.ziel || s.halte[s.halte.length - 1].name;
    zeige('anzeige');
    versteckeSteuerung();
    zeichneAnzeige();
    if (einst.begruessung) Ton.spiele(fahrt.begruessung());
    schreib('hsa.letzte', { id, zeit: Date.now() });
  }

  function beendeFahrt() {
    Ton.stopp();
    fahrt = null; aktiv = null;
    try { if (wachSperre) wachSperre.release(); } catch (e) { /* egal */ }
    wachSperre = null;
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
    versteckeSteuerung();
    zeigeAuswahl();
    pruefeVersion();
  }

  /* „Nächste Haltestelle“ angetippt */
  function sageAn() {
    if (!fahrt) return;
    Ton.freischalten();
    const f = fahrt;
    const t = f.ansage();
    Ton.stopp();
    Ton.spiele(t, () => { if (fahrt === f) { f.ansageFertig(Date.now()); zeichneKnopf(); } });
    zeichneKnopf();
  }

  function nachEreignis(e) {
    if (!e) return;
    zeichneAnzeige();
    if (!$('#steuer').hidden) zeigeStatus();
  }
  // Am Endhalt bleibt das Bild stehen; der Fahrer beendet die Fahrt selbst (Fahrermenü) oder wählt die Rückfahrt.

  setInterval(() => {
    if (!fahrt) return;
    nachEreignis(fahrt.tick(Date.now()));
    zeichneKnopf();
    if (!$('#steuer').hidden) zeigeStatus();
  }, 1000);

  /* ---------- Fahrgastanzeige zeichnen ---------- */
  function passe(el, box) {
    // Text verkleinern, bis er in seinen Bereich passt
    el.style.transform = '';
    const st = getComputedStyle(box);
    const platz = box.clientWidth - (parseFloat(st.paddingLeft) || 0) - (parseFloat(st.paddingRight) || 0);
    const breit = el.scrollWidth;
    if (breit > platz && platz > 0) el.style.transform = 'scale(' + (platz / breit) + ')';
  }

  const MAX_PUNKTE = 6;      // so viele Punkte passen auf die Linie (inkl. Endhalt); dazwischen „weitere“
  const ABSTAND = 0.135;     // fester Abstand zwischen zwei Halten (Anteil der Bandbreite) – je weniger Halte, desto kürzer die Linie
  const SCHRIFT_VH = 3.6;    // gleiche Schriftgröße für alle Zwischenhalte
  function zeichneAnzeige() {
    if (!fahrt) return;
    $('#az-name').textContent = fahrt.naechster.name;
    const namen = fahrt.anzeige;                  // nächster Halt zuerst, Endhalt zuletzt
    let punkte = namen.map((n, i) => ({ name: n, art: i === 0 ? 'jetzt' : (i === namen.length - 1 ? 'ziel' : '') }));
    if (punkte.length > MAX_PUNKTE) {
      const weg = punkte.length - (MAX_PUNKTE - 1);
      punkte = punkte.slice(0, MAX_PUNKTE - 2).concat([{ name: weg + ' weitere', art: 'mehr' }], [punkte[punkte.length - 1]]);
    }
    if (punkte.length === 1) punkte[0].art = 'ziel';
    const band = $('#az-band');
    const breite = band.clientWidth;
    const start = window.innerHeight * 0.018;     // 1,8vh: Mitte des ersten Punkts
    const schritt = breite * ABSTAND;
    band.innerHTML = '';
    const schiene = $('.band .schiene');
    schiene.style.width = ((punkte.length - 1) * schritt) + 'px';
    schiene.hidden = punkte.length < 2;
    punkte.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = p.art;
      li.style.left = (start + i * schritt) + 'px';
      li.innerHTML = p.art === 'ziel' ? '<img src="bilder/haltestelle.png" alt=""><span></span>' : '<i></i><span></span>';
      li.querySelector('span').textContent = p.name;
      band.appendChild(li);
    });
    zeichneKnopf();
    requestAnimationFrame(() => {
      // Alle Zwischenhalte in derselben Größe – für die ganze Fahrt gleich. Nur wenn der längste Name der Strecke
      // sonst in den großen Namen liefe, werden alle gemeinsam etwas kleiner.
      passe($('#az-name'), $('#az-name').parentNode);
      const vh = schriftFuerFahrt(schiene);
      band.querySelectorAll('li:not(.ziel) span').forEach(s => { s.style.fontSize = vh + 'vh'; });
      // Endhalt rechts neben dem H-Schild; falls zu wenig Platz, etwas kleiner
      const ziel = band.querySelector('li.ziel span');
      if (ziel) {
        ziel.style.transform = 'translateY(50%)';
        const platz = breite - (ziel.getBoundingClientRect().left - band.getBoundingClientRect().left);
        if (ziel.offsetWidth > platz) ziel.style.transform = 'translateY(50%) scale(' + (platz / ziel.offsetWidth) + ')';
      }
      passe($('.kopf-ziel > span'), $('.kopf-ziel'));
    });
  }
  let schriftCache = null;   // { fahrt, breite, hoehe, vh }
  function schriftFuerFahrt(schiene) {
    const w = window.innerWidth, h = window.innerHeight;
    if (schriftCache && schriftCache.fahrt === fahrt && schriftCache.breite === w && schriftCache.hoehe === h) return schriftCache.vh;
    const px = h * SCHRIFT_VH / 100;
    const ctx = (schriftFuerFahrt.c = schriftFuerFahrt.c || document.createElement('canvas')).getContext('2d');
    ctx.font = '600 ' + px + 'px "Barlow SC"';
    const namen = fahrt.halte.slice(1, -1).map(x => x.name).concat(['99 weitere']);
    const breitester = Math.max(0, ...namen.map(n => ctx.measureText(n).width));
    // Platz nach oben: von der Linie bis knapp unter den großen Namen (Höhe des großen Namens fest, damit es für alle Halte gleich bleibt)
    const linieY = schiene.getBoundingClientRect().top;
    const nameUnten = $('.naechster').getBoundingClientRect().bottom;
    const maxBreite = Math.max(50, (linieY - nameUnten + h * 0.02) / Math.sin(32 * Math.PI / 180));
    const vh = breitester > maxBreite ? SCHRIFT_VH * maxBreite / breitester : SCHRIFT_VH;
    schriftCache = { fahrt, breite: w, hoehe: h, vh };
    return vh;
  }
  window.addEventListener('resize', () => zeichneAnzeige());
  if (document.fonts) document.fonts.ready.then(() => { schriftCache = null; zeichneAnzeige(); });

  function zeichneKnopf() {
    if (!fahrt) return;
    const k = $('#az-knopf');
    $('#az-knopf-t').textContent = fahrt.amEnde ? 'Endhaltestelle' : 'Nächste Haltestelle';
    k.classList.toggle('ende', fahrt.amEnde);
    k.classList.toggle('spricht', Ton.spieltGerade);
    const rest = fahrt.restMs(Date.now());
    const balken = $('#az-knopf-zeit');
    balken.hidden = rest == null;
    if (rest != null) balken.style.transform = 'scaleX(' + (rest / fahrt.o.wechselNachMs) + ')';
  }
  Ton.beobachte(() => zeichneKnopf());

  function zeigeUhr() {
    const d = new Date();
    $('#az-uhr').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  zeigeUhr(); setInterval(zeigeUhr, 5000);

  $('#az-knopf').addEventListener('click', e => { e.stopPropagation(); sageAn(); });

  /* ---------- Fahrermenü: einmal auf die Anzeige tippen ---------- */
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
  function mmss(ms) { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

  function zeigeStatus() {
    if (!fahrt) return;
    const rest = fahrt.restMs(Date.now());
    let text;
    if (fahrt.amEnde || (fahrt.istEndhalt && fahrt.angesagt)) text = 'Endhaltestelle „' + fahrt.naechster.name + '“ angesagt. Die Anzeige bleibt so, bis du „Fahrt beenden“ oder die Rückfahrt antippst.';
    else if (rest != null) text = '„' + fahrt.naechster.name + '“ angesagt – Anzeige wechselt in ' + mmss(rest) + ' zum nächsten Halt.';
    else text = 'Nächster Halt: „' + fahrt.naechster.name + '“ – zum Ansagen auf „Nächste Haltestelle“ tippen.';
    $('#st-status').textContent = text;
    const r = aktiv.strecke.rueckfahrt && strecken.find(x => x.id === aktiv.strecke.rueckfahrt);
    $('#st-rueck').hidden = !r;
    if (r) $('#st-rueck').textContent = 'Rückfahrt nach ' + (r.ziel || r.halte[r.halte.length - 1].name);
    $('#steuer [data-a=weiter]').disabled = fahrt.amEnde || fahrt.istEndhalt;
    $('#steuer [data-a=zurueck]').disabled = fahrt.k === 1 && !fahrt.amEnde;
  }

  $('#anzeige').addEventListener('click', () => { if ($('#steuer').hidden) zeigeSteuerung(); else versteckeSteuerung(); });
  $('#steuer').addEventListener('click', e => {
    const b = e.target.closest('button[data-a]');
    clearTimeout(steuerZeit); steuerZeit = setTimeout(versteckeSteuerung, 10000);
    if (!b || !fahrt) return;
    const a = b.dataset.a;
    if (a === 'weiter') { Ton.stopp(); nachEreignis(fahrt.weiter()); }
    else if (a === 'zurueck') { Ton.stopp(); nachEreignis(fahrt.zurueck()); }
    else if (a === 'begruessung') { Ton.stopp(); Ton.spiele(fahrt.begruessung()); }
    else if (a === 'wiederholen') {
      Ton.stopp();
      if (fahrt.letzterTon) Ton.spiele(fahrt.letzterTon);
      else { const m = $('#st-meldung'); m.textContent = 'Noch keine Ansage gemacht.'; m.hidden = false; }
    }
    else if (a === 'rueck') { starteFahrt(aktiv.strecke.rueckfahrt, false); return; }
    else if (a === 'beenden') {
      if (endeArmiert && Date.now() - endeArmiert < 4000) { beendeFahrt(); return; }
      endeArmiert = Date.now(); b.textContent = 'Wirklich beenden? Nochmal tippen'; b.classList.add('warn');
      return;
    }
    zeigeStatus();
  });

  /* ---------- Einstellungen für dieses Tablet (nur im Admin-Bereich) ---------- */
  function zeigeEinstellungen() {
    $('#ei-wechsel').value = String(einst.wechselSek);
    $('#ei-begr').checked = !!einst.begruessung;
  }
  $('#vw-tablet').addEventListener('change', () => {
    einst.wechselSek = Number($('#ei-wechsel').value) || 120;
    einst.begruessung = $('#ei-begr').checked;
    schreib('hsa.einst2', einst);
  });

  /* ---------- Fußleiste der Fahrplanauswahl ---------- */
  function testTon() {
    // erste Aufnahme eines vorhandenen Fahrplans, sonst Computerstimme
    for (const s of strecken) {
      const t = [s.begruessung, ...s.halte.map(h => h.ansage)].find(x => x && x.ton);
      if (t) return { datei: t.ton, text: t.text };
    }
    return { text: 'Dies ist eine Testansage.' };
  }
  const tonTest = () => { Ton.freischalten(); Ton.stopp(); Ton.spiele(testTon()); };
  $('#bt-tontest').addEventListener('click', tonTest);
  $('#ei-tontest').addEventListener('click', tonTest);
  $('#bt-neu').addEventListener('click', () => location.reload());
  $('#bt-abmelden').addEventListener('click', abmelden);

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
  const versionText = 'Version ' + CFG.version;
  $('#aw-version').textContent = versionText;
  $('#an-version').textContent = versionText;
  $('#ei-version').textContent = versionText + (CFG.stand ? ' · Stand ' + CFG.stand : '');
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  aktualisiereZugang();
  if (angemeldet()) zeige('auswahl'); else zeigeAnmeldung();
  ladeStrecken().then(() => { streckenStand = JSON.stringify(strecken); zeichneListe(); })
    .catch(e => { $('#aw-liste').innerHTML = '<p class="leer">Fahrpläne konnten nicht geladen werden.</p>'; console.error(e); });

  // für den Admin-Bereich (verwaltung.js) und für Tests im Browser
  window.HSAApp = {
    starteFahrt, beendeFahrt, sageAn, get fahrt() { return fahrt; }, zeigeSteuerung, Ton,
    get strecken() { return strecken; }, zeige, zeigeAnmeldung, zeigeEinstellungen, pinHash,
    aktualisiereStrecken, aktualisiereZugang
  };
})();
