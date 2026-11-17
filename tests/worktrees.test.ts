import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git, GitService, WorkbenchError } from '../src/core/git';
import type { WorktreeState } from '../src/shared/protocol';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = path.resolve('.test-repos');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'worktrees-'));
  t.after(async () => { if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }); });
  const main = path.join(root, 'main');
  await mkdir(main);
  await git(main, ['init', '-b', 'main']);
  await git(main, ['config', 'user.name', 'Worktree Test']);
  await git(main, ['config', 'user.email', 'test@example.invalid']);
  await git(main, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(main, 'file.txt'), 'baseline\n');
  await writeFile(path.join(main, '.gitignore'), 'ignored.tmp\n');
  await git(main, ['add', '.']); await git(main, ['commit', '-m', 'baseline']);
  const service = new GitService();
  const state = await service.open(main);
  const list = () => service.worktrees(state.repo);
  const add = async (directory: string, branch: string, newBranch = true) => service.dispatch({ action: 'worktreeAdd', repo: state.repo, version: (await list()).version, path: directory, branch, newBranch }) as Promise<WorktreeState>;
  const remove = async (directory: string) => service.dispatch({ action: 'worktreeRemove', repo: state.repo, version: (await list()).version, path: directory });
  return { root, main, service, state, list, add, remove };
}
const code = (expected: string) => (error: unknown) => error instanceof WorkbenchError && error.code === expected;

test('worktrees create/open/switch view/remove preserve branches and independent files', async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, '任务 with spaces');
  const before = await f.list();
  assert.equal(before.entries[0].main, true); assert.equal(before.entries[0].current, true);
  await writeFile(path.join(f.main, 'file.txt'), 'main draft\n');
  const created = await f.add(directory, 'feature/task');
  assert.equal(created.entries.length, 2);
  const linked = await f.service.open(directory);
  assert.equal(linked.branch, 'feature/task'); assert.equal(linked.files.length, 0);
  assert.equal((await f.service.worktrees(linked.repo)).entries.find(entry => entry.current)?.branch, 'feature/task');
  assert.equal((await f.service.status(f.state.repo)).branch, 'main');
  assert.equal(await readFile(path.join(f.main, 'file.txt'), 'utf8'), 'main draft\n');
  assert.equal(await readFile(path.join(directory, 'file.txt'), 'utf8'), 'baseline\n');
  await assert.rejects(f.service.dispatch({ action: 'worktreeRemove', repo: linked.repo, version: (await f.service.worktrees(linked.repo)).version, path: directory }), code('PROTECTED_WORKTREE'));
  await assert.rejects(f.remove(f.main), code('PROTECTED_WORKTREE'));
  await assert.rejects(f.service.dispatch({ action: 'worktreeRemove', repo: f.state.repo, version: before.version, path: directory }), code('STALE_STATE'));
  await f.remove(directory);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  assert.ok((await git(f.main, ['show-ref', '--verify', 'refs/heads/feature/task'])).trim());
  await f.add(directory, 'feature/task', false);
  assert.equal((await f.list()).entries.length, 2);
});

test('worktree removal refuses changed, untracked, ignored, locked and foreign targets', async t => {
  const f = await fixture(t);
  const directory = path.join(f.root, 'linked');
  await f.add(directory, 'feature/guard');
  for (const filename of ['file.txt', 'untracked.txt', 'ignored.tmp']) {
    await writeFile(path.join(directory, filename), 'keep this content\n');
    await assert.rejects(f.remove(directory), code('DIRTY_WORKTREE'));
    assert.equal(await readFile(path.join(directory, filename), 'utf8'), 'keep this content\n');
    if (filename === 'file.txt') await git(directory, ['restore', '--', filename]);
    else await rm(path.join(directory, filename));
  }
  await git(f.main, ['worktree', 'lock', '--reason', 'keep offline', directory]);
  assert.equal((await f.list()).entries[1].locked, 'keep offline');
  await assert.rejects(f.remove(directory), code('PROTECTED_WORKTREE'));
  await git(f.main, ['worktree', 'unlock', directory]);
  const foreign = path.join(f.root, 'foreign'); await mkdir(foreign); await writeFile(path.join(foreign, 'keep'), 'safe');
  await assert.rejects(f.remove(foreign), code('NOT_FOUND'));
  assert.equal(await readFile(path.join(foreign, 'keep'), 'utf8'), 'safe');
  await assert.rejects(f.add(foreign, 'feature/no-overwrite'), code('PATH_EXISTS'));
  await assert.rejects(f.add(path.join(f.root, 'another'), 'main', false), code('GIT_ERROR'));
  await f.remove(directory);
});

test('linked worktrees share the mutation queue and reject stale topology', async t => {
  const f = await fixture(t);
  const linkedPath = path.join(f.root, 'linked'); await f.add(linkedPath, 'linked');
  const linked = await f.service.open(linkedPath);
  const version = (await f.list()).version;
  const results = await Promise.allSettled([
    f.service.dispatch({ action: 'worktreeAdd', repo: f.state.repo, version, path: path.join(f.root, 'first'), branch: 'first', newBranch: true }),
    f.service.dispatch({ action: 'worktreeAdd', repo: linked.repo, version, path: path.join(f.root, 'second'), branch: 'second', newBranch: true }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.ok(rejected?.status === 'rejected' && code('STALE_STATE')(rejected.reason));
  const detached = path.join(f.root, 'detached');
  await git(f.main, ['worktree', 'add', '--detach', detached]);
  assert.equal((await f.list()).entries.find(entry => path.resolve(entry.path) === detached)?.detached, true);
});
