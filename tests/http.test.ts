import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchServer } from '../src/server/http';
import path from 'node:path';

test('HTTP API requires authentication, rejects foreign origins and validates requests', async t => {
  const { server, token } = createWorkbenchServer(path.resolve('dist/ui'));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${url}/api/health`)).status, 401);
  assert.equal((await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await fetch(`${url}/api/health`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await fetch(`${url}/api/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'shell', command: 'anything' }) })).status, 400);
  assert.equal((await fetch(`${url}/api/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', repo: 'not-registered' }) })).status, 400);
});
