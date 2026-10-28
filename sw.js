// =====================================================================
// sw.js â€” service worker: guarda os arquivos do app para abrir sem
// internet. Os DADOS nÃ£o passam por aqui (ficam no Supabase + fila local).
// Ao mudar qualquer arquivo do app, aumente a VERSAO para forÃ§ar atualizaÃ§Ã£o.
// =====================================================================
const VERSAO = 'metas-v20';
const ARQUIVOS = [
  './', 'index.html', 'styles.css', 'config.js', 'calc.js', 'seed.js', 'app.js', 'graficos.js', 'ajustes.js', 'ideias.js', 'notas.js',
  'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

// Apaga caches de versÃµes antigas
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys()
    .then(chaves => Promise.all(chaves.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Supabase (API de dados e login) nunca vem do cache
  if (url.hostname.endsWith('supabase.co')) return;

  // Arquivos do app: rede primeiro (pega a versÃ£o nova), cache se estiver offline
  if (url.origin === location.origin) {
    ev.respondWith(
      fetch(req).then(resp => {
        const copia = resp.clone();
        caches.open(VERSAO).then(c => c.put(req, copia));
        return resp;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./')))
    );
    return;
  }
  // Bibliotecas do CDN tÃªm versÃ£o fixa: cache primeiro
  ev.respondWith(caches.match(req).then(r => r || fetch(req)));
});
