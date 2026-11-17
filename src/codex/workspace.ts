import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { CodexProject } from './protocol';

// Codex Desktop supplies these keys in mcpServer/tool/call metadata.
// Read only this thread's cwd; never inspect messages or choose a recent thread.
export async function resolveThreadWorkspace(meta?: Record<string, unknown>, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')) {
  const threadId = meta?.thread_id ?? meta?.threadId;
  if (threadId === undefined) return undefined;
  if (typeof threadId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(threadId)) throw new Error('Codex 会话标识无效，已停止自动选择项目。');
  if (meta?.thread_id !== undefined && meta?.threadId !== undefined && meta.thread_id !== meta.threadId) throw new Error('Codex 会话标识不一致，已停止自动选择项目。');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path.join(codexHome, 'state_5.sqlite'), { readOnly: true });
  try {
    const row = database.prepare('SELECT cwd FROM threads WHERE id = ?').get(threadId);
    // Unsent chats use a shared ephemeral MCP host thread without a project.
    // Never substitute the globally selected project for this missing context.
    if (!row) return undefined;
    if (typeof row?.cwd !== 'string' || !path.isAbsolute(row.cwd)) throw new Error('未找到此 Codex 会话的工作目录，请刷新会话后重试。');
    // Windows stores extended-length paths; present ordinary absolute paths to Git/UI.
    return process.platform === 'win32' ? row.cwd.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '') : row.cwd;
  } finally { database.close(); }
}

export async function listCodexProjects(codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')): Promise<CodexProject[]> {
  const raw = await readFile(path.join(codexHome, '.codex-global-state.json'), 'utf8').catch(() => undefined);
  if (!raw) return [];
  const state = JSON.parse(raw) as Record<string, unknown>;
  const projects = state['local-projects'];
  if (!projects || typeof projects !== 'object') return [];
  return Object.values(projects).flatMap((project: unknown) => {
    if (!project || typeof project !== 'object' || !('id' in project) || typeof project.id !== 'string' || !('name' in project) || typeof project.name !== 'string' || !('rootPaths' in project) || !Array.isArray(project.rootPaths)) return [];
    const paths = project.rootPaths.filter((value): value is string => typeof value === 'string' && path.isAbsolute(value));
    return paths.length ? [{ id: project.id, name: project.name, paths }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}
