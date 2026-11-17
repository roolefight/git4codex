import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('a running plugin serves the same panel after its old cache is removed by an upgrade', async t => {
  const base = path.resolve('.test-repos');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'resource-upgrade-'));
  const cached = path.join(root, 'old-plugin', 'runtime');
  await mkdir(cached, { recursive: true });
  const source = path.resolve(process.env.GIT_WORKBENCH_MCP_ENTRY ?? 'dist/mcp.cjs');
  await cp(source, path.join(cached, 'mcp.cjs'));
  await cp(path.join(path.dirname(source), 'panel.html'), path.join(cached, 'panel.html'));
  const expected = await readFile(path.join(cached, 'panel.html'), 'utf8');
  const client = new Client({ name: 'resource-upgrade-test', version: '1' });
  t.after(async () => {
    await client.close();
    if (!root.startsWith(base + path.sep)) throw new Error('Unsafe cleanup');
    await rm(root, { recursive: true, force: true });
  });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(cached, 'mcp.cjs')], stderr: 'pipe' }));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'git_workbench_panel'));
  // Remove the resource before the first read, reproducing the native Codex failure.
  await rm(path.join(cached, 'panel.html'));
  const first = (await client.readResource({ uri: 'ui://git-workbench/panel.html' })).contents[0];
  assert.ok('text' in first); assert.equal(first.text, expected);
  // A second read is also required when Codex retries or reopens the sidebar.
  const second = (await client.readResource({ uri: 'ui://git-workbench/panel.html' })).contents[0];
  assert.deepEqual(second, first);
});
