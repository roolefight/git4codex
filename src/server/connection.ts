import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Request } from '../shared/protocol';

export const stateDirectory = () => process.env.GIT_WORKBENCH_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'state'), 'git-workbench', 'v3');
export interface Connection { url: string; token: string; pid: number; protocol: number }

export async function getConnection(): Promise<Connection | undefined> {
  try {
    const info: Connection = JSON.parse(await readFile(path.join(stateDirectory(), 'connection.json'), 'utf8'));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(info.url) || info.protocol !== 3) return undefined;
    const response = await fetch(`${info.url}/api/health`, { headers: { Authorization: `Bearer ${info.token}` }, signal: AbortSignal.timeout(1000) });
    if (!response.ok || (await response.json()).name !== 'git-workbench') return undefined;
    return info;
  } catch { return undefined; }
}

export async function ensureService(directory = path.dirname(process.argv[1])) {
  const current = await getConnection();
  if (current) return current;
  await mkdir(stateDirectory(), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [path.join(directory, 'server.cjs')], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
  child.unref();
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (launchError) throw launchError;
    await new Promise(resolve => setTimeout(resolve, 100));
    const connection = await getConnection();
    if (connection) return connection;
  }
  throw new Error(`Git 服务启动失败。请运行 node dist/server.cjs 查看原因，或检查 ${process.env.GIT_WORKBENCH_PORT || 47833} 端口。`);
}

export async function rpc(connection: Connection, request: Request): Promise<unknown> {
  const response = await fetch(`${connection.url}/api/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(130000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data.result;
}

export function workbenchUrl(connection: Connection, repository?: string) {
  const url = new URL(connection.url);
  if (repository) url.searchParams.set('repo', repository);
  url.hash = new URLSearchParams({ token: connection.token }).toString();
  return url.href;
}
