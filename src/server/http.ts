import { createServer, type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { GitService, WorkbenchError } from '../core/git';

export function createWorkbenchServer(uiDirectory: string, token = randomBytes(32).toString('hex')) {
  const git = new GitService();
  const server = createServer(async (req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    const host = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403, { error: 'Host rejected' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return send(403, { error: 'Origin rejected' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self' http://127.0.0.1:* http://localhost:*");
    try {
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: '连接凭据无效，请从插件重新打开工作台。', code: 'UNAUTHORIZED' });
        if (url.pathname === '/api/health' && req.method === 'GET') return send(200, { name: 'git-workbench', version: '0.6.0', protocol: 3 });
        if (url.pathname !== '/api/rpc' || req.method !== 'POST') return send(404, { error: 'Not found' });
        if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'Expected JSON' });
        const body = await readBody(req);
        return send(200, { result: await git.dispatch(JSON.parse(body)) });
      }
      if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const target = path.resolve(uiDirectory, relative);
      if (!target.startsWith(path.resolve(uiDirectory) + path.sep)) return send(403, { error: 'Forbidden' });
      if (!(await stat(target).catch(() => undefined))?.isFile()) return send(404, { error: 'Not found' });
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
      res.writeHead(200, { 'Content-Type': types[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(await readFile(target));
    } catch (error) {
      send(error instanceof WorkbenchError && error.code === 'STALE_STATE' ? 409 : 400, { error: error instanceof Error ? error.message : '操作失败', code: error instanceof WorkbenchError ? error.code : 'INVALID_REQUEST' });
    }
  });
  server.requestTimeout = 130000;
  return { server, token, git };
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('请求体过大。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
