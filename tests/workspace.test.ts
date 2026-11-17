import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { git, GitService } from '../src/core/git';
import { discoverRepositories } from '../src/core/discovery';
import { registerPanel } from '../src/mcp-panel';
import type { PanelData } from '../src/codex/protocol';

test('project discovery includes nested repositories and gitfile worktrees without traversing dependencies or junctions', async t => {
  const base = path.resolve('.test-repos'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'workspace-'));
  t.after(async () => { if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup'); await rm(root, { recursive: true, force: true }); });
  const project = path.join(root, 'project');
  const app = path.join(project, 'app');
  const library = path.join(app, 'packages', 'library');
  const api = path.join(project, 'services', 'api');
  const outside = path.join(root, 'other-chat');
  for (const directory of [app, library, api, outside, path.join(project, 'node_modules', 'dependency')]) {
    await mkdir(directory, { recursive: true }); await git(directory, ['init', '-b', 'main']);
  }
  await git(app, ['config', 'user.name', 'Workspace Test']);
  await git(app, ['config', 'user.email', 'workspace@example.invalid']);
  await writeFile(path.join(app, 'README.md'), 'test fixture\n');
  await git(app, ['add', 'README.md']); await git(app, ['commit', '-m', 'baseline']);
  const worktree = path.join(project, 'worktree');
  await git(app, ['worktree', 'add', '-b', 'chat-worktree', worktree]);
  const outsideWorktree = path.join(root, 'other-worktree');
  await git(app, ['worktree', 'add', '-b', 'other-chat', outsideWorktree]);
  await symlink(outside, path.join(project, 'linked-outside'), process.platform === 'win32' ? 'junction' : 'dir');
  const found = await discoverRepositories([project]);
  assert.deepEqual(found.repositories.sort(), [app, api, worktree].sort());
  assert.deepEqual(found.warnings, []);
  assert.deepEqual((await discoverRepositories([project], 'deep')).repositories.sort(), [app, library, api, worktree].sort());
  const overlapping = await discoverRepositories([app, path.join(app, 'packages'), app], 'deep');
  assert.deepEqual(overlapping.repositories.sort(), [app, library].sort());
  const linked = await discoverRepositories([worktree]);
  assert.deepEqual(linked.repositories, [worktree], 'A chat worktree must not be replaced with the main checkout');
  const missing = await discoverRepositories([path.join(root, 'missing')]);
  assert.equal(missing.repositories.length, 0); assert.equal(missing.warnings.length, 1);

  // Two concurrent host connections must resolve their own roots, not global recent state.
  const service = new GitService();
  async function connect(paths?: string[]) {
    const server = new McpServer({ name: 'workspace-test', version: '1' });
    registerPanel(server, directory => service.open(directory), '<!doctype html><title>Workspace test</title>');
    const client = new Client({ name: 'chat', version: '1' }, { capabilities: paths ? { roots: { listChanged: true } } : {} });
    if (paths) client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: paths.map(directory => ({ uri: pathToFileURL(directory).href })) }));
    const [host, transport] = InMemoryTransport.createLinkedPair();
    await server.connect(transport); await client.connect(host);
    t.after(async () => { await client.close(); await server.close(); });
    return client;
  }
  const currentRoots = [project];
  const chatA = await connect(currentRoots);
  const chatB = await connect([outsideWorktree]);
  const noRoots = await connect();
  const read = async (client: Client, directory?: string) => (await client.callTool({ name: 'git_workbench_workspace', arguments: directory ? { path: directory } : {} })).structuredContent as unknown as PanelData;
  const [a, b] = await Promise.all([read(chatA), read(chatB)]);
  assert.equal(a.repositories.length, 3); assert.equal(a.source, 'mcp-roots');
  assert.equal(b.repositories.length, 1); assert.equal(b.state?.root, outsideWorktree); assert.equal(b.state.branch, 'other-chat');
  const empty = await read(noRoots);
  assert.equal(empty.source, 'unavailable'); assert.deepEqual(empty.repositories, []); assert.deepEqual(empty.roots, []);
  const explicit = await read(noRoots, project);
  assert.equal(explicit.repositories.length, 3); assert.equal(explicit.source, 'explicit');
  const multiple = (await noRoots.callTool({ name: 'git_workbench_workspace', arguments: { paths: [project, outside, project] } })).structuredContent as unknown as PanelData;
  assert.equal(multiple.repositories.length, 4);
  assert.equal(multiple.roots.length, 2);
  assert.equal(multiple.source, 'explicit');
  assert.deepEqual((await read(noRoots)).repositories, [], 'No-root calls never reuse the last explicit workspace');
  currentRoots.splice(0, currentRoots.length, worktree);
  const moved = await read(chatA);
  assert.equal(moved.repositories.length, 1); assert.equal(moved.state?.root, worktree);
  const stateA = a.repositories.find(repo => repo.root === api)!;
  const stateB = b.state!;
  await writeFile(path.join(api, 'only-a.txt'), 'one repository only\n');
  const refreshed = await service.status(stateA.repo);
  await service.dispatch({ action: 'stage', repo: stateA.repo, version: refreshed.version, paths: ['only-a.txt'] });
  assert.equal((await service.status(stateB.repo)).files.length, 0, 'Staging in repository A must not touch repository B');
  // A known Git root must not traverse its unrelated nested repositories.
  assert.deepEqual((await discoverRepositories([app])).repositories, [app]);
  await writeFile(path.join(app, '.gitmodules'), '[submodule "library"]\n\tpath = packages/library\n\turl = https://example.invalid/library\n');
  assert.deepEqual((await discoverRepositories([app])).repositories.sort(), [app, library].sort(), 'Registered submodules are loaded from metadata without crawling');
});
