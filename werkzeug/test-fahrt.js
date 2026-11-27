// Prüft den Ablauf einer Fahrt ohne Tablet:  node werkzeug/test-fahrt.js
const assert = require('assert');
const { Fahrt } = require('../fahrt.js');
// Beispiel-Fahrpläne für die Tests (werkzeug/beispiel/, nicht in der App) – die echten in strecken/ kann der Admin löschen
const hin = require('./beispiel/s28-nach-vohwinkel.json');
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

// 3) Endhalt: Ansage, danach bleibt das Bild stehen (keine Wartezeit, keine Rückfahrt von selbst);
//    nochmal tippen wiederholt nur die letzte Ansage
const end = f.ansage(); assert.ok(/endet hier/.test(end.text));
f.ansageFertig(t + 3 * MIN);
assert.strictEqual(f.restMs(t + 3 * MIN), null, 'am Endhalt läuft keine Zeit');
assert.strictEqual(f.tick(t + 60 * MIN), null);
assert.ok(f.istEndhalt && !f.amEnde);
assert.deepStrictEqual(f.anzeige, ['Wuppertal-Vohwinkel']);
assert.deepStrictEqual(f.ansage(), end); f.ansageFertig(t + 61 * MIN); assert.strictEqual(f.tick(t + 90 * MIN), null);

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

// 8) Verwaltung: Fahrplan löschen – eigene Ansagen weg, gemeinsame bleiben, Rückfahrt-Verweise weg
const { planeLoeschung } = require('../verwaltung.js');
const alle = {};
for (const d of fs.readdirSync(ordner).filter(x => x.endsWith('.json') && x !== 'index.json')) alle[d.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(ordner, d), 'utf8'));
for (const d of ['s28-nach-vohwinkel', 's28-nach-mettmann']) alle[d] = require('./beispiel/' + d + '.json');
let plan = planeLoeschung(alle, 's11-nach-neuss-hbf');
assert.ok(plan.loeschen.includes('strecken/s11-nach-neuss-hbf.json'));
assert.ok(plan.loeschen.includes('ton/s11-begruessung-nach-neuss-hbf.mp3'));
assert.ok(plan.loeschen.includes('ton/s11-endhalt-neuss-hbf.mp3'));
assert.ok(!plan.loeschen.includes('ton/s11-halt-dormagen.mp3'), 'gemeinsame Ansage darf nicht gelöscht werden');
assert.deepStrictEqual(plan.rueckVon, ['s11-nach-koeln-worringen']);
const ohneRueck = JSON.parse(plan.aendern['strecken/s11-nach-koeln-worringen.json']);
assert.strictEqual(ohneRueck.rueckfahrt, undefined);
assert.strictEqual(ohneRueck.halte.length, alle['s11-nach-koeln-worringen'].halte.length);
assert.ok(!JSON.parse(plan.aendern['strecken/index.json']).strecken.includes('s11-nach-neuss-hbf'));
// unveränderte Teile bleiben Zeichen für Zeichen gleich (gleiche Schreibweise wie werkzeug/fertig.py)
const vorher = fs.readFileSync(path.join(ordner, 's11-nach-koeln-worringen.json'), 'utf8');
assert.strictEqual(plan.aendern['strecken/s11-nach-koeln-worringen.json'], vorher.replace(/\n  "rueckfahrt": "s11-nach-neuss-hbf",/, ''));
plan = planeLoeschung(alle, 's28-nach-mettmann');
assert.deepStrictEqual(plan.loeschen, ['strecken/s28-nach-mettmann.json']);
assert.deepStrictEqual(plan.rueckVon, ['s28-nach-vohwinkel']);
assert.throws(() => planeLoeschung({ a: alle['s28-nach-mettmann'] }, 'a'), /letzte Fahrplan/);
console.log('  Verwaltung: Löschen geprüft');
console.log('ALLE TESTS OK');
