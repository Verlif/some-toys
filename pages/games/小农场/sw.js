/**
 * Service Worker：静态资源缓存，离线可打开。
 *
 * 策略（v2 起）：**网络优先，离线才回退缓存**
 *
 *   - 页面导航（HTML）、`/src/*.js`、`/styles/*.css`、`/vendor/*.js` 走网络优先：
 *     有网就一定拿最新文件，断网才用缓存。这样改完代码刷新就能看到，
 *     不再依赖「手改版本号」这种一定会忘的事。
 *   - 图标、manifest 这类几乎不变的资源走缓存优先，省一次请求。
 *
 * ⚠️ v1 是纯 cache-first + 手写版本号，结果版本号一直没升，改了文件刷新也看不到
 *    （SW 拦截后压根不走网络）。别改回 cache-first。
 *
 * ⚠️ 开发时想要「零缓存」，地址后面加 `?nosw`：main.js 会注销 SW 并清空所有缓存。
 */
const VERSION = 'v2';
const CACHE = `ximi-farm-${VERSION}`;

/** 安装时预缓存的核心资源（离线兜底用） */
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

/** 这些路径走网络优先 —— 改完立刻生效的那些 */
const NETWORK_FIRST = [
  /\/src\/.*\.js$/,
  /\/styles\/.*\.css$/,
  /\/vendor\/.*\.js$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 预缓存失败（比如某个图标改名了）不该让整个安装失败
      .then((cache) => cache.addAll(CORE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    /*
     * 有「非当前版本」的缓存 = 这次是从旧版升级上来的。
     *
     * 那种情况下页面里跑的还是旧代码 —— `clients.claim()` 只换掉「谁在处理请求」，
     * 换不掉已经加载的模块。旧版是 cache-first，光靠新 SW 接管，用户还得再刷一次
     * 才能看到新文件，所以这里主动让受控页面重载一次。
     *
     * 首次安装（只存在当前版本缓存）不刷：用户可能正在看启动动画，白闪一下没意义。
     */
    const upgraded = keys.some((key) => key !== CACHE);

    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();

    if (!upgraded) return;
    const pages = await self.clients.matchAll({ type: 'window' });
    for (const page of pages) {
      try {
        page.navigate(page.url);
      } catch {
        // 页面正在关闭 / 导航中，忽略
      }
    }
  })());
});

/**
 * 把成功的响应写回缓存。
 * `res.ok` 已经挡掉 4xx/5xx；跨域在 fetch 里就 return 了，这里不用再判。
 * @param {Request} request
 * @param {Response} res
 */
function putInCache(request, res) {
  if (!res || !res.ok) return;
  const clone = res.clone();
  caches.open(CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域请求（信令服务器等）不走缓存
  if (url.origin !== location.origin) return;

  const isDocument = request.mode === 'navigate'
    || url.pathname === '/'
    || url.pathname.endsWith('.html');

  // 缓存优先：图标、manifest 这类基本不变的
  if (!isDocument && !NETWORK_FIRST.some((re) => re.test(url.pathname))) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((res) => {
        putInCache(request, res);
        return res;
      })),
    );
    return;
  }

  // 网络优先：页面与代码，改了立刻生效
  event.respondWith(
    fetch(request)
      .then((res) => {
        putInCache(request, res);
        return res;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html'))),
  );
});
