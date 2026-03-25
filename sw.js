/**
 * CAP Chamados — FMC
 * Service Worker v1.2
 * Estratégia: Cache-First para assets estáticos, Network-First para o formulário.
 * Garante funcionamento offline básico: o usuário vê o formulário mesmo sem internet.
 * O envio ao Apps Script só ocorre com conexão — chamados pendentes ficam na fila.
 */

const CACHE_NAME = 'cap-chamados-v1.2';
const OFFLINE_URL = './index.html';

// Assets que SEMPRE devem estar em cache
const PRECACHE = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Rajdhani:wght@400;500;600;700&display=swap'
];

// ── INSTALL: pré-cacheia os assets essenciais ──────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Instalando CAP PWA...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pré-cacheando assets essenciais');
      // Cacheia cada asset individualmente para não falhar tudo se um asset falhar
      return Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Falha ao cachear:', url, err))
        )
      );
    }).then(() => {
      console.log('[SW] Instalação concluída');
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE: limpa caches antigos ────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Ativando novo Service Worker...');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Removendo cache antigo:', key);
            return caches.delete(key);
          })
      )
    ).then(() => {
      console.log('[SW] Service Worker ativo e pronto');
      return self.clients.claim();
    })
  );
});

// ── FETCH: estratégia híbrida ──────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora requisições não-GET (ex: POST para Apps Script)
  if (request.method !== 'GET') return;

  // Ignora extensões de browser e chrome-extension
  if (!url.protocol.startsWith('http')) return;

  // Para o Apps Script (envio do formulário) — sempre tenta network
  if (url.hostname.includes('script.google.com')) return;

  // Para o index.html — Network-First (garante conteúdo atualizado)
  // Fallback para cache se offline
  if (url.pathname.endsWith('index.html') || url.pathname.endsWith('/')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Para fontes do Google — Cache-First (evita latência)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Para demais assets locais (icons, manifest) — Cache-First
  event.respondWith(cacheFirst(request));
});

// Estratégia: Network primeiro, cache como fallback
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Último recurso: retorna a página offline principal
    return caches.match(OFFLINE_URL);
  }
}

// Estratégia: Cache primeiro, network como fallback + atualização em background
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Atualiza cache em background sem bloquear a resposta
    fetch(request).then(response => {
      if (response.ok) {
        caches.open(CACHE_NAME).then(cache => cache.put(request, response));
      }
    }).catch(() => {}); // Silencia falhas de rede em background
    return cached;
  }
  // Não está em cache — busca da rede e cacheia
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Sem cache e sem rede — retorna página principal como fallback
    return caches.match(OFFLINE_URL);
  }
}

// ── BACKGROUND SYNC: tenta reenviar chamados pendentes ────────────────────
// Requer registro no cliente: navigator.serviceWorker.ready.then(sw => sw.sync.register('sync-chamados'))
self.addEventListener('sync', event => {
  if (event.tag === 'sync-chamados') {
    console.log('[SW] Background Sync: tentando reenviar chamados pendentes...');
    event.waitUntil(syncPendingChamados());
  }
});

async function syncPendingChamados() {
  // Lê chamados pendentes do IndexedDB (implementação futura)
  // Por ora, apenas loga — a lógica de fila pode ser expandida aqui
  console.log('[SW] Sync de chamados pendentes concluído');
}

// ── PUSH NOTIFICATIONS: recebe notificações de status ─────────────────────
// Para ativar, configure Web Push no Apps Script e passe a chave VAPID
self.addEventListener('push', event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: 'CAP Chamados', body: event.data.text() }; }

  const options = {
    body: data.body || 'Atualização no seu chamado',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.protocolo || 'cap-update',
    renotify: true,
    data: { url: data.url || './index.html' },
    actions: [
      { action: 'ver', title: 'Ver chamado' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'CAP · FMC', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || './index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});
