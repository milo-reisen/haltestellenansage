/* Verwaltung (Admin) – Haltestellenansage Milo Reisen
 * Nur mit der Admin-PIN erreichbar. Hier werden Fahrpläne mit ihren Ansagen gelöscht und die PINs geändert –
 * direkt im GitHub-Repository, damit es für alle Tablets gilt. Dafür braucht das Gerät einen GitHub-Schlüssel
 * (fine-grained token: nur dieses Repository, „Contents: Read and write“). Er wird nur auf diesem Gerät gespeichert.
 * Ohne Schlüssel kann niemand etwas löschen, auch wenn er die Admin-PIN kennt.
 * planeLoeschung() rechnet nur und ist in Node testbar (werkzeug/test-fahrt.js).
 */
(function (global) {
  'use strict';
  const REPO = 'milo-reisen/haltestellenansage', ZWEIG = 'main';
  const API = 'https://api.github.com/repos/' + REPO;
  const SCHLUESSEL = 'hsa.admin.schluessel';

  const zielName = s => s.ziel || s.halte[s.halte.length - 1].name;
  const titel = s => (s.linie ? s.linie + ' ' : '') + 'nach ' + zielName(s);
  const tonDateien = s => [s.begruessung, ...(s.halte || []).map(h => h.ansage)].filter(t => t && t.ton).map(t => t.ton);
  const alsText = (o, einzug) => JSON.stringify(o, null, einzug) + '\n';   // wie werkzeug/fertig.py

  /* Was ändert sich im Repository, wenn Fahrplan `id` gelöscht wird?
   * daten: { id: Fahrplan } aller Fahrpläne. Ansagen, die ein anderer Fahrplan noch nutzt, bleiben. */
  function planeLoeschung(daten, id) {
    const s = daten[id];
    if (!s) throw new Error('Den Fahrplan „' + id + '“ gibt es nicht.');
    const rest = Object.keys(daten).filter(k => k !== id).sort();
    if (!rest.length) throw new Error('Der letzte Fahrplan kann nicht gelöscht werden.');
    const genutzt = new Set(rest.flatMap(k => tonDateien(daten[k])));
    const eigene = [...new Set(tonDateien(s))].filter(t => !genutzt.has(t)).sort();
    const aendern = { 'strecken/index.json': alsText({ strecken: rest }, 1) };
    const rueckVon = [];
    for (const k of rest) {
      if (daten[k].rueckfahrt !== id) continue;
      const kopie = JSON.parse(JSON.stringify(daten[k]));
      delete kopie.rueckfahrt;
      aendern['strecken/' + k + '.json'] = alsText(kopie, 2);
      rueckVon.push(k);
    }
    return {
      loeschen: ['strecken/' + id + '.json'].concat(eigene),
      aendern, rueckVon,
      titel: titel(s), ansagen: (s.halte || []).length, eigeneAnsagen: eigene.length, aufnahmen: tonDateien(s).length
    };
  }

  const api = { planeLoeschung, titel };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  global.HSAVerwaltung = api;
  if (typeof document === 'undefined') return;

  /* ===================== ab hier nur im Browser ===================== */
  const $ = s => document.querySelector(s);
  const App = () => global.HSAApp;

  const schluessel = () => { try { return localStorage.getItem(SCHLUESSEL) || ''; } catch (e) { return ''; } };

  function dekodiere(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function fehlerText(e) {
    const st = e && e.status;
    if (st === 401) return 'Der GitHub-Schlüssel ist ungültig oder abgelaufen. Bitte einen neuen eintragen.';
    if (st === 403) return 'Der GitHub-Schlüssel darf nicht schreiben. Er braucht „Contents: Read and write“ für haltestellenansage – oder die Organisation milo-reisen hat ihn noch nicht freigegeben.';
    if (st === 404) return 'Der GitHub-Schlüssel hat keinen Zugriff auf milo-reisen/haltestellenansage.';
    if (e && e.name === 'TypeError') return 'Keine Verbindung zu GitHub. Bitte Internet prüfen und noch einmal versuchen.';
    return (e && e.message) || 'Unbekannter Fehler.';
  }

  async function gh(pfad, opts) {
    const k = schluessel();
    if (!k) { const e = new Error('Auf diesem Gerät ist kein GitHub-Schlüssel gespeichert.'); e.status = 0; throw e; }
    const kopf = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + k, 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts && opts.body) kopf['Content-Type'] = 'application/json';
    const res = await fetch(API + pfad, Object.assign({ cache: 'no-store' }, opts, { headers: kopf }));
    if (!res.ok) {
      const e = new Error('GitHub antwortet mit ' + res.status);
      e.status = res.status;
      try { e.antwort = await res.text(); } catch (x) { /* egal */ }
      throw e;
    }
    return res.status === 204 ? null : res.json();
  }

  /* Aktueller Stand des Zweigs main: Commit, Baum, alle Fahrpläne und Zugangsdaten */
  async function holeStand() {
    const ref = await gh('/git/ref/heads/' + ZWEIG);
    const commit = await gh('/git/commits/' + ref.object.sha);
    const baum = await gh('/git/trees/' + commit.tree.sha + '?recursive=1');
    const blobs = baum.tree.filter(x => x.type === 'blob');
    const lies = async x => dekodiere((await gh('/git/blobs/' + x.sha)).content);
    const daten = {};
    await Promise.all(blobs.filter(x => /^strecken\/[^/]+\.json$/.test(x.path) && x.path !== 'strecken/index.json').map(async x => {
      daten[x.path.slice('strecken/'.length, -'.json'.length)] = JSON.parse(await lies(x));
    }));
    const z = blobs.find(x => x.path === 'zugang.json');
    const zugang = z ? JSON.parse(await lies(z)) : {};
    return { sha: ref.object.sha, baum: commit.tree.sha, daten, zugang, pfade: new Set(blobs.map(x => x.path)) };
  }

  /* Ein Commit mit allen Änderungen auf einmal */
  async function schreibe(stand, nachricht, loeschen, aendern) {
    const eintraege = loeschen.filter(p => stand.pfade.has(p)).map(path => ({ path, mode: '100644', type: 'blob', sha: null }))
      .concat(Object.entries(aendern).map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })));
    const baum = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: stand.baum, tree: eintraege }) });
    const commit = await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: nachricht, tree: baum.sha, parents: [stand.sha] }) });
    await gh('/git/refs/heads/' + ZWEIG, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  }

  /* Hat in der Zwischenzeit jemand anderes etwas geändert, einmal mit frischem Stand wiederholen. */
  async function mitWiederholung(arbeit) {
    try { return await arbeit(await holeStand()); }
    catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      return arbeit(await holeStand());
    }
  }

  /* ---------- Anzeige ---------- */
  let stand = null;        // letzter Stand aus GitHub (null: ohne Schlüssel)
  let beschaeftigt = false;

  function meldung(text, art) {
    const m = $('#vw-meldung');
    m.textContent = text || '';
    m.className = 'vw-meldung' + (art ? ' ' + art : '');
    m.hidden = !text;
    if (text) m.scrollIntoView({ block: 'nearest' });
  }

  function zeigeSchluessel() {
    const k = schluessel();
    $('#vw-schluessel-status').textContent = k
      ? 'Auf diesem Gerät ist ein Schlüssel gespeichert (endet auf …' + k.slice(-4) + ').'
      : 'Auf diesem Gerät ist noch kein Schlüssel gespeichert. Ohne Schlüssel kannst du nichts löschen und keine PIN ändern.';
    $('#vw-schluessel-weg').hidden = !k;
  }

  function zeichneListe() {
    const box = $('#vw-liste');
    const daten = stand ? stand.daten : Object.fromEntries((App().strecken || []).map(s => [s.id, s]));
    const ids = Object.keys(daten).sort();
    box.innerHTML = '';
    if (!ids.length) { box.innerHTML = '<p class="vw-text">Keine Fahrpläne vorhanden.</p>'; return; }
    for (const id of ids) {
      const s = daten[id], h = s.halte || [];
      const zeile = document.createElement('div');
      zeile.className = 'vw-zeile';
      zeile.innerHTML = '<span class="vw-plakette"></span><span class="vw-was"><b></b><small></small></span><button type="button" class="loeschen">Löschen</button>';
      const p = zeile.querySelector('.vw-plakette');
      p.textContent = s.linie || '–';
      p.style.background = s.farbe || '#9C1963';
      zeile.querySelector('b').textContent = 'nach ' + zielName(s);
      const ohne = h.length - tonDateien(s).length;   // Begrüßung + eine Ansage je Halt
      zeile.querySelector('small').textContent = 'ab ' + h[0].name + ' · ' + h.length + ' Haltestellen · ' + h.length + ' Ansagen'
        + (ohne > 0 ? ' (' + ohne + ' mit Computerstimme)' : '') + (s.hinweis ? ' · ' + s.hinweis : '');
      const b = zeile.querySelector('.loeschen');
      b.disabled = !stand || beschaeftigt || ids.length < 2;
      b.title = !stand ? 'Zuerst den GitHub-Schlüssel eintragen' : '';
      b.addEventListener('click', () => frageLoeschen(id));
      box.appendChild(zeile);
    }
  }

  async function ladeStand() {
    if (!schluessel()) { stand = null; zeichneListe(); return; }
    $('#vw-liste').innerHTML = '<p class="vw-text">Fahrpläne werden von GitHub geladen …</p>';
    try { stand = await holeStand(); }
    catch (e) { stand = null; meldung(fehlerText(e), 'fehler'); }
    zeichneListe();
  }

  function sperre(an) {
    beschaeftigt = an;
    document.querySelectorAll('#verwaltung button.loeschen, #vw-pin-speichern, #vw-schluessel-speichern').forEach(b => { b.disabled = an; });
    if (!an) zeichneListe();
  }

  function frage(titelText, text, ja) {
    return new Promise(fertig => {
      const d = $('#vw-frage');
      $('#vw-frage-titel').textContent = titelText;
      $('#vw-frage-text').textContent = text;
      $('#vw-frage-ja').textContent = ja;
      d.returnValue = '';
      d.addEventListener('close', () => fertig(d.returnValue === 'ja'), { once: true });
      d.showModal();
    });
  }

  async function frageLoeschen(id) {
    if (!stand || beschaeftigt) return;
    let plan;
    try { plan = planeLoeschung(stand.daten, id); } catch (e) { meldung(e.message, 'fehler'); return; }
    let text = 'Der Fahrplan verschwindet mit seinen Ansagen von allen Tablets, sobald sie online sind.';
    if (plan.rueckVon.length) text += ' ' + plan.rueckVon.map(k => '„' + titel(stand.daten[k]) + '“').join(', ') + ' fährt danach ohne automatische Rückfahrt.';
    if (plan.aufnahmen > plan.eigeneAnsagen) text += ' Ansagen, die andere Fahrpläne auch nutzen, bleiben erhalten.';
    const anzahl = plan.ansagen ? ' mit ' + plan.ansagen + ' Ansage' + (plan.ansagen === 1 ? '' : 'n') : '';
    if (!(await frage('„' + plan.titel + '“' + anzahl + ' löschen?', text, 'Löschen'))) return;
    sperre(true);
    meldung('„' + plan.titel + '“ wird gelöscht …');
    try {
      await mitWiederholung(async st => {
        const p = planeLoeschung(st.daten, id);
        await schreibe(st, 'Verwaltung: Fahrplan „' + p.titel + '“ gelöscht', p.loeschen, p.aendern);
      });
      meldung('„' + plan.titel + '“ ist gelöscht. Die Tablets übernehmen das innerhalb weniger Minuten, sobald sie online sind.', 'ok');
      await ladeStand();
      App().aktualisiereStrecken(true);
    } catch (e) { meldung(fehlerText(e), 'fehler'); }
    sperre(false);
  }

  async function speicherePins() {
    const fIn = $('#vw-pin-fahrer'), aIn = $('#vw-pin-admin');
    const f = fIn.value.trim(), a = aIn.value.trim();
    if (!schluessel()) { meldung('Zum Ändern der PINs zuerst unten den GitHub-Schlüssel eintragen.', 'fehler'); return; }
    if (!f && !a) { meldung('Bitte eine neue Fahrer-PIN oder Admin-PIN eintragen.', 'fehler'); return; }
    if ([f, a].some(p => p && !/^\d{4}$/.test(p))) { meldung('Eine PIN hat genau 4 Ziffern.', 'fehler'); return; }
    sperre(true);
    meldung('PIN wird gespeichert …');
    try {
      await mitWiederholung(async st => {
        const neu = Object.assign({}, st.zugang);
        if (f) neu.fahrer = await App().pinHash(f);
        if (a) neu.admin = await App().pinHash(a);
        if (neu.fahrer === neu.admin) { const e = new Error('Fahrer-PIN und Admin-PIN müssen verschieden sein.'); e.status = 0; throw e; }
        await schreibe(st, 'Verwaltung: ' + (f && a ? 'Fahrer- und Admin-PIN' : f ? 'Fahrer-PIN' : 'Admin-PIN') + ' geändert', [], { 'zugang.json': alsText(neu, 1) });
      });
      fIn.value = ''; aIn.value = '';
      meldung('Gespeichert. Die neue PIN gilt auf allen Tablets, sobald sie online sind.', 'ok');
      App().aktualisiereZugang();
    } catch (e) { meldung(fehlerText(e), 'fehler'); }
    sperre(false);
  }

  async function speichereSchluessel() {
    const feld = $('#vw-schluessel');
    const k = feld.value.trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(k)) { meldung('Das sieht nicht wie ein GitHub-Schlüssel aus. Er beginnt mit „github_pat_“.', 'fehler'); return; }
    try { localStorage.setItem(SCHLUESSEL, k); } catch (e) { meldung('Der Schlüssel konnte auf diesem Gerät nicht gespeichert werden.', 'fehler'); return; }
    feld.value = '';
    zeigeSchluessel();
    meldung('Schlüssel gespeichert. Verbindung zu GitHub wird geprüft …');
    try { await gh(''); meldung('Schlüssel gespeichert. Die Verbindung zu GitHub klappt. Ob er schreiben darf, zeigt sich beim ersten Löschen oder Ändern.', 'ok'); }
    catch (e) { meldung(fehlerText(e), 'fehler'); }
    ladeStand();
  }

  async function entferneSchluessel() {
    if (!(await frage('Schlüssel von diesem Gerät entfernen?', 'Danach kannst du auf diesem Gerät nichts mehr löschen und keine PIN ändern, bis du ihn wieder einträgst. Der Schlüssel selbst bleibt bei GitHub gültig.', 'Entfernen'))) return;
    try { localStorage.removeItem(SCHLUESSEL); } catch (e) { /* egal */ }
    stand = null;
    zeigeSchluessel(); zeichneListe();
    meldung('Der Schlüssel ist von diesem Gerät entfernt.', 'ok');
  }

  function oeffne() {
    meldung('');
    zeigeSchluessel();
    App().zeigeEinstellungen();
    App().zeige('verwaltung');
    $('#verwaltung .aw-inhalt').scrollTop = 0;
    ladeStand();
  }

  $('#vw-zu').addEventListener('click', () => { stand = null; App().zeigeAnmeldung(); });
  $('#vw-pin-speichern').addEventListener('click', speicherePins);
  $('#vw-schluessel-speichern').addEventListener('click', speichereSchluessel);
  $('#vw-schluessel-weg').addEventListener('click', entferneSchluessel);
  $('#vw-schluessel').addEventListener('keydown', e => { if (e.key === 'Enter') speichereSchluessel(); });

  global.HSAVerwaltung = Object.assign(api, { oeffne });
})(typeof window !== 'undefined' ? window : globalThis);
