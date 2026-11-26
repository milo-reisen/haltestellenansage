const assert = require('assert');
const { Fahrt, abstand } = require('../fahrt.js');
const hin = require('../strecken/s28-nach-vohwinkel.json');

// Strecke abfahren: gerade Linien zwischen den Halten, mit kleinem seitlichem Versatz (Ersatzhaltestelle nicht exakt)
function fahre(strecke, { versatz = 0, schritt = 15, halt = 6, vorlauf = [] } = {}) {
  const h = strecke.halte, pts = [...vorlauf];
  const off = (p, m) => ({ lat: p.lat + m / 111000, lon: p.lon });
  for (let k = 0; k < h.length - 1; k++) {
    const a = off(h[k], versatz), b = off(h[k + 1], versatz);
    const n = Math.ceil(abstand(a, b) / schritt);
    if (k === 0) for (let w = 0; w < halt; w++) pts.push(a);
    for (let i = 1; i <= n; i++) pts.push({ lat: a.lat + (b.lat - a.lat) * i / n, lon: a.lon + (b.lon - a.lon) * i / n });
    for (let w = 0; w < halt; w++) pts.push(b);
  }
  return pts;
}
function lauf(f, pts) {
  const log = [];
  for (const p of pts) for (const e of f.gps({ ...p, genauigkeit: 8 })) {
    log.push(e.schritt.typ + (e.schritt.halt != null ? ':' + e.schritt.halt : '') + (e.ton ? '+TON' : ''));
  }
  return log;
}
// 1) Normale Fahrt
let f = new Fahrt(hin);
let log = lauf(f, fahre(hin));
console.log('normal  ', log.join(' → '));
assert.deepStrictEqual(log, ['begruessung+TON', 'ansage:1+TON', 'abfahrt:1', 'ansage:2+TON', 'ende:2']);
// Anzeige-Folge prüfen
f = new Fahrt(hin);
assert.deepStrictEqual(f.anzeige, ['Wuppertal - Hahnenfurth/Düssel', 'Wuppertal-Vohwinkel']);
// 2) Ersatzhaltestellen 130 m neben der gespeicherten Position (Ankunftsradius wird nicht erreicht)
f = new Fahrt(hin);
log = lauf(f, fahre(hin, { versatz: 130 }));
console.log('versatz ', log.join(' → '));
assert.deepStrictEqual(log.slice(0, 4), ['begruessung+TON', 'ansage:1+TON', 'abfahrt:1', 'ansage:2+TON']);
// 3) Fahrt erst unterwegs gewählt (nie am Start gewesen)
f = new Fahrt(hin);
const pts = fahre(hin).filter(p => abstand(p, hin.halte[0]) > 1500 || abstand(p, hin.halte[1]) < 3000);
log = lauf(f, pts.slice(pts.findIndex(p => abstand(p, hin.halte[0]) > 1500)));
console.log('unterwegs', log.join(' → '));
assert.strictEqual(log[0], 'ansage:1+TON');
// 4) Fahrer: Weiter/Zurück wie PowerPoint
f = new Fahrt(hin);
const klicks = [];
for (let i = 0; i < 6; i++) { const e = f.weiter(); klicks.push(e ? e.schritt.typ + (e.ton ? '+TON' : '') + ' [' + f.anzeige.join(' | ') + ']' : 'nichts'); }
console.log('weiter  ', klicks.join('\n          '));
assert.strictEqual(f.weiter(), null);
const z = f.zurueck(); assert.ok(z && !z.ton);
// 5) Zurück sperrt die Automatik, bis der Bus 250 m gefahren ist
f = new Fahrt(hin);
const all = fahre(hin); let idx = 0;
for (; idx < all.length; idx++) { const ev = f.gps({ ...all[idx], genauigkeit: 5 }); if (ev.some(e => e.schritt.typ === 'ansage')) break; }
f.zurueck(); const st = f.schritt.typ;
const ev = f.gps({ ...all[idx], genauigkeit: 5 });
assert.strictEqual(ev.length, 0); assert.strictEqual(f.schritt.typ, st);
console.log('sperre   ok (' + st + ')');
// 6) Ungenaue Punkte werden ignoriert
f = new Fahrt(hin); assert.deepStrictEqual(f.gps({ lat: hin.halte[2].lat, lon: hin.halte[2].lon, genauigkeit: 500 }), []);
// 7) Automatischer Text ohne Ton
const r = require('../strecken/s28-nach-mettmann.json');
f = new Fahrt(r); console.log('texte    ', f.schritte.filter(s => s.ton).map(s => (s.ton.datei || 'TTS') + ': ' + s.ton.text.slice(0, 60)).join('\n          '));
const kurz = { kopf: 'Ersatzverkehr U76', ziel: 'Krefeld Rheinstraße', halte: [{ name: 'A', lat: 51, lon: 6 }, { name: 'B / Mitte', lat: 51.001, lon: 6 }, { name: 'C', lat: 51.002, lon: 6 }] };
f = new Fahrt(kurz); console.log('auto     ', f.schritte.filter(s => s.ton).map(s => s.ton.text).join('\n          '));
// 8) Dicht beieinander liegende Halte (Stadtlinie, 300 m Abstand)
const dicht = { kopf: 'X', halte: [0, 1, 2, 3, 4].map(i => ({ name: 'H' + i, lat: 51 + i * 0.0027, lon: 6 })) };
f = new Fahrt(dicht); log = lauf(f, fahre(dicht, { schritt: 10, halt: 5 }));
console.log('dicht   ', log.join(' → '));
assert.deepStrictEqual(log, ['begruessung+TON', 'ansage:1+TON', 'abfahrt:1', 'ansage:2+TON', 'abfahrt:2', 'ansage:3+TON', 'abfahrt:3', 'ansage:4+TON', 'ende:4']);
console.log('ALLE TESTS OK');
