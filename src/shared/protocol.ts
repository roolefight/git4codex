import { z } from 'zod';

export const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), path: z.string().min(1) }),
  z.object({ action: z.literal('status'), repo: z.string() }),
  z.object({ action: z.literal('worktrees'), repo: z.string() }),
  z.object({ action: z.literal('worktreeAdd'), repo: z.string(), version: z.string(), path: z.string().min(1), branch: z.string().min(1), newBranch: z.boolean() }),
  z.object({ action: z.literal('worktreeRemove'), repo: z.string(), version: z.string(), path: z.string().min(1) }),
  z.object({ action: z.literal('diff'), repo: z.string(), path: z.string(), staged: z.boolean().default(false), commit: z.string().optional() }),
  z.object({ action: z.literal('history'), repo: z.string(), skip: z.number().int().min(0).default(0), ref: z.string().optional() }),
  z.object({ action: z.literal('commitFiles'), repo: z.string(), commit: z.string() }),
  z.object({ action: z.literal('stage'), repo: z.string(), version: z.string(), paths: z.array(z.string()).min(1), unstage: z.boolean().default(false) }),
  z.object({ action: z.literal('hunk'), repo: z.string(), version: z.string(), path: z.string(), index: z.number().int().min(0), unstage: z.boolean().default(false) }),
  z.object({ action: z.literal('commit'), repo: z.string(), version: z.string(), message: z.string().trim().min(1).max(10000) }),
  z.object({ action: z.literal('branch'), repo: z.string(), version: z.string(), name: z.string().min(1), create: z.boolean().default(false) }),
  z.object({ action: z.literal('remote'), repo: z.string(), version: z.string(), operation: z.enum(['fetch', 'pull', 'push']) }),
  z.object({ action: z.literal('stash'), repo: z.string(), version: z.string(), operation: z.enum(['save', 'apply', 'drop']), index: z.number().int().min(0).optional(), message: z.string().max(500).optional() })
]);
export type Request = z.infer<typeof requestSchema>;
export interface Worktree { path: string; head: string; branch: string; main: boolean; current: boolean; bare: boolean; detached: boolean; locked?: string; prunable?: string }
export interface WorktreeState { version: string; entries: Worktree[] }
export interface FileChange { path: string; oldPath?: string; index: string; worktree: string; conflict: boolean }
export interface Branch { name: string; current: boolean; remote: boolean }
export interface RepoState { repo: string; root: string; name: string; branch: string; head: string; version: string; files: FileChange[]; branches: Branch[]; upstream: string; ahead: number; behind: number; stashes: { ref: string; hash: string; message: string }[]; operation: string; remoteTarget?: { remote: string; ref: string } }
export interface Commit { hash: string; parents: string[]; subject: string; author: string; date: string; refs: string }
export interface DiffResult { patch: string; binary: boolean; canHunk: boolean; version: string }
export interface DiffHunk { header: string; lines: string[] }
export function splitPatch(patch: string) {
  const lines = patch.split('\n');
  const start = lines.findIndex(line => line.startsWith('@@ '));
  if (start < 0) return { prefix: patch, hunks: [] as DiffHunk[] };
  const hunks: DiffHunk[] = [];
  for (const line of lines.slice(start)) {
    if (line.startsWith('@@ ')) hunks.push({ header: line, lines: [] });
    else hunks.at(-1)!.lines.push(line);
  }
  if (hunks.at(-1)?.lines.at(-1) === '') hunks.at(-1)!.lines.pop();
  return { prefix: lines.slice(0, start).join('\n') + '\n', hunks };
}
