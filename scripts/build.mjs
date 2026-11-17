import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
const codexOnly = process.argv.includes('--codex');
await viteBuild();
await build({ entryPoints: { server: 'src/server/main.ts', cli: 'src/cli.ts', mcp: 'src/mcp.ts' }, outdir: 'dist', bundle: true, platform: 'node', format: 'cjs', target: 'node22', outExtension: { '.js': '.cjs' } });
const stylesheet = (await readdir('dist/ui/assets')).find(file => file.endsWith('.css'));
if (!stylesheet) throw new Error('Missing workbench stylesheet');
const stylesheetText = await readFile(`dist/ui/assets/${stylesheet}`, 'utf8');
const panel = await build({ entryPoints: ['src/codex/panel.tsx'], bundle: true, platform: 'browser', format: 'iife', target: 'es2022', jsx: 'automatic', write: false, minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
await writeFile('dist/panel.html', `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Git Workbench</title><style>${stylesheetText.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div><script>${panel.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
if (codexOnly) { console.log('Built Codex MCP panel, tools and local Git service.'); process.exit(0); }
await build({ entryPoints: ['adapters/deepseek/host.ts'], outfile: 'dist/dsh-host.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools'] });
const css = stylesheetText.replaceAll(':root', ':host');
const client = await build({ entryPoints: ['adapters/deepseek/client.tsx'], bundle: true, platform: 'browser', format: 'cjs', target: 'es2022', external: ['react', 'react-dom'], jsx: 'automatic', write: false, plugins: [{ name: 'workbench-css', setup(build) {
  build.onResolve({ filter: /^workbench:css$/ }, () => ({ path: 'css', namespace: 'workbench' }));
  build.onLoad({ filter: /.*/, namespace: 'workbench' }, () => ({ contents: css, loader: 'text' }));
} }] });
await writeFile('dist/dsh-client.js', `window.__ModuleLoader__.load({id: 'dsh-plugin-git-workbench', factory: function(require) { const module = {exports: {}}; const exports = module.exports;\n${client.outputFiles[0].text}\nreturn module.exports; }});\n`);
console.log('Built UI, local service, MCP adapter and DSH adapter.');
