/**
 * 零依赖静态服务器（仅开发用）。
 * 项目的代码是原生 ESM，必须经由 http(s) 加载，file:// 下会被 CORS 拦住。
 *
 *   node server.mjs                 http://localhost:5173
 *   node server.mjs 8080            指定端口
 *   node server.mjs 5173 --https    走 https（局域网联机必须）
 *
 * 为什么联机要 https：浏览器只在「安全上下文」里提供 `crypto.subtle`，
 * 而联机库拿它做房间密钥派生。`http://192.168.x.x` 下那是 undefined，
 * 连房间的第一步就会抛错。localhost 天生算安全上下文，所以本机双窗口不用 https。
 *
 * 证书是自签的，首次访问浏览器会拦一次，点「继续前往」即可 ——
 * 换 IP 或换机器后 SAN 对不上也会再拦一次，这是自签证书的固定代价。
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(ROOT, 'certs');

const args = process.argv.slice(2);
const USE_HTTPS = args.includes('--https');
const PORT = Number(args.find((a) => /^\d+$/.test(a))) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 本机的局域网 IPv4，证书 SAN 里要把它们逐个写上 */
function lanAddresses() {
  const list = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family === 'IPv4' && !info.internal) list.push(info.address);
    }
  }
  return list;
}

/**
 * 自签证书。缺失、或本机 IP 变了（换网络后 SAN 对不上）都重新生成一次。
 * 生成失败时抛错，让调用方退回 http 并给出可读的提示。
 */
function ensureCert() {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const keyPath = path.join(CERT_DIR, 'lan-key.pem');
  const certPath = path.join(CERT_DIR, 'lan-cert.pem');
  const metaPath = path.join(CERT_DIR, 'meta.json');
  const ips = lanAddresses();

  const fresh = fs.existsSync(keyPath) && fs.existsSync(certPath) && fs.existsSync(metaPath)
    && JSON.stringify(JSON.parse(fs.readFileSync(metaPath, 'utf8')).ips) === JSON.stringify(ips);
  if (!fresh) {
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', keyPath, '-out', certPath,
      '-days', '825',
      '-subj', '/CN=sun-farm.local',
      '-addext', `subjectAltName=${san}`,
    ], { stdio: 'pipe' });
    fs.writeFileSync(metaPath, JSON.stringify({ ips, at: Date.now() }, null, 2));
    console.log(`已生成自签证书（SAN: ${san}）`);
  }

  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

const handler = (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  // 目录穿越防护
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(buf);
  });
};

let server;
if (USE_HTTPS) {
  try {
    server = https.createServer(ensureCert(), handler);
  } catch (error) {
    console.error('证书生成失败，先改用 http 启动。');
    console.error('可以装一个 openssl（Git for Windows 自带），再带 --https 启动。');
    console.error(String(error.message || error));
    server = http.createServer(handler);
  }
} else {
  server = http.createServer(handler);
}

server.listen(PORT, () => {
  const scheme = server instanceof https.Server ? 'https' : 'http';
  console.log(`阳光牧场已启动： ${scheme}://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  同一局域网： ${scheme}://${ip}:${PORT}`);
  if (scheme === 'https') console.log('  自签证书首次访问会被拦一次，点「继续前往」即可。');
});
