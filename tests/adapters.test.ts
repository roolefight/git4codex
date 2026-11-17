import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { RpcHandler, PanelProps } from '../adapters/deepseek/contracts';

test('built DSH host registers its tool through official defineTool', () => {
  const require = createRequire(import.meta.url);
  const adapter = require('../dist/dsh-host.cjs') as { apply: (ctx: Context) => void };
  const registered: ToolDefinition[] = [];
  const channels: string[] = [];
  adapter.apply({ inject: (_keys: string[], run: (ctx: unknown) => void) => run({ connection: { rpc: { handle: (channel: string) => channels.push(channel) } } }), tools: { register: (tool: ToolDefinition) => { registered.push(tool); return () => {}; } } } as unknown as Context);
  assert.deepEqual(channels, ['/git-workbench']);
  assert.equal(registered.length, 2);
  assert.equal(registered[0].name, 'git_workbench_open');
  assert.equal(typeof registered[0].execute, 'function');
});

test('DSH client bundle uses lazy module registration and cleans up its tab and slot', async () => {
  type Adapter = { apply: (ctx: Record<string, unknown>) => void };
  let registration: { id: string; factory: (require: NodeJS.Require) => Adapter } | undefined;
  vm.runInNewContext(await readFile('dist/dsh-client.js', 'utf8'), { window: { __ModuleLoader__: { load: (value: typeof registration) => { registration = value; } } } });
  assert.ok(registration); assert.equal(registration.id, 'dsh-plugin-git-workbench');
  const adapter = registration.factory(createRequire(import.meta.url));
  const effects: (() => void)[] = [];
  const registrations: string[] = [];
  let request: PanelProps['request'] | undefined;
  const calls: unknown[] = [];
  adapter.apply({
    connection: { rpc: { call: async (...args: unknown[]) => { calls.push(args); return { ok: true, value: { repo: 'host-repo' } }; } } },
    effect: (run: () => () => void) => effects.push(run()),
    sidebarRightTabs: { register: (definition: { id: string }) => { registrations.push(definition.id); return () => { registrations.splice(registrations.indexOf(definition.id), 1); }; } },
    slots: {
      inject: (_name: string, callback: () => () => void) => callback(),
      register: (entry: { key: string; inject: (sessionId: string) => Pick<PanelProps, 'request'> }, component: unknown) => { assert.equal(typeof component, 'function'); request = entry.inject('session-a').request; registrations.push(entry.key); return () => { registrations.splice(registrations.indexOf(entry.key), 1); }; },
    },
  });
  assert.equal(registrations.length, 2);
  assert.ok(request);
  const signal = new AbortController().signal;
  assert.deepEqual(await request({ action: 'status', repo: 'host-repo' }, signal), { repo: 'host-repo' });
  assert.deepEqual(calls[0], ['/git-workbench', 'request', { action: 'status', repo: 'host-repo' }, signal]);
  effects.reverse().forEach(effect => effect());
  assert.equal(registrations.length, 0);
});

test('DSH host rejects non-owner peers, invalid endpoints, invalid requests and cancelled calls', async () => {
  const adapter = createRequire(import.meta.url)('../dist/dsh-host.cjs') as { createHandler: () => RpcHandler };
  const handler = adapter.createHandler();
  const signal = new AbortController().signal;
  const peer = { principal: { kind: 'owner' }, signal };
  const denied = await handler('request', { action: 'open', path: '.' }, signal, { ...peer, principal: { kind: 'guest' } });
  assert.equal(denied.ok, false);
  assert.equal((await handler('unknown', {}, signal, peer)).ok, false);
  assert.equal((await handler('request', { action: 'invalid' }, signal, peer)).ok, false);
  assert.equal((await handler('request', { action: 'open', path: '.' }, AbortSignal.abort(), peer)).ok, false);
});
