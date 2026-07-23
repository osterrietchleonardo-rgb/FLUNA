/* ============================================================
   FLUNA PIZZERÍA - SERVICE WORKER PWA (SW.JS)

   Al agregar o renombrar un JS/CSS: sumalo a ASSETS_TO_CACHE
   y subí CACHE_NAME, o los usuarios seguirán con la versión vieja.
   ============================================================ */

const CACHE_NAME = 'fluna-pwa-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './admin.html',
  './css/styles.css',
  './js/utils.js',
  './js/supabase-config.js',
  './js/payments.js',
  './js/app.js',
  './js/admin.js',
  './brand/logo_fluna.jpg',
  './manifest.json'
];

// Nunca cachear: datos vivos (pedidos, chat, stock) y funciones serverless.
// Servirlos desde caché mostraría pedidos viejos como si fueran actuales.
const NEVER_CACHE = [
  '/api/',
  'supabase.co',
  'sdk.mercadopago.com',
  'image.pollinations.ai'
];

function isCacheable(request) {
  const url = request.url;
  if (!url.startsWith('http')) return false;
  return !NEVER_CACHE.some(fragment => url.includes(fragment));
}

// Instalación del Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-cacheados los recursos de la PWA FLuna');
      // addAll() aborta la instalación entera si un solo asset falla.
      return Promise.all(
        ASSETS_TO_CACHE.map(asset =>
          cache.add(asset).catch(err => console.warn('[SW] No se pudo cachear', asset, err))
        )
      );
    })
  );
  self.skipWaiting();
});

// Activación y limpieza de cachés antiguos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(cache => cache !== CACHE_NAME)
          .map(cache => {
            console.log('[SW] Eliminando caché antiguo:', cache);
            return caches.delete(cache);
          })
      );
    })
  );
  self.clients.claim();
});

// Estrategia Network-First con fallback a caché para el shell de la PWA
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!isCacheable(event.request)) return;

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Solo guardamos respuestas propias y completas (no opaques ni 206).
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, responseClone))
            .catch(err => console.warn('[SW] No se pudo guardar en caché:', err));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;

        // `accept` puede venir vacío: sin este guard el handler tiraba excepción.
        const accept = event.request.headers.get('accept') || '';
        if (event.request.mode === 'navigate' || accept.includes('text/html')) {
          const shell = await caches.match('./index.html');
          if (shell) return shell;
        }

        return new Response('Sin conexión. Volvé a intentar cuando tengas señal.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});
