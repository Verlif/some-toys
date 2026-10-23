/**
 * Service Worker：静态资源缓存，离线可打开。
 *
 * 策略：
 *   - 预缓存核心资源（HTML / CSS / JS）到安装阶段；
 *   - 运行时 cache-first（命中就用缓存，没命中再走网络并补缓存）；
 *   - 版本号变了就丢弃旧缓存。
 *
 * ⚠️ 新增 / 改名静态资源时要同步更新 ASSETS 列表，否则离线会缺文件。
 */
const VERSION = 'sun-farm-v1';
const CACHE = `sun-farm-${VERSION}`;

/** 核心资源：安装时一次性全部缓存 */
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './styles/base.css',
  './styles/components.css',
  './styles/layout.css',
  './styles/animations.css',
  './icons/icon.svg',
];

/** 运行时追加缓存的 JS 模块（第一次联网时按需缓存） */
const RUNTIME_CACHE = [/\/src\/.*\.js$/, /\/vendor\/.*\.js$/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域请求（信令服务器等）不走缓存
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        // 只缓存成功的同源静态资源
        if (res.ok && (RUNTIME_CACHE.some((re) => re.test(url.pathname)) || url.pathname === '/' || url.pathname.endsWith('.html'))) {
          const clone = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, clone));
        }
        return res;
      });
    }),
  );
});
