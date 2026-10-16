#!/usr/bin/env node
/**
 * 零依赖本地静态服务器（ES Module 必须经 HTTP 协议加载，不能直接双击 index.html）
 *
 * 用法：
 *   node tools/serve.mjs            # 默认 5173 端口
 *   node tools/serve.mjs 8080       # 指定端口
 *
 * 启动后：
 *   本机访问     http://localhost:5173
 *   同一局域网   http://<你的内网IP>:5173
 *
 * 注意：浏览器只在「安全上下文」（localhost 或 HTTPS）下允许调用摄像头，
 *       通过内网 IP 用 http 打开时，扫码功能会自动降级为「从图片识别」。
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2]) || Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    return send(res, 400, 'Bad Request');
  }

  if (pathname === '/') pathname = '/index.html';

  // 防目录穿越
  const target = path.resolve(root, '.' + pathname);
  if (target !== root && !target.startsWith(root + path.sep)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(target, (err, stat) => {
    if (err || !stat.isFile()) {
      return send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(target).pipe(res);
  });
});

function localAddresses() {
  const list = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) list.push(net.address);
    });
  });
  return list;
}

server.listen(port, '0.0.0.0', () => {
  console.log('');
  console.log('  局域网聊天室 · 本地服务已启动');
  console.log('  ────────────────────────────────────────────');
  console.log(`  本机     http://localhost:${port}`);
  localAddresses().forEach((ip) => {
    console.log(`  局域网   http://${ip}:${port}`);
  });
  console.log('  ────────────────────────────────────────────');
  console.log('  提示：摄像头扫码仅在 localhost 或 HTTPS 下可用；');
  console.log('       用局域网 IP 打开时会自动降级为「从图片识别」。');
  console.log('  按 Ctrl + C 停止');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已被占用，换一个端口试试：node tools/serve.mjs ${port + 1}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
