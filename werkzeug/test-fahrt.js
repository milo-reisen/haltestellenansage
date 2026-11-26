// Prüft den Ablauf einer Fahrt ohne Tablet:  node werkzeug/test-fahrt.js
const assert = require('assert');
const { Fahrt } = require('../fahrt.js');
const hin = require('../strecken/s28-nach-vohwinkel.json');
const s11 = require('../strecken/s11-nach-koeln-worringen.json');
const MIN = 60 * 1000;

// 1) Start: nächster Halt ist der erste nach dem Startpunkt, Begrüßung kommt aus der Datei
let f = new Fahrt(hin);
assert.deepStrictEqual(f.anzeige, ['Wuppertal - Hahnenfurth/Düssel', 'Wuppertal-Vohwinkel']);
assert.ok(f.begruessung().datei.endsWith('.mp3'));

// 2) „Nächste Haltestelle“ → Ansage, Anzeige bleibt, nach Ende der Ansage + 2 Minuten rückt sie weiter
let t = 1000000;
const a = f.ansage();
assert.ok(/Hahnenfurth/.test(a.text));
assert.strictEqual(f.tick(t + 10 * MIN), null, 'ohne ansageFertig darf nichts weiterrücken');
f.ansageFertig(t);
assert.strictEqual(f.tick(t + 2 * MIN - 1), null);
assert.strictEqual(f.restMs(t + MIN), MIN);
let e = f.tick(t + 2 * MIN);
assert.deepStrictEqual([e.typ, f.anzeige], ['weiter', ['Wuppertal-Vohwinkel']]);
assert.strictEqual(f.tick(t + 5 * MIN), null, 'nur einmal weiterrücken');

// 3) Endhalt: Ansage, nach 2 Minuten Ende; danach wiederholt die Schaltfläche nur die letzte Ansage
const end = f.ansage(); assert.ok(/endet hier/.test(end.text));
f.ansageFertig(t + 3 * MIN);
e = f.tick(t + 5 * MIN);
assert.strictEqual(e.typ, 'ende'); assert.ok(f.amEnde);
assert.deepStrictEqual(f.anzeige, ['Wuppertal-Vohwinkel']);
assert.strictEqual(f.ansage(), end); f.ansageFertig(t + 6 * MIN); assert.strictEqual(f.tick(t + 9 * MIN), null);

// 4) Nochmal tippen während der Wartezeit: Zeit beginnt nach der neuen Ansage von vorn
f = new Fahrt(hin); f.ansage(); f.ansageFertig(t);
f.ansage(); f.ansageFertig(t + 90 * 1000);
assert.strictEqual(f.tick(t + 2 * MIN), null);
assert.strictEqual(f.tick(t + 90 * 1000 + 2 * MIN).typ, 'weiter');

// 5) Weiter/Zurück durch den Fahrer
f = new Fahrt(s11);
assert.strictEqual(f.anzeige.length, 7);
f.weiter(); f.weiter(); assert.strictEqual(f.naechster.name, 'Neuss Allerheiligen');
f.zurueck(); assert.strictEqual(f.naechster.name, 'Neuss-Norf');
for (let i = 0; i < 10; i++) f.weiter();
assert.ok(f.amEnde); assert.strictEqual(f.weiter(), null);
f.zurueck(); assert.ok(!f.amEnde && f.istEndhalt);
f = new Fahrt(s11); assert.strictEqual(f.zurueck(), null);

// 6) Andere Wechselzeit (Einstellung)
f = new Fahrt(hin, { wechselNachMs: 10000 }); f.ansage(); f.ansageFertig(t);
assert.strictEqual(f.tick(t + 10000).typ, 'weiter');

// 7) Alle Fahrpläne: jede Ansage hat Text, Begrüßung vorhanden
const fs = require('fs'), path = require('path');
const ordner = path.join(__dirname, '..', 'strecken');
for (const d of fs.readdirSync(ordner).filter(x => x.endsWith('.json') && x !== 'index.json')) {
  const s = JSON.parse(fs.readFileSync(path.join(ordner, d), 'utf8'));
  const g = new Fahrt(s);
  assert.ok(g.begruessung().text.length > 20, d + ': Begrüßung');
  for (let k = 1; k <= g.m; k++) { const x = g.ansage(); assert.ok(x && x.text.includes('Nächste Haltestelle'), d + ': Ansage ' + k); g.weiter(); }
  console.log('  ' + d + ': ' + g.m + ' Ansagen, ' + [s.begruessung, ...s.halte.slice(1).map(h => h.ansage)].filter(x => x && x.ton).length + ' Aufnahmen');
}
console.log('ALLE TESTS OK');
