/* Ablauf einer Fahrt – bedient vom Fahrer mit einer einzigen Schaltfläche.
 *
 *   Fahrplan antippen      → Anzeige zeigt die Strecke, Paula begrüßt die Fahrgäste
 *   „Nächste Haltestelle“  → Paula sagt „Nächste Haltestelle: …“ für den angezeigten Halt
 *   2 Minuten nach Ende dieser Ansage rückt die Anzeige zum folgenden Halt weiter.
 *   Nach der Ansage des Endhalts: Ende (die App startet dann ggf. die Rückfahrt).
 *
 * Diese Datei kennt weder Bildschirm noch Ton noch Uhr; die Zeit wird von außen übergeben.
 */
(function (global) {
  'use strict';

  const STANDARD = { wechselNachMs: 2 * 60 * 1000 };

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

  class Fahrt {
    constructor(strecke, opts) {
      if (!strecke || !Array.isArray(strecke.halte) || strecke.halte.length < 2) throw new Error('Fahrplan braucht mindestens zwei Haltestellen');
      this.strecke = strecke;
      this.o = Object.assign({}, STANDARD, opts || {});
      this.m = strecke.halte.length - 1;
      this.k = 1;              // Index der angezeigten nächsten Haltestelle (Halt 0 ist der Startpunkt)
      this.ende = false;       // Endhalt angesagt und Wechselzeit abgelaufen
      this.angesagt = false;   // „Nächste Haltestelle“ für k wurde schon angesagt
      this.wechselUm = null;   // Zeitpunkt, zu dem die Anzeige weiterrückt
      this.letzterTon = null;
    }

    get halte() { return this.strecke.halte; }
    get naechster() { return this.halte[this.k]; }
    /** Haltestellen, die angezeigt werden (nächster Halt zuerst, Endhalt zuletzt). */
    get anzeige() { return this.halte.slice(this.k).map(h => h.name); }
    get amEnde() { return this.ende; }
    get istEndhalt() { return this.k === this.m; }

    begruessung() {
      const t = ton(this.strecke, 'begruessung');
      if (t) this.letzterTon = t;
      return t;
    }

    /** Fahrer tippt „Nächste Haltestelle“. Gibt die Ansage zurück; die Wartezeit startet mit ansageFertig(). */
    ansage() {
      if (this.ende) return this.letzterTon;          // am Ende: letzte Ansage wiederholen, nichts weiterschalten
      const t = ton(this.strecke, 'ansage', this.k);
      this.angesagt = true;
      this.wechselUm = null;
      if (t) this.letzterTon = t;
      return t;
    }

    /** Ansage ist zu Ende gesprochen: jetzt läuft die Zeit bis zum Weiterrücken. */
    ansageFertig(jetzt) {
      if (this.angesagt && !this.ende) this.wechselUm = jetzt + this.o.wechselNachMs;
    }

    restMs(jetzt) { return this.wechselUm == null ? null : Math.max(0, this.wechselUm - jetzt); }

    /** Regelmäßig aufrufen. Liefert ein Ereignis, wenn die Anzeige weiterrückt. */
    tick(jetzt) {
      if (this.wechselUm != null && jetzt >= this.wechselUm) { this.wechselUm = null; return this._vor('zeit'); }
      return null;
    }

    /** Fahrer: sofort weiter zum nächsten Halt (ohne Ansage). */
    weiter() { this.wechselUm = null; return this._vor('fahrer'); }

    /** Fahrer: einen Halt zurück. */
    zurueck() {
      this.wechselUm = null; this.angesagt = false;
      if (this.ende) { this.ende = false; return { typ: 'zurueck', k: this.k }; }
      if (this.k > 1) { this.k--; return { typ: 'zurueck', k: this.k }; }
      return null;
    }

    _vor(quelle) {
      if (this.ende) return null;
      this.angesagt = false;
      if (this.k < this.m) { this.k++; return { typ: 'weiter', k: this.k, quelle }; }
      this.ende = true;
      return { typ: 'ende', quelle };
    }
  }

  const api = { Fahrt: Fahrt, autoText: autoText, STANDARD: STANDARD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HSAFahrt = api;
})(typeof window !== 'undefined' ? window : globalThis);
