import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService, git } from '../src/core/git';

async function fixture(t: TestContext) {
  const base = path.resolve('.test-repos'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'safety-'));
  t.after(async () => { if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }); });
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Safety Test']); await git(root, ['config', 'user.email', 'safety@example.invalid']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(root, 'file.txt'), 'baseline\n'); await git(root, ['add', '.']); await git(root, ['commit', '-m', 'baseline']);
  const service = new GitService(); const state = await service.open(root);
  return { root, service, state, fresh: () => service.status(state.repo) };
}

test('checkout refuses ignored-file collisions and stale branch tips without changing files', async t => {
  const f = await fixture(t);
  await git(f.root, ['switch', '-c', 'target']);
  await writeFile(path.join(f.root, 'ignored.txt'), 'tracked on target\n'); await git(f.root, ['add', '.']); await git(f.root, ['commit', '-m', 'target']);
  await git(f.root, ['switch', 'main']);
  await writeFile(path.join(f.root, '.gitignore'), 'ignored.txt\n');
  await writeFile(path.join(f.root, 'ignored.txt'), 'local ignored data\n');
  const state = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'branch', repo: state.repo, version: state.version, name: 'target', create: false }), /overwritten|untracked/i);
  assert.equal(await readFile(path.join(f.root, 'ignored.txt'), 'utf8'), 'local ignored data\n');
  assert.equal((await f.fresh()).branch, 'main');
  assert.equal((await f.fresh()).stashes.length, 0);
  const tree = (await git(f.root, ['rev-parse', 'HEAD^{tree}'])).trim();
  const tip = (await git(f.root, ['commit-tree', tree, '-p', state.head], 'target moved\n')).trim();
  await git(f.root, ['update-ref', 'refs/heads/target', tip]);
  assert.equal((await f.service.history(state.repo, 0, 'refs/heads/target'))[0].subject, 'target moved');
  assert.equal((await f.service.history(state.repo, 0, 'refs/heads/main'))[0].subject, 'baseline');
  await assert.rejects(f.service.dispatch({ action: 'branch', repo: state.repo, version: state.version, name: 'target', create: false }), /仓库已经变化/);
  const fresh = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'branch', repo: state.repo, version: fresh.version, name: '@{-1}', create: false }), /invalid|无效/i);
});

test('replacing a stash with the same label still invalidates a pending deletion', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'file.txt'), 'first saved draft\n'); await git(f.root, ['stash', 'push', '-m', 'same']);
  const first = (await git(f.root, ['rev-parse', 'refs/stash'])).trim();
  await writeFile(path.join(f.root, 'file.txt'), 'second saved draft\n'); await git(f.root, ['stash', 'push', '-m', 'same']);
  const second = (await git(f.root, ['rev-parse', 'refs/stash'])).trim();
  await git(f.root, ['stash', 'drop', 'stash@{0}']);
  const snapshot = await f.fresh();
  const label = await git(f.root, ['stash', 'list', '--format=%gd%x00%s']);
  await git(f.root, ['reflog', 'expire', '--expire=all', 'refs/stash']);
  await git(f.root, ['update-ref', '--create-reflog', '-m', 'On main: same', 'refs/stash', second, first]);
  assert.equal(await git(f.root, ['stash', 'list', '--format=%gd%x00%s']), label, 'The old label-only check cannot distinguish these stashes');
  await assert.rejects(f.service.dispatch({ action: 'stash', repo: snapshot.repo, version: snapshot.version, operation: 'drop', index: 0 }), /仓库已经变化/);
  assert.equal((await f.fresh()).stashes[0].hash, second);
});

test('push pins one branch despite mirror/force/matching settings; rejects divergence; pull preserves dirty work', async t => {
  const f = await fixture(t);
  const remote = path.join(f.root, '.git', 'test-remote.git');
  await git(f.root, ['init', '--bare', remote]);
  await git(f.root, ['remote', 'add', 'origin', remote]); await git(f.root, ['push', '-u', 'origin', 'main']);
  await git(f.root, ['branch', 'other']); await git(f.root, ['push', 'origin', 'other']);
  const baseline = f.state.head;
  await writeFile(path.join(f.root, 'file.txt'), 'local commit\n'); await git(f.root, ['add', '.']); await git(f.root, ['commit', '-m', 'local']);
  await git(f.root, ['branch', '-f', 'other', 'HEAD']); await git(f.root, ['tag', '-a', 'private-tag', '-m', 'not requested']);
  await git(f.root, ['config', 'push.default', 'matching']);
  await git(f.root, ['config', 'remote.origin.push', '+refs/heads/*:refs/heads/*']);
  await git(f.root, ['config', 'remote.origin.mirror', 'true']); await git(f.root, ['config', 'push.followTags', 'true']);
  const state = await f.fresh();
  await f.service.dispatch({ action: 'remote', repo: state.repo, version: state.version, operation: 'push' });
  assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), state.head);
  assert.equal((await git(remote, ['rev-parse', 'refs/heads/other'])).trim(), baseline);
  await assert.rejects(git(remote, ['show-ref', '--verify', 'refs/tags/private-tag']));
  const tree = (await git(remote, ['rev-parse', `${baseline}^{tree}`])).trim();
  const remoteTip = (await git(remote, ['-c', 'user.name=Remote Test', '-c', 'user.email=remote@example.invalid', 'commit-tree', tree, '-p', baseline], 'remote divergence\n')).trim();
  await git(remote, ['update-ref', 'refs/heads/main', remoteTip]);
  const fresh = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'remote', repo: fresh.repo, version: fresh.version, operation: 'push' }), /rejected|non-fast-forward|fetch first/i);
  assert.equal((await git(remote, ['rev-parse', 'refs/heads/main'])).trim(), remoteTip);
  await git(f.root, ['config', 'pull.rebase', 'true']); await git(f.root, ['config', 'rebase.autoStash', 'true']);
  await writeFile(path.join(f.root, 'file.txt'), 'unsaved local draft\n');
  const dirty = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'remote', repo: dirty.repo, version: dirty.version, operation: 'pull' }), /本地改动/);
  assert.equal(await readFile(path.join(f.root, 'file.txt'), 'utf8'), 'unsaved local draft\n');
  assert.equal((await f.fresh()).stashes.length, 0);
  await git(f.root, ['restore', '--', 'file.txt']);
  const clean = await f.fresh();
  await assert.rejects(f.service.dispatch({ action: 'remote', repo: clean.repo, version: clean.version, operation: 'pull' }), /fast-forward|diverg/i);
  assert.equal((await f.fresh()).head, state.head);
});

test('detached worktrees cannot be removed before their commits have a branch', async t => {
  const f = await fixture(t);
  const target = path.join(f.root, '.git', 'detached-task');
  await git(f.root, ['worktree', 'add', '--detach', target, 'HEAD']);
  const snapshot = await f.service.worktrees(f.state.repo);
  await assert.rejects(f.service.dispatch({ action: 'worktreeRemove', repo: f.state.repo, version: snapshot.version, path: target }), /detached HEAD/);
  assert.equal(await readFile(path.join(target, 'file.txt'), 'utf8'), 'baseline\n');
});
