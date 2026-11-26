/* Ablauf einer Fahrt – wie die Folien der PowerPoint, nur automatisch.
 *
 * Eine Fahrt besteht aus Schritten (wie Folien):
 *   start        Anzeige der Strecke, kein Ton            (Folie 1)
 *   begruessung  Begrüßungsansage                          (Folie 2)
 *   ansage k     „Nächste Haltestelle: …“ für Halt k       (Folie 3, 5 …)
 *   abfahrt k    Halt k ist verlassen, Anzeige rückt nach  (Folie 4 …)
 *   ende         am Endhalt angekommen
 *
 * Das GPS schaltet die Schritte vorwärts. Der Fahrer kann jederzeit mit
 * „Weiter“ und „Zurück“ selbst schalten – wie früher in der PowerPoint.
 * Diese Datei kennt weder Bildschirm noch Ton; sie rechnet nur.
 */
(function (global) {
  'use strict';

  const STANDARD = {
    ansageVorHalt: 400,   // m: so weit vor dem Halt kommt „Nächste Haltestelle“
    ankunftRadius: 90,    // m: so nah gilt der Bus als „am Halt“
    abfahrtRadius: 160,   // m: so weit weg gilt der Halt als verlassen
    startRadius: 250,     // m: Bereich um den ersten Halt (Begrüßung bei Abfahrt)
    genauigkeitMax: 100,  // m: ungenauere GPS-Punkte werden nicht verwendet
    begruessungSofort: false
  };

  function abstand(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  function sprich(halt) { return halt.sprich || halt.name.replace(/\s*\/\s*/g, ' ').replace(/\s+-\s+/g, '-'); }

  function autoText(strecke, typ, k) {
    const h = strecke.halte, m = h.length - 1;
    if (typ === 'begruessung') {
      const ueber = h.slice(1, m).map(sprich);
      return 'Sehr geehrte Fahrgäste, wir begrüßen Sie im ' + (strecke.kopf || ('Linie ' + strecke.linie)) + '. ' +
        'Dieser Bus fährt ' + (ueber.length ? 'über ' + ueber.join(', ') + ' ' : '') + 'nach ' + sprich({ name: strecke.ziel || h[m].name }) + '. ' +
        'Nächste Haltestelle: ' + sprich(h[1]) + '.';
    }
    let t = 'Nächste Haltestelle: ' + sprich(h[k]) + '.';
    if (k === m) t += ' Diese Linie endet hier. Wir bitten alle Fahrgäste auszusteigen.';
    return t;
  }

  function ton(strecke, typ, k) {
    const q = typ === 'begruessung' ? (strecke.begruessung || {}) : (strecke.halte[k].ansage || {});
    if (q === false || q.aus) return null;
    return { datei: q.ton || null, text: q.text || autoText(strecke, typ, k) };
  }

  function baueSchritte(strecke) {
    const m = strecke.halte.length - 1;
    const s = [{ typ: 'start', ab: 1 }];
    const b = ton(strecke, 'begruessung');
    if (b) s.push({ typ: 'begruessung', ab: 1, ton: b });
    for (let k = 1; k <= m; k++) {
      s.push({ typ: 'ansage', halt: k, ab: k, ton: ton(strecke, 'ansage', k) });
      if (k < m) s.push({ typ: 'abfahrt', halt: k, ab: k + 1 });
    }
    s.push({ typ: 'ende', halt: m, ab: m });
    return s;
  }

  class Fahrt {
    constructor(strecke, opts) {
      if (!strecke || !Array.isArray(strecke.halte) || strecke.halte.length < 2) throw new Error('Strecke braucht mindestens zwei Haltestellen');
      this.strecke = strecke;
      this.o = Object.assign({}, STANDARD, opts || {});
      if (strecke.ansageVorHalt) this.o.ansageVorHalt = strecke.ansageVorHalt;
      if (opts && opts.ansageVorHalt) this.o.ansageVorHalt = opts.ansageVorHalt;
      this.schritte = baueSchritte(strecke);
      this.m = strecke.halte.length - 1;
      this.i = 0;
      this.letzterTon = null;
      this.pos = null;
      this.sperre = null;   // nach „Zurück“: Automatik ruht, bis der Bus ein Stück gefahren ist
      this._neu();
    }

    get schritt() { return this.schritte[this.i]; }
    get halte() { return this.strecke.halte; }
    /** Haltestellen, die gerade angezeigt werden (nächster Halt zuerst). */
    get anzeige() { return this.halte.slice(this.schritt.ab).map(h => h.name); }
    get amEnde() { return this.schritt.typ === 'ende'; }

    _neu() { this.amHalt = false; this.warAmStart = false; this.warNah = false; }

    _gehe(i, quelle, mitTon) {
      if (i < 0 || i >= this.schritte.length || i === this.i) return null;
      this.i = i;
      this._neu();
      const s = this.schritt;
      const ev = { schritt: s, index: i, quelle: quelle, ton: (mitTon && s.ton) ? s.ton : null };
      if (ev.ton) this.letzterTon = ev.ton;
      return ev;
    }

    _index(typ, halt) { return this.schritte.findIndex(s => s.typ === typ && (halt === undefined || s.halt === halt)); }

    /** Fahrer: ein Schritt vor (spielt die Ansage dieses Schritts, wie ein Klick in der PowerPoint). */
    weiter() { this.sperre = null; return this._gehe(this.i + 1, 'fahrer', true); }

    /** Fahrer: ein Schritt zurück (ohne Ton). Die Automatik ruht, bis der Bus 250 m gefahren ist. */
    zurueck() {
      const ev = this._gehe(this.i - 1, 'fahrer', false);
      if (ev) this.sperre = { pos: this.pos, bis: Date.now() + 3 * 60 * 1000 };
      return ev;
    }

    /** Begrüßung sofort (Einstellung „Begrüßung sofort beim Start“). */
    begruessen() {
      const i = this._index('begruessung');
      return (this.i === 0 && i > 0) ? this._gehe(i, 'start', true) : null;
    }

    /** Ziel, auf das das GPS gerade wartet – für die Anzeige beim Fahrer. */
    naechsterGpsSchritt() {
      const s = this.schritt;
      if (s.typ === 'ende') return null;
      if (s.typ === 'start') return { was: 'Begrüßung bei Abfahrt von', halt: 0 };
      if (s.typ === 'ansage') return { was: (s.halt === this.m ? 'Ankunft' : 'Abfahrt') + ' an', halt: s.halt };
      const k = s.typ === 'begruessung' ? 1 : s.halt + 1;
      return { was: 'Ansage', halt: k };
    }

    /** Neuer GPS-Punkt {lat, lon, genauigkeit, zeit}. Gibt Ereignisse zurück (meist keine). */
    gps(p) {
      if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return [];
      if (p.genauigkeit != null && p.genauigkeit > this.o.genauigkeitMax) return [];
      this.pos = p;
      if (this.sperre) {
        const gefahren = this.sperre.pos ? abstand(this.sperre.pos, p) : 0;
        if (gefahren < 250 && Date.now() < this.sperre.bis) return [];
        this.sperre = null;
      }
      const ev = [];
      for (let n = 0; n < 4; n++) {          // mehrere Schritte auf einmal möglich (z. B. dicht beieinander liegende Halte)
        const e = this._schritt(p);
        if (!e) break;
        ev.push(e);
      }
      return ev;
    }

    _d(k) { return abstand(this.halte[k], this.pos); }

    _schritt(p) {
      const o = this.o, s = this.schritt, m = this.m;
      if (s.typ === 'ende') return null;

      // Bus steht schon an einem späteren Halt (z. B. Automatik verpasst, GPS war weg): dorthin springen, ohne Ton.
      const ziel = s.typ === 'start' || s.typ === 'begruessung' ? 1 : (s.typ === 'abfahrt' ? s.halt + 1 : s.halt);
      for (let j = m; j > ziel; j--) {
        if (this._d(j) <= o.ankunftRadius) {
          const ev = this._gehe(j === m ? this._index('ende') : this._index('ansage', j), 'gps', false);
          if (ev && j < m) this.amHalt = true;
          return ev;
        }
      }

      if (s.typ === 'start') {
        const d0 = this._d(0);
        if (d0 <= o.startRadius) this.warAmStart = true;
        if (this.warAmStart && d0 > o.startRadius + 30) {
          const i = this._index('begruessung');
          if (i > 0) return this._gehe(i, 'gps', true);
        }
        // Fahrt erst unterwegs gewählt (Bus war nie am ersten Halt): gleich „Nächste Haltestelle“.
        if (!this.warAmStart && this._d(1) <= o.ansageVorHalt && this._d(0) > o.startRadius) return this._gehe(this._index('ansage', 1), 'gps', true);
        return null;
      }

      if (s.typ === 'begruessung' || s.typ === 'abfahrt') {
        const k = s.typ === 'begruessung' ? 1 : s.halt + 1;
        if (this._d(k) <= o.ansageVorHalt) return this._gehe(this._index('ansage', k), 'gps', true);
        return null;
      }

      if (s.typ === 'ansage') {
        const k = s.halt, dk = this._d(k);
        if (dk <= o.ansageVorHalt) this.warNah = true;
        if (dk <= o.ankunftRadius) this.amHalt = true;
        if (k === m) return this.amHalt ? this._gehe(this._index('ende'), 'gps', false) : null;
        if (this.amHalt && dk > o.abfahrtRadius) return this._gehe(this._index('abfahrt', k), 'gps', false);
        // Halt nicht genau getroffen (Position der Ersatzhaltestelle weicht ab): Bus war in der Nähe, ist nun deutlich weiter Richtung nächster Halt.
        const seg = abstand(this.halte[k], this.halte[k + 1]);
        if (this.warNah && dk > 400 && this._d(k + 1) < seg - 300) return this._gehe(this._index('abfahrt', k), 'gps', false);
        return null;
      }
      return null;
    }
  }

  const api = { Fahrt: Fahrt, abstand: abstand, autoText: autoText, STANDARD: STANDARD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HSAFahrt = api;
})(typeof window !== 'undefined' ? window : globalThis);
