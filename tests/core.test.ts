import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { GitService, git, WorkbenchError } from '../src/core/git';
import { splitPatch, type RepoState } from '../src/shared/protocol';

const base = path.resolve('.test-repos');
async function fixture(t: { after: (fn: () => Promise<void>) => void }, initial = true) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'core-'));
  t.after(async () => { if (!root.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup'); await rm(root, { recursive: true, force: true }); });
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Workbench Test']);
  await git(root, ['config', 'user.email', 'workbench@example.invalid']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  if (initial) {
    await writeFile(path.join(root, 'sample.txt'), Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    await git(root, ['add', '.']); await git(root, ['commit', '-m', 'initial']);
  }
  const service = new GitService();
  const state = await service.open(root);
  return { root, service, state, fresh: () => service.status(state.repo) };
}

test('partial staging and commit preserve unrelated unstaged changes', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'sample.txt');
  await writeFile(file, (await readFile(file, 'utf8')).replace('line 2\n', 'change A\n').replace('line 35\n', 'change B\n'));
  const diff = await f.service.diff(f.state.repo, 'sample.txt');
  assert.equal(splitPatch(diff.patch).hunks.length, 2);
  assert.equal(diff.canHunk, true);
  const staged = await f.service.dispatch({ action: 'hunk', repo: f.state.repo, version: diff.version, path: 'sample.txt', index: 0 }) as RepoState;
  const index = await git(f.root, ['show', ':sample.txt']);
  assert.match(index, /change A/); assert.doesNotMatch(index, /change B/);
  await f.service.dispatch({ action: 'commit', repo: staged.repo, version: staged.version, message: 'first hunk only' });
  assert.match(await git(f.root, ['show', 'HEAD:sample.txt']), /change A/);
  assert.doesNotMatch(await git(f.root, ['show', 'HEAD:sample.txt']), /change B/);
  assert.match(await readFile(file, 'utf8'), /change B/);
  assert.equal((await f.fresh()).files.length, 1);
});

test('unstage a selected hunk while preserving working file', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'sample.txt'), 'replacement\n');
  const state = await f.fresh();
  await f.service.dispatch({ action: 'stage', repo: state.repo, version: state.version, paths: ['sample.txt'] });
  const diff = await f.service.diff(state.repo, 'sample.txt', true);
  await f.service.dispatch({ action: 'hunk', repo: state.repo, version: diff.version, path: 'sample.txt', index: 0, unstage: true });
  assert.equal(await git(f.root, ['diff', '--cached']), '');
  assert.equal(await readFile(path.join(f.root, 'sample.txt'), 'utf8'), 'replacement\n');
});

test('unborn repository can stage, unstage and create first commit', async t => {
  const f = await fixture(t, false);
  await writeFile(path.join(f.root, '新文件 [1].txt'), 'hello\n');
  const state = await f.fresh();
  const staged = await f.service.dispatch({ action: 'stage', repo: state.repo, version: state.version, paths: ['新文件 [1].txt'] }) as RepoState;
  const unstaged = await f.service.dispatch({ action: 'stage', repo: state.repo, version: staged.version, paths: ['新文件 [1].txt'], unstage: true }) as RepoState;
  assert.equal(unstaged.files[0].index, '?');
  assert.equal(await readFile(path.join(f.root, '新文件 [1].txt'), 'utf8'), 'hello\n');
  const next = await f.service.dispatch({ action: 'stage', repo: state.repo, version: unstaged.version, paths: ['新文件 [1].txt'] }) as RepoState;
  const committed = await f.service.dispatch({ action: 'commit', repo: state.repo, version: next.version, message: 'first' }) as RepoState;
  assert.equal(committed.files.length, 0); assert.equal(committed.head.length, 40);
});

test('renames and deletion stage/unstage as complete changes', async t => {
  const f = await fixture(t);
  await rename(path.join(f.root, 'sample.txt'), path.join(f.root, 'renamed.txt'));
  const state = await f.fresh();
  const staged = await f.service.dispatch({ action: 'stage', repo: state.repo, version: state.version, paths: state.files.map(item => item.path) }) as RepoState;
  assert.equal(staged.files[0].oldPath, 'sample.txt');
  const diff = await f.service.diff(state.repo, 'renamed.txt', true);
  assert.equal(diff.canHunk, false);
  await f.service.dispatch({ action: 'stage', repo: state.repo, version: staged.version, paths: ['renamed.txt'], unstage: true });
  assert.equal(await git(f.root, ['diff', '--cached']), '');
});

test('binary file is identified and can be staged', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  const diff = await f.service.diff(f.state.repo, 'binary.dat');
  assert.equal(diff.binary, true); assert.equal(diff.canHunk, false);
  await f.service.dispatch({ action: 'stage', repo: f.state.repo, version: diff.version, paths: ['binary.dat'] });
  assert.equal((await f.fresh()).files[0].index, 'A');
});

test('literal paths cannot expand glob or escape the repository', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '[a].txt'), 'one');
  await writeFile(path.join(f.root, 'a.txt'), 'two');
  const state = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'stage', repo: state.repo, version: state.version, paths: ['../escape'] }), /文件路径/);
  await assert.rejects(f.service.diff(state.repo, '.git/config'), /文件路径/);
  await f.service.dispatch({ action: 'stage', repo: state.repo, version: state.version, paths: ['[a].txt'] });
  assert.equal((await f.fresh()).files.find(item => item.path === 'a.txt')?.index, '?');
});

test('external edits invalidate stale operations', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'sample.txt'), 'one');
  const stale = await f.fresh();
  await writeFile(path.join(f.root, 'sample.txt'), 'new external edit');
  await assert.rejects(f.service.dispatch({ action: 'stage', repo: stale.repo, version: stale.version, paths: ['sample.txt'] }), (error: unknown) => error instanceof WorkbenchError && error.code === 'STALE_STATE');
  assert.equal(await git(f.root, ['diff', '--cached']), '');
});

test('two clients with one snapshot cannot both write', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'sample.txt'), 'new');
  const state = await f.fresh();
  const request = { action: 'stage', repo: state.repo, version: state.version, paths: ['sample.txt'] };
  const results = await Promise.allSettled([f.service.dispatch(request), f.service.dispatch(request)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
});

test('branch, history and historical diff use real commits', async t => {
  const f = await fixture(t);
  const branch = await f.service.dispatch({ action: 'branch', repo: f.state.repo, version: f.state.version, name: 'feature/test', create: true }) as RepoState;
  assert.equal(branch.branch, 'feature/test');
  assert.notEqual(branch.version, f.state.version);
  const commits = await f.service.history(branch.repo, 0);
  assert.equal(commits[0].subject, 'initial');
  const files = await f.service.dispatch({ action: 'commitFiles', repo: branch.repo, commit: commits[0].hash });
  assert.deepEqual(files, ['sample.txt']);
  assert.match((await f.service.diff(branch.repo, 'sample.txt', false, commits[0].hash)).patch, /line 1/);
});

test('stash includes untracked files, applies without dropping, and detects external stash changes', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'new.txt'), 'kept');
  const state = await f.fresh();
  const saved = await f.service.dispatch({ action: 'stash', repo: state.repo, version: state.version, operation: 'save' }) as RepoState;
  assert.equal(saved.files.length, 0); assert.equal(saved.stashes.length, 1);
  const applied = await f.service.dispatch({ action: 'stash', repo: saved.repo, version: saved.version, operation: 'apply', index: 0 }) as RepoState;
  assert.equal(applied.stashes.length, 1); assert.equal(await readFile(path.join(f.root, 'new.txt'), 'utf8'), 'kept');
  await git(f.root, ['stash', 'push', '-u', '-m', 'outside']);
  await assert.rejects(f.service.dispatch({ action: 'stash', repo: saved.repo, version: saved.version, operation: 'drop', index: 0 }), /仓库已经变化/);
});

test('linked worktree has its own root and index', async t => {
  const f = await fixture(t);
  const linked = path.join(f.root, 'linked');
  await git(f.root, ['worktree', 'add', '-b', 'linked-test', linked]);
  const state = await f.service.open(linked);
  assert.notEqual(state.repo, f.state.repo); assert.equal(state.branch, 'linked-test');
  await writeFile(path.join(linked, 'sample.txt'), 'worktree only');
  const current = await f.service.status(state.repo);
  await f.service.dispatch({ action: 'stage', repo: state.repo, version: current.version, paths: ['sample.txt'] });
  assert.match(await git(linked, ['show', ':sample.txt']), /worktree only/);
  assert.doesNotMatch(await git(f.root, ['show', ':sample.txt']), /worktree only/);
});
