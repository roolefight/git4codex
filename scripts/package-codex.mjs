import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const root = path.resolve(`release/git-workbench-codex-${pkg.version}`);
if (!root.startsWith(path.resolve('release') + path.sep)) throw new Error('Invalid release path');
await rm(root, { recursive: true, force: true });
const plugin = path.join(root, 'plugins/git-workbench');
await mkdir(path.join(plugin, 'runtime'), { recursive: true });
await cp('adapters/codex', plugin, { recursive: true });
await cp('LICENSE', path.join(root, 'LICENSE'));
await cp('LICENSE', path.join(plugin, 'LICENSE'));
// panel.html is a sandboxed MCP resource, not a standalone HTTP page.
for (const file of ['mcp.cjs', 'server.cjs', 'panel.html']) await cp(path.join('dist', file), path.join(plugin, 'runtime', file));
await cp('docs/codex.md', path.join(root, 'README.md'));
await cp('docs/codex.md', path.join(plugin, 'README.md'));
await cp('docs/git-safety-review.md', path.join(root, 'git-safety-review.md'));
await cp('docs/git-safety-review.md', path.join(plugin, 'git-safety-review.md'));
await mkdir(path.join(root, '.agents/plugins'), { recursive: true });
await writeFile(path.join(root, '.agents/plugins/marketplace.json'), JSON.stringify({
  name: 'git-workbench-local', interface: { displayName: 'Git Workbench Local' },
  plugins: [{ name: 'git-workbench', source: { source: 'local', path: './plugins/git-workbench' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Developer Tools' }],
}, null, 2));
const licenses = new Set();
async function collect(name) {
  if (licenses.has(name)) return;
  licenses.add(name);
  const metadata = JSON.parse(await readFile(path.join('node_modules', name, 'package.json'), 'utf8'));
  await Promise.all(Object.keys(metadata.dependencies ?? {}).map(collect));
}
await collect('@modelcontextprotocol/sdk');
await collect('zod');
await collect('@modelcontextprotocol/ext-apps');
await collect('@openai/mcp-extensions');
await collect('@radix-ui/react-icons');
await collect('react-dom');
await collect('react');
await collect('lowlight');
await mkdir(path.join(plugin, 'licenses'), { recursive: true });
for (const name of licenses) {
  const directory = path.join('node_modules', name);
  const metadata = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const license = (await readdir(directory)).find(file => /^licen[sc]e(?:\..*)?$/i.test(file));
  const text = license ? await readFile(path.join(directory, license), 'utf8') : `Upstream package license: ${metadata.license}`;
  await writeFile(path.join(plugin, 'licenses', name.replaceAll('/', '__') + '.txt'), `${name} ${metadata.version}\n${text}`);
}
const archive = {};
async function addFiles(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) await addFiles(absolute);
    else archive[path.relative(path.dirname(root), absolute).replaceAll('\\', '/')] = await readFile(absolute);
  }
}
await addFiles(root);
await writeFile(root + '.zip', zipSync(archive));
console.log(`Codex plugin ready: ${root}`);
