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
  const einst = Object.assign({ wechselSek: 120, begruessung: true, autoRueck: true }, lies('hsa.einst2', {}));

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

  /* ---------- Fahrpläne laden ---------- */
  async function ladeStrecken() {
    const liste = await (await fetch('strecken/index.json', { cache: 'no-cache' })).json();
    const geladen = await Promise.all(liste.strecken.map(async id => {
      try { const s = await (await fetch('strecken/' + id + '.json', { cache: 'no-cache' })).json(); s.id = id; return s; }
      catch (e) { console.warn('Fahrplan nicht lesbar:', id, e); return null; }
    }));
    strecken = geladen.filter(Boolean);
  }

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
    $('#auswahl').hidden = true; $('#anzeige').hidden = false;
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
    $('#anzeige').hidden = true; $('#auswahl').hidden = false;
    zeichneListe();
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
    if (e.typ === 'ende') rueckfahrtOderEnde();
    if (!$('#steuer').hidden) zeigeStatus();
  }

  /* Am Ende von selbst die Gegenrichtung zeigen (Einstellung), sonst Endhaltestelle stehen lassen. */
  function rueckfahrtOderEnde() {
    const r = aktiv && aktiv.strecke.rueckfahrt;
    if (einst.autoRueck && r && strecken.some(x => x.id === r)) starteFahrt(r, true);
  }

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

  const MAX_PUNKTE = 7;   // so viele Halte passen auf die Linie; dazwischen „weitere“
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
    band.parentNode.classList.toggle('allein', punkte.length === 1);
    band.innerHTML = '';
    punkte.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = p.art;
      // Endhalt ganz rechts, die übrigen Halte auf den ersten drei Vierteln der Linie
      const n = punkte.length, spanne = Math.min(0.74, (n - 2) / (n - 1));
      const f = i === n - 1 ? 1 : (n <= 2 ? 0 : spanne * i / (n - 2));
      li.style.left = 'calc(1.8vh + (100% - 4.2vh) * ' + f + ')';
      li.innerHTML = p.art === 'ziel' ? '<img src="bilder/haltestelle.png" alt=""><span></span>' : '<i></i><span></span>';
      li.querySelector('span').textContent = p.name;
      band.appendChild(li);
    });
    zeichneKnopf();
    requestAnimationFrame(() => {
      // Schräge Namen auf der Linie nicht zu lang werden lassen (sonst laufen sie in den großen Namen)
      const max = window.innerHeight * 0.30;
      band.querySelectorAll('li:not(.ziel) span').forEach(s => {
        const b = s.offsetWidth;
        if (b > max) s.style.fontSize = Math.max(2.6, 3.9 * max / b) + 'vh';
      });
      passe($('#az-name'), $('#az-name').parentNode);
      passe($('.kopf-ziel > span'), $('.kopf-ziel'));
    });
  }
  window.addEventListener('resize', () => zeichneAnzeige());

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
    if (fahrt.amEnde) text = 'Endhaltestelle ' + fahrt.naechster.name + ' erreicht.';
    else if (rest != null) text = '„' + fahrt.naechster.name + '“ angesagt – Anzeige wechselt in ' + mmss(rest) + ' zum nächsten Halt.';
    else text = 'Nächster Halt: „' + fahrt.naechster.name + '“ – zum Ansagen auf „Nächste Haltestelle“ tippen.';
    $('#st-status').textContent = text;
    const r = aktiv.strecke.rueckfahrt && strecken.find(x => x.id === aktiv.strecke.rueckfahrt);
    $('#st-rueck').hidden = !r;
    if (r) $('#st-rueck').textContent = 'Rückfahrt nach ' + (r.ziel || r.halte[r.halte.length - 1].name);
    $('#steuer [data-a=weiter]').disabled = fahrt.amEnde;
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

  /* ---------- Einstellungen ---------- */
  function oeffneEinstellungen() {
    $('#ei-wechsel').value = String(einst.wechselSek);
    $('#ei-begr').checked = !!einst.begruessung;
    $('#ei-autorueck').checked = !!einst.autoRueck;
    $('#ei-version').textContent = 'Version ' + CFG.version + (CFG.stand ? ' · Stand ' + CFG.stand : '');
    $('#einst').showModal();
  }
  $('#einst').addEventListener('change', () => {
    einst.wechselSek = Number($('#ei-wechsel').value) || 120;
    einst.begruessung = $('#ei-begr').checked;
    einst.autoRueck = $('#ei-autorueck').checked;
    schreib('hsa.einst2', einst);
  });
  $('#ei-tontest').addEventListener('click', () => { Ton.freischalten(); Ton.stopp(); Ton.spiele({ datei: 'ton/s28-begruessung-nach-vohwinkel.mp3', text: 'Dies ist eine Testansage.' }); });
  $('#ei-neu').addEventListener('click', () => location.reload());
  $('#bt-einst').addEventListener('click', oeffneEinstellungen);

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
  ladeStrecken().then(zeichneListe).catch(e => { $('#aw-liste').innerHTML = '<p class="leer">Fahrpläne konnten nicht geladen werden.</p>'; console.error(e); });

  // Für Tests im Browser
  window.HSAApp = { starteFahrt, beendeFahrt, sageAn, get fahrt() { return fahrt; }, zeigeSteuerung, Ton };
})();
