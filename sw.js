/* Gerätespeicher der App: damit sie auch ohne Netz startet und alle Ansagen abspielt.
 * Die Zeile mit CACHE und DATEIEN schreibt werkzeug/fertig.py – nicht von Hand ändern. */
const CACHE = "hsa-2.4.0-2664515cdd", DATEIEN = ["app.css?v=be33064ce2", "fahrt.js?v=9535e2f8e5", "app.js?v=e1ec270f0f", "manifest.webmanifest", "strecken/index.json", "strecken/s11-nach-duesseldorf-hbf.json", "strecken/s11-nach-koeln-worringen.json", "strecken/s11-nach-neuss-hbf.json", "strecken/s28-nach-mettmann.json", "strecken/s28-nach-vohwinkel.json", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-semi-condensed-latin-500-normal.woff2", "fonts/barlow-semi-condensed-latin-600-normal.woff2", "fonts/barlow-semi-condensed-latin-700-normal.woff2", "bilder/haltestelle.png", "bilder/sev.png", "logo/emblem-256.png", "logo/schriftzug-hell.png", "logo/schriftzug.png", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-192.png", "icons/maskable-512.png", "ton/s11-begruessung-nach-duesseldorf-hbf.mp3", "ton/s11-begruessung-nach-koeln-worringen.mp3", "ton/s11-begruessung-nach-neuss-hbf.mp3", "ton/s11-endhalt-duesseldorf-hbf.mp3", "ton/s11-endhalt-koeln-worringen.mp3", "ton/s11-endhalt-neuss-hbf.mp3", "ton/s11-halt-dormagen-chempark.mp3", "ton/s11-halt-dormagen.mp3", "ton/s11-halt-duesseldorf-bilk.mp3", "ton/s11-halt-duesseldorf-friedrichstadt.mp3", "ton/s11-halt-duesseldorf-hamm.mp3", "ton/s11-halt-duesseldorf-voelklinger-strasse.mp3", "ton/s11-halt-neuss-allerheiligen.mp3", "ton/s11-halt-neuss-am-kaiser.mp3", "ton/s11-halt-neuss-hbf.mp3", "ton/s11-halt-neuss-norf.mp3", "ton/s11-halt-neuss-rheinparkcenter.mp3", "ton/s11-halt-neuss-sued.mp3", "ton/s11-halt-nievenheim.mp3", "ton/s28-begruessung-nach-vohwinkel.mp3", "ton/s28-naechster-halt-hahnenfurth.mp3", "ton/s28-naechster-halt-vohwinkel-endhalt.mp3"];
const PRAEFIX = 'hsa-';
const BASIS = './';

const vorrat = c => c.addAll([BASIS].concat(DATEIEN));

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(vorrat).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.indexOf(PRAEFIX) === 0 && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* Teilabruf (Range) für Audio aus dem Gerätespeicher beantworten. */
async function teilantwort(req, res) {
  const range = req.headers.get('range');
  if (!range || !res) return res;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;
  const buf = await res.arrayBuffer();
  const start = m[1] ? Number(m[1]) : 0;
  const ende = m[2] ? Math.min(Number(m[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, ende + 1), {
    status: 206, statusText: 'Partial Content',
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': 'bytes ' + start + '-' + ende + '/' + buf.byteLength, 'Content-Length': String(ende - start + 1), 'Accept-Ranges': 'bytes' }
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (/\/version\.json$/.test(u.pathname)) return;                       // immer frisch aus dem Netz

  // Startseite und Strecken: zuerst Netz (neue Strecken kommen sofort an), sonst Gerätespeicher
  if (req.mode === 'navigate' || /\/strecken\/[^/]+\.json$/.test(u.pathname)) {
    const schluessel = req.mode === 'navigate' ? BASIS : u.pathname.replace(/^.*\/(strecken\/)/, '$1');
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const kopie = res.clone(); caches.open(CACHE).then(c => c.put(schluessel, kopie)); }
      return res;
    }).catch(() => caches.open(CACHE).then(c => c.match(schluessel, { ignoreSearch: true }))));
    return;
  }

  // Alles andere (Programm, Bilder, Schrift, Ansagen): zuerst Gerätespeicher
  e.respondWith(caches.open(CACHE).then(c => {
    const ohneRange = new Request(req.url);
    return c.match(ohneRange).then(hit => hit || c.match(ohneRange, { ignoreSearch: true }).then(h2 => {
      if (h2 && !/\?v=/.test(u.search)) return h2;
      return fetch(ohneRange).then(res => { if (res.ok && res.status === 200) c.put(ohneRange, res.clone()); return res; });
    })).then(res => teilantwort(req, res));
  }).catch(() => fetch(req)));
});
