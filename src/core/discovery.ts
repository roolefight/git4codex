import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { git } from './git';

const excluded = new Set(['.git', 'node_modules', 'vendor', 'dist', 'build', 'target', 'out', '.venv', 'venv', '.cache', '.next', '.nuxt', '.idea', '.runtime', '.test-repos', 'release']);

// Normal loading uses Git metadata. Walk only non-Git project containers (two
// levels), or explicitly requested deep searches. Never enumerate other worktrees.
export async function discoverRepositories(directories: string[], mode: 'quick' | 'deep' = 'quick') {
  const roots = new Map<string, string>();
  const visited = new Set<string>();
  const warnings = new Set<string>();
  const queue: { directory: string; depth: number }[] = [];
  const identity = (directory: string) => process.platform === 'win32' ? directory.toLowerCase() : directory;
  const limit = mode === 'deep' ? 2000 : 128;
  const depth = mode === 'deep' ? 6 : 2;
  async function addRepository(directory: string) {
    try {
      const root = await realpath((await git(directory, ['rev-parse', '--show-toplevel'])).trim());
      if (roots.size < 32) roots.set(identity(root), root);
      return root;
    } catch (error) {
      if (!/not a git repository/i.test(String(error))) warnings.add(`${directory}: ${String(error)}`);
      return undefined;
    }
  }
  for (const directory of directories) {
    if (!path.isAbsolute(directory)) throw new Error('工作区必须使用绝对路径');
    try {
      const canonical = await realpath(directory);
      const repository = await addRepository(canonical);
      if (!repository || mode === 'deep') queue.push({ directory: canonical, depth: 0 });
    } catch (error) { warnings.add(`${directory}: ${String(error)}`); }
  }
  for (let index = 0; index < queue.length; index++) {
    if (roots.size >= 32) { warnings.add('已加载 32 个仓库，可指定更小的项目目录继续加载。'); break; }
    const current = queue[index];
    if (visited.has(identity(current.directory))) continue;
    visited.add(identity(current.directory));
    try {
      if (current.depth > 0 && await lstat(path.join(current.directory, '.git')).catch(() => undefined)) {
        await addRepository(current.directory);
        if (mode === 'quick') continue;
      }
      if (current.depth >= depth) continue;
      const entries = await opendir(current.directory);
      for await (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || excluded.has(entry.name)) continue;
        if (queue.length >= limit) { warnings.add(`目录查找已达到 ${limit} 个目录上限，可指定更小的项目目录。`); break; }
        queue.push({ directory: path.join(current.directory, entry.name), depth: current.depth + 1 });
      }
    } catch (error) { warnings.add(`${current.directory}: ${String(error)}`); }
  }
  // Registered submodules come from metadata, including initialized nested ones.
  for (const root of roots.values()) {
    const modules = path.join(root, '.gitmodules');
    if (!(await lstat(modules).catch(() => undefined))?.isFile()) continue;
    try {
      const entries = await git(root, ['config', '--no-includes', '--null', '--file', modules, '--get-regexp', '^submodule[.].*[.]path$']).catch(error => {
        if (String(error).includes('Git 退出码 1')) return '';
        throw error;
      });
      for (const entry of entries.split('\0').filter(Boolean)) {
        if (roots.size >= 32) { warnings.add('已加载 32 个仓库，可指定更小的项目目录继续加载。'); break; }
        const candidate = path.resolve(root, entry.slice(entry.indexOf('\n') + 1));
        if (!candidate.startsWith(root + path.sep) || !(await lstat(path.join(candidate, '.git')).catch(() => undefined))) continue;
        const canonical = await realpath(candidate);
        if (canonical.startsWith(root + path.sep) && !roots.has(identity(canonical))) await addRepository(canonical);
      }
    } catch (error) { warnings.add(`${modules}: ${String(error)}`); }
  }
  return { repositories: [...roots.values()], warnings: [...warnings] };
}
