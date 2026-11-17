import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createWorkbenchServer } from './http';
import { stateDirectory } from './connection';

const directory = stateDirectory();
const { server, token } = createWorkbenchServer(path.join(path.dirname(process.argv[1]), 'ui'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(Number(process.env.GIT_WORKBENCH_PORT || 47833), '127.0.0.1', async () => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No server address');
  const info = { url: `http://127.0.0.1:${address.port}`, token, pid: process.pid, protocol: 3 };
  const temporary = path.join(directory, `connection-${process.pid}.json`);
  await writeFile(temporary, JSON.stringify(info), { mode: 0o600 });
  await rename(temporary, path.join(directory, 'connection.json'));
  console.error(`Git Workbench listening at ${info.url}`);
});
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
