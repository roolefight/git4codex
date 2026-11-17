import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { requestSchema, splitPatch, type Request, type RepoState, type FileChange, type Commit, type WorktreeState } from '../shared/protocol';

export class WorkbenchError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export function git(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // stash internally constructs pathspecs for cleanup; a global literal flag breaks that cleanup on Git 2.48.
    const child = spawn('git', ['--no-pager', ...(args[0] === 'stash' ? [] : ['--literal-pathspecs']), '-c', 'core.quotepath=false', ...args], {
      cwd, shell: false, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => { failure = new WorkbenchError('TIMEOUT', 'Git 操作超时，请检查凭据、网络或 Git hooks。'); child.kill(); }, 120000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 12 * 1024 * 1024) { failure = new WorkbenchError('TOO_LARGE', '结果超过 12 MB，请缩小查看范围。'); child.kill(); }
      else out.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { if (Buffer.concat(err).length < 64000) err.push(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new WorkbenchError('GIT_ERROR', Buffer.concat(err).toString('utf8').trim() || `Git 退出码 ${code}`));
      resolve(Buffer.concat(out).toString('utf8'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const exists = (file: string) => stat(file).then(() => true, () => false);
const pathKey = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
interface Repository { root: string; gitDir: string; commonDir: string }

export function parseStatus(output: string): FileChange[] {
  const fields = output.split('\0');
  const files: FileChange[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const index = field[0];
    const worktree = field[1];
    files.push({ path: field.slice(3), index, worktree,
      oldPath: /[RC]/.test(index + worktree) ? fields[++i] : undefined,
      conflict: ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(index + worktree) });
  }
  return files;
}

export class GitService {
  private repositories = new Map<string, Repository>();
  private queues = new Map<string, Promise<unknown>>();

  async open(directory: string) {
    const canonical = await realpath(directory);
    const root = await realpath((await git(canonical, ['rev-parse', '--show-toplevel'])).trim());
    const [gitDir, commonDir] = await Promise.all([
      git(root, ['rev-parse', '--absolute-git-dir']),
      git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    const repo = hash(root).slice(0, 24);
    this.repositories.set(repo, { root, gitDir: gitDir.trim(), commonDir: pathKey(await realpath(commonDir.trim())) });
    return this.status(repo);
  }

  private repository(id: string) {
    const repo = this.repositories.get(id);
    if (!repo) throw new WorkbenchError('NOT_OPEN', '仓库未打开，请重新选择仓库。');
    return repo;
  }

  async status(id: string): Promise<RepoState> {
    const repo = this.repository(id);
    const [raw, head, symbolic, branchOutput, stashOutput, upstream, index] = await Promise.all([
      git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      git(repo.root, ['rev-parse', '--verify', 'HEAD']).catch(() => ''),
      git(repo.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => ''),
      git(repo.root, ['for-each-ref', '--format=%(refname)%00%(HEAD)%00%(objectname)%00%(upstream:remotename)%00%(upstream:remoteref)', 'refs/heads', 'refs/remotes']),
      git(repo.root, ['stash', 'list', '--format=%gd%x00%H%x00%s']),
      git(repo.root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(() => ''),
      readFile(path.join(repo.gitDir, 'index')).catch(() => Buffer.alloc(0)),
    ]);
    const files = parseStatus(raw);
    const stamps = await Promise.all(files.map(async file => {
      const info = await lstat(path.join(repo.root, file.path), { bigint: true }).catch(() => undefined);
      return `${file.path}:${info?.size}:${info?.mtimeNs}:${info?.ctimeNs}`;
    }));
    const counts = upstream ? (await git(repo.root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).trim().split(/\s+/).map(Number) : [0, 0];
    const operations = await Promise.all(['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'].map(async name => await exists(path.join(repo.gitDir, name)) ? name : ''));
    const currentRef = branchOutput.split('\n').map(line => line.split('\0')).find(fields => fields[1] === '*');
    const remoteTarget = currentRef?.[3] && currentRef[4] ? { remote: currentRef[3], ref: currentRef[4] } : undefined;
    // Hash destination configuration without exposing URLs or embedded credentials.
    const remoteConfig = remoteTarget ? await git(repo.root, ['remote', 'get-url', '--push', '--all', remoteTarget.remote]).catch(() => '') : '';
    return {
      repo: id, root: repo.root, name: path.basename(repo.root), head: head.trim(),
      branch: symbolic.trim() || `detached ${head.trim().slice(0, 8)}`,
      version: hash(raw + head + symbolic + branchOutput + stashOutput + upstream + remoteConfig + counts.join(',') + hash(index) + stamps.join('\0') + operations.join(',')), files,
      branches: branchOutput.trim().split('\n').filter(Boolean).map(line => {
        const [ref, current] = line.split('\0');
        return { name: ref.replace(/^refs\/(heads|remotes)\//, ''), current: current === '*', remote: ref.startsWith('refs/remotes/') };
      }),
      upstream: upstream.trim(), ahead: counts[0], behind: counts[1], operation: operations.filter(Boolean).join(', '),
      remoteTarget,
      stashes: stashOutput.trim().split('\n').filter(Boolean).map(line => { const [ref, hash, ...message] = line.split('\0'); return { ref, hash, message: message.join('\0') }; }),
    };
  }

  private checkPath(file: string) {
    if (!file || file.includes('\0') || path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..' || part.toLowerCase() === '.git')) {
      throw new WorkbenchError('INVALID_PATH', '文件路径必须位于当前仓库内。');
    }
  }

  private checkCommit(commit: string) {
    if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new WorkbenchError('INVALID_COMMIT', '需要完整的提交哈希。');
  }

  async diff(id: string, file: string, staged = false, commit?: string) {
    const repo = this.repository(id);
    this.checkPath(file);
    const state = await this.status(id);
    const change = state.files.find(item => item.path === file);
    const flags = ['--no-ext-diff', '--no-textconv', '--no-color', '--unified=3'];
    if (commit) {
      this.checkCommit(commit);
      const patch = await git(repo.root, ['show', '--format=', ...flags, commit, '--', file]);
      return { patch, binary: patch.includes('Binary files ') || patch.includes('GIT binary patch'), canHunk: false, version: state.version };
    }
    if (!change) return { patch: '', binary: false, canHunk: false, version: state.version };
    if (change.index === '?' && !staged) {
      const absolute = path.join(repo.root, file);
      const info = await lstat(absolute);
      if (!info.isFile() || info.size > 2 * 1024 * 1024) return { patch: '文件过大或不是普通文本文件，可按整个文件暂存。', binary: true, canHunk: false, version: state.version };
      const buffer = await readFile(absolute);
      if (buffer.includes(0)) return { patch: '二进制文件，可按整个文件暂存。', binary: true, canHunk: false, version: state.version };
      const content = buffer.toString('utf8');
      const lines = content.split('\n');
      if (lines.at(-1) === '') lines.pop();
      const patch = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map(line => `+${line}`).join('\n') + '\n';
      return { patch: content ? patch : '', binary: false, canHunk: false, version: state.version };
    }
    const patch = await git(repo.root, ['diff', ...flags, ...(staged ? ['--cached'] : []), '--', ...(change.oldPath ? [change.oldPath] : []), file]);
    const binary = patch.includes('Binary files ') || patch.includes('GIT binary patch');
    return { patch, binary, canHunk: !binary && !change.conflict && !change.oldPath && (staged ? change.index === 'M' : change.worktree === 'M'), version: state.version };
  }

  async history(id: string, skip: number, ref?: string): Promise<Commit[]> {
    const repo = this.repository(id);
    if (!(await this.status(id)).head) return [];
    if (ref && !/^refs\/(heads|remotes)\//.test(ref)) throw new WorkbenchError('INVALID_BRANCH', '请选择有效的本地或远端分支。');
    const revision = ref ? (await git(repo.root, ['show-ref', '--verify', '--hash', ref])).trim() : undefined;
    const output = await git(repo.root, ['log', ...(revision ? [revision] : ['--all']), '--topo-order', '-n', '100', `--skip=${skip}`, '--format=%H%x00%P%x00%s%x00%an%x00%aI%x00%D%x00', '--']);
    const parts = output.split('\0');
    const commits: Commit[] = [];
    for (let i = 0; i + 5 < parts.length; i += 6) commits.push({ hash: parts[i].trim(), parents: parts[i + 1].split(' ').filter(Boolean), subject: parts[i + 2], author: parts[i + 3], date: parts[i + 4], refs: parts[i + 5] });
    return commits;
  }

  async dispatch(raw: unknown): Promise<unknown> {
    const request = requestSchema.parse(raw);
    if (request.action === 'open') return this.open(request.path);
    if (request.action === 'status') return this.status(request.repo);
    if (request.action === 'worktrees') return this.worktrees(request.repo);
    if (request.action === 'diff') return this.diff(request.repo, request.path, request.staged, request.commit);
    if (request.action === 'history') return this.history(request.repo, request.skip, request.ref);
    if (request.action === 'commitFiles') {
      this.checkCommit(request.commit);
      return (await git(this.repository(request.repo).root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', request.commit])).split('\0').filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
    }
    const repo = this.repository(request.repo);
    const previous = this.queues.get(repo.commonDir) ?? Promise.resolve();
    const running = previous.catch(() => {}).then(async () => request.action === 'worktreeAdd' || request.action === 'worktreeRemove' ? this.mutateWorktree(request) : this.mutate(request));
    this.queues.set(repo.commonDir, running);
    try { return await running; }
    finally { if (this.queues.get(repo.commonDir) === running) this.queues.delete(repo.commonDir); }
  }

  async worktrees(id: string): Promise<WorktreeState> {
    const repo = this.repository(id);
    const output = await git(repo.root, ['worktree', 'list', '--porcelain', '-z']);
    const entries = output.split('\0\0').filter(Boolean).map((record, index) => {
      const fields = new Map(record.split('\0').filter(Boolean).map(field => {
        const space = field.indexOf(' ');
        return space < 0 ? [field, ''] : [field.slice(0, space), field.slice(space + 1)];
      }));
      const directory = fields.get('worktree')!;
      return { path: directory, head: fields.get('HEAD') || '', branch: (fields.get('branch') || '').replace(/^refs\/heads\//, ''), main: index === 0, current: pathKey(directory) === pathKey(repo.root), bare: fields.has('bare'), detached: fields.has('detached'), locked: fields.get('locked'), prunable: fields.get('prunable') };
    });
    return { version: hash(output), entries };
  }

  private async mutateWorktree(request: Extract<Request, { action: 'worktreeAdd' | 'worktreeRemove' }>) {
    const repo = this.repository(request.repo);
    const state = await this.worktrees(request.repo);
    if (state.version !== request.version) throw new WorkbenchError('STALE_STATE', 'Worktree 列表已经变化，请刷新后重新确认。');
    if (!path.isAbsolute(request.path) || request.path.includes('\0')) throw new WorkbenchError('INVALID_PATH', 'Worktree 需要绝对路径。');
    if (request.action === 'worktreeAdd') {
      await git(repo.root, ['check-ref-format', `refs/heads/${request.branch}`]);
      if (request.branch.startsWith('-')) throw new WorkbenchError('INVALID_BRANCH', '分支名无效。');
      const target = path.join(await realpath(path.dirname(request.path)), path.basename(request.path));
      const present = await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (present) throw new WorkbenchError('PATH_EXISTS', '目标目录已存在，请选择一个新目录。');
      if (!request.newBranch) await git(repo.root, ['show-ref', '--verify', `refs/heads/${request.branch}`]);
      await git(repo.root, ['worktree', 'add', ...(request.newBranch ? ['-b', request.branch] : []), '--', target, request.newBranch ? 'HEAD' : request.branch]);
    } else {
      const entry = state.entries.find(item => pathKey(item.path) === pathKey(request.path));
      if (!entry) throw new WorkbenchError('NOT_FOUND', '只能移除此仓库已登记的 Worktree。');
      if (entry.main || entry.current || entry.bare || entry.detached || entry.locked !== undefined || entry.prunable !== undefined) throw new WorkbenchError('PROTECTED_WORKTREE', '主目录、当前目录、detached HEAD、已锁定或失效的 Worktree 不能在此移除。请先为 detached HEAD 保存分支。');
      const target = await realpath(entry.path);
      if (pathKey(target) !== pathKey(entry.path) || state.entries.some(item => pathKey(item.path).startsWith(pathKey(target) + path.sep))) throw new WorkbenchError('INVALID_PATH', 'Worktree 路径已重定向或包含其他 Worktree，已停止移除。');
      const targetState = await this.open(target);
      if (targetState.operation || await git(target, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored'])) throw new WorkbenchError('DIRTY_WORKTREE', 'Worktree 有改动、未跟踪/忽略的文件或正在进行的 Git 操作，请先处理后再移除。');
      await git(repo.root, ['worktree', 'remove', '--', target]);
      this.repositories.delete(targetState.repo);
    }
    return this.worktrees(request.repo);
  }

  private async mutate(request: Exclude<Extract<Request, { version: string }>, { action: 'worktreeAdd' | 'worktreeRemove' }>) {
    const repo = this.repository(request.repo);
    const state = await this.status(request.repo);
    if (state.version !== request.version) throw new WorkbenchError('STALE_STATE', '仓库已经变化。已停止操作，请刷新后重试。');
    if (request.action === 'stage') {
      request.paths.forEach(file => {
        this.checkPath(file);
        if (!state.files.some(item => item.path === file)) throw new WorkbenchError('INVALID_PATH', '只能操作当前改动列表中的文件。');
      });
      const paths = [...new Set(request.paths.flatMap(file => { const item = state.files.find(item => item.path === file)!; return item.oldPath ? [item.oldPath, file] : [file]; }))];
      if (!request.unstage) await git(repo.root, ['add', '--', ...paths]);
      else if (state.head) await git(repo.root, ['restore', '--staged', '--', ...paths]);
      else await git(repo.root, ['rm', '--cached', '--', ...paths]);
    }
    if (request.action === 'hunk') {
      const diff = await this.diff(request.repo, request.path, request.unstage);
      if (diff.version !== request.version) throw new WorkbenchError('STALE_STATE', '文件已经变化，请刷新 Diff。');
      const parsed = splitPatch(diff.patch);
      const hunk = parsed.hunks[request.index];
      if (!diff.canHunk || !hunk) throw new WorkbenchError('INVALID_HUNK', '此文件不支持按块操作，请按整个文件处理。');
      const patch = parsed.prefix + hunk.header + '\n' + hunk.lines.join('\n') + '\n';
      await git(repo.root, ['apply', '--cached', ...(request.unstage ? ['--reverse'] : []), '--whitespace=nowarn', '-'], patch);
    }
    if (request.action === 'commit') {
      if (state.files.some(item => item.conflict)) throw new WorkbenchError('CONFLICT', '请先解决所有冲突并暂存。');
      if (state.operation) throw new WorkbenchError('IN_PROGRESS', `仓库正在进行 ${state.operation}，请在原工具完成或中止操作。`);
      if (!state.files.some(item => item.index !== ' ' && item.index !== '?')) throw new WorkbenchError('EMPTY_INDEX', '没有已暂存的改动。');
      await git(repo.root, ['commit', '--file=-'], request.message);
    }
    if (request.action === 'branch') {
      await git(repo.root, ['check-ref-format', `refs/heads/${request.name}`]).catch(() => { throw new WorkbenchError('INVALID_BRANCH', '分支名无效。'); });
      if (request.name.startsWith('-')) throw new WorkbenchError('INVALID_BRANCH', '分支名无效。');
      if (state.operation) throw new WorkbenchError('IN_PROGRESS', '请先完成正在进行的 Git 操作。');
      if (!request.create && !state.branches.some(branch => !branch.remote && branch.name === request.name)) throw new WorkbenchError('INVALID_BRANCH', '只能切换到已存在的本地分支。');
      await git(repo.root, ['switch', '--no-guess', '--no-overwrite-ignore', '--no-recurse-submodules', ...(request.create ? ['-c', request.name] : ['--', request.name])]);
    }
    if (request.action === 'remote') {
      if (state.operation) throw new WorkbenchError('IN_PROGRESS', '请先完成正在进行的 Git 操作。');
      if (request.operation === 'fetch') await git(repo.root, ['fetch', '--all', '--prune', '--no-prune-tags', '--no-recurse-submodules']);
      else {
        const target = state.remoteTarget;
        if (!target || target.remote === '.' || target.remote.startsWith('-') || !target.ref.startsWith('refs/heads/')) throw new WorkbenchError('NO_UPSTREAM', '请先为当前本地分支配置远端跟踪分支。');
        if (request.operation === 'pull') {
          if (state.files.length) throw new WorkbenchError('DIRTY_WORKTREE', 'Pull 前请先提交或手动保存本地改动。不会自动 Stash。');
          await git(repo.root, ['pull', '--ff-only', '--no-rebase', '--no-autostash', '--no-overwrite-ignore', '--no-recurse-submodules', '--', target.remote, target.ref]);
        } else {
          const destinations = (await git(repo.root, ['remote', 'get-url', '--push', '--all', target.remote])).trim().split('\n');
          if (destinations.length !== 1) throw new WorkbenchError('MULTIPLE_TARGETS', '此远端配置了多个推送地址，请在终端中明确选择目标。');
          await git(repo.root, ['-c', `remote.${target.remote}.mirror=false`, 'push', '--porcelain', '--no-force', '--no-follow-tags', '--recurse-submodules=no', '--', target.remote, `${state.head}:${target.ref}`]);
        }
      }
    }
    if (request.action === 'stash') {
      if (state.operation) throw new WorkbenchError('IN_PROGRESS', '请先完成正在进行的 Git 操作。');
      if (request.operation === 'save') await git(repo.root, ['stash', 'push', '-u', '-m', request.message || 'Git Workbench']);
      else {
        const entry = state.stashes[request.index ?? -1];
        if (!entry) throw new WorkbenchError('NOT_FOUND', 'Stash 已不存在，请刷新。');
        await git(repo.root, ['stash', request.operation, request.operation === 'apply' ? entry.hash : entry.ref]);
      }
    }
    return this.status(request.repo);
  }
}
