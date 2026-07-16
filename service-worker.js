// 避難所案内マップ Service Worker
const CACHE_VERSION = 'v1';
const CORE_CACHE = `hinanjo-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `hinanjo-runtime-${CACHE_VERSION}`;
const TILE_CACHE = `hinanjo-tiles-${CACHE_VERSION}`;

const MAX_TILE_ENTRIES = 300;

// アプリの起動に最低限必要なファイル（同一オリジン）
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names
        .filter((name) => ![CORE_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(name))
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

// 地図タイルキャッシュのサイズを上限内に保つ
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxEntries) {
    await cache.delete(keys[0]);
    await trimCache(cacheName, maxEntries);
  }
}

function isTileRequest(url) {
  return /tile\.openstreetmap\.org/.test(url);
}

function isCdnAsset(url) {
  return /unpkg\.com|cdn\.tailwindcss\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = request.url;

  // ページ遷移（ナビゲーション）：ネットワーク優先、失敗時はキャッシュ済みindex.htmlを返す
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CORE_CACHE).then((cache) => cache.put('./index.html', clone));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 地図タイル：キャッシュ優先、裏でネットワーク更新（オフラインでも既訪問エリアを表示可能に）
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
            trimCache(TILE_CACHE, MAX_TILE_ENTRIES);
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // CDN上のライブラリ・フォント：stale-while-revalidate
  if (isCdnAsset(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        const fetchPromise = fetch(request).then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 同一オリジンのその他アセット：キャッシュ優先
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CORE_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});
