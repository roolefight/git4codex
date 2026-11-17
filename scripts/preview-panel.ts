import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { PanelData } from '../src/codex/protocol';

const repository = (await readFile('.runtime/demo-path.txt', 'utf8')).trim();
if (!path.resolve(repository).startsWith(path.resolve('.test-repos') + path.sep)) throw new Error('Preview is restricted to the generated demo repository');
const runtime = path.resolve('.runtime/panel-preview');
await mkdir(runtime, { recursive: true });
const client = new Client({ name: 'panel-preview', version: '1' });
const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.resolve('dist/mcp.cjs')], env: { ...env, GIT_WORKBENCH_HOME: runtime, GIT_WORKBENCH_PORT: '47842' }, stderr: 'inherit' }));
const initial = await client.callTool({ name: 'git_workbench_panel', arguments: { path: repository } });
const data = (await client.callTool({ name: 'git_workbench_workspace', arguments: { path: repository } })).structuredContent as unknown as PanelData;
if (!data.state) throw new Error(data.error || 'No demo repository');
const allowedRepos = new Set(data.repositories.map(repo => repo.repo));
const withinDemo = (directory: string) => { const relative = path.relative(path.resolve(repository), path.resolve(directory)); return !relative.startsWith('..') && !path.isAbsolute(relative); };
const resource = (await client.readResource({ uri: 'ui://git-workbench/panel.html' })).contents[0];
if (!('text' in resource)) throw new Error('No panel HTML');
const host = await build({ entryPoints: ['tests/panel-host.ts'], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false });
const origin = 'http://127.0.0.1:47841';
const server = createServer(async (req, res) => {
  const send = (code: number, type: string, body: string) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (req.headers.host !== '127.0.0.1:47841' || req.headers.origin && req.headers.origin !== origin) return send(403, 'text/plain', 'Forbidden');
  try {
    if (req.method === 'GET' && req.url === '/') return send(200, 'text/html; charset=utf-8', '<!doctype html><html><head><title>MCP App protocol test host</title><style>html,body{height:100%;margin:0;background:#18191c;color:#ddd;font:12px Segoe UI}body{display:flex;flex-direction:column}header{height:32px;display:flex;align-items:center;gap:10px;padding:0 10px}header span{flex:1}iframe{flex:1;border:0;min-height:0}</style></head><body><header><span id="host-status">Connecting test host…</span><button id="dark">Dark</button><button id="light">Light</button><button id="narrow">440px</button><button id="wide">Full width</button></header><iframe title="Git Workbench MCP App" sandbox="allow-scripts"></iframe><script type="module" src="/host.js"></script></body></html>');
    if (req.method === 'GET' && req.url === '/host.js') return send(200, 'text/javascript', host.outputFiles[0].text);
    if (req.method === 'GET' && req.url === '/panel') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");
      return send(200, 'text/html; charset=utf-8', await readFile('dist/panel.html', 'utf8'));
    }
    if (req.method === 'GET' && req.url === '/initial') return send(200, 'application/json', JSON.stringify(initial));
    if (req.method !== 'POST' || req.url !== '/tool' || !req.headers['content-type']?.startsWith('application/json')) return send(404, 'text/plain', 'Not found');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Body too large'); chunks.push(Buffer.from(chunk)); }
    const args = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!/^git_workbench_(workspace|open|status|diff|history|commitFiles|stage|hunk|commit|branch|stash|worktrees|worktreeAdd|worktreeRemove)$/.test(args.name)) throw new Error('Tool not permitted in test host');
    const allowed = args.name === 'git_workbench_workspace' || args.name === 'git_workbench_open' ? (args.arguments.paths ?? [args.arguments.path]).every(withinDemo) : allowedRepos.has(args.arguments.repo) && (!args.arguments.path || !args.name.startsWith('git_workbench_worktree') || withinDemo(args.arguments.path));
    if (!allowed) throw new Error('Only the demo project is permitted');
    if (args.name === 'git_workbench_workspace' && process.env.GIT_WORKBENCH_PREVIEW_DELAY_MS) await new Promise(resolve => setTimeout(resolve, Number(process.env.GIT_WORKBENCH_PREVIEW_DELAY_MS)));
    const result = await client.callTool(args);
    if (args.name === 'git_workbench_workspace') (result.structuredContent as unknown as PanelData)?.repositories.forEach(repo => allowedRepos.add(repo.repo));
    if (args.name === 'git_workbench_open' && !result.isError) {
      const content = result.content as { type: string; text: string }[];
      allowedRepos.add(JSON.parse(content[0].text).state.repo);
    }
    return send(200, 'application/json', JSON.stringify(result));
  } catch (error) { send(400, 'text/plain; charset=utf-8', String(error)); }
});
server.listen(47841, '127.0.0.1', () => console.log(`MCP App protocol test host: ${origin}`));
async function close() {
  server.close(); await client.close();
  const info = JSON.parse(await readFile(path.join(runtime, 'connection.json'), 'utf8'));
  if (info.url === 'http://127.0.0.1:47842') { try { process.kill(info.pid); } catch {} }
}
process.on('SIGINT', () => { void close(); });
process.on('SIGTERM', () => { void close(); });
