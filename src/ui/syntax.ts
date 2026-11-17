import { common, createLowlight } from 'lowlight';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import powershell from 'highlight.js/lib/languages/powershell';
import type { RootContent } from 'hast';

const highlighter = createLowlight({ ...common, dockerfile, powershell });
const extensions: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml', css: 'css', scss: 'scss', less: 'less', json: 'json', jsonc: 'json',
  java: 'java', kt: 'kotlin', kts: 'kotlin', py: 'python', pyw: 'python', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', cs: 'csharp',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', psm1: 'powershell', sql: 'sql', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', properties: 'ini',
  md: 'markdown', markdown: 'markdown', rb: 'ruby', php: 'php', swift: 'swift', m: 'objectivec', lua: 'lua', r: 'r', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff',
};
export function languageForFile(file: string) {
  const name = file.replace(/\\/g, '/').split('/').at(-1)!.toLowerCase();
  return name === 'dockerfile' || name.startsWith('dockerfile.') ? 'dockerfile' : ['makefile', 'gnumakefile'].includes(name) ? 'makefile' : name === 'gemfile' ? 'ruby' : name === '.env' || name.startsWith('.env.') ? 'ini' : extensions[name.split('.').at(-1)!];
}
export interface SyntaxToken { text: string; className: string }
export function highlightLines(file: string, lines: string[]): SyntaxToken[][] {
  const language = languageForFile(file);
  // Diff can contain minified/generated files. Keep rendering bounded and avoid
  // expensive automatic language detection; unknown types remain plain text.
  if (!language || lines.reduce((size, line) => size + line.length, 0) > 200000 || lines.some(line => line.length > 10000)) return lines.map(text => [{ text, className: '' }]);
  const output: SyntaxToken[][] = [[]];
  const visit = (nodes: RootContent[], classes: string[]) => nodes.forEach(node => {
    if (node.type === 'text') node.value.split('\n').forEach((text, index) => { if (index) output.push([]); if (text) output.at(-1)!.push({ text, className: classes.join(' ') }); });
    if (node.type === 'element') visit(node.children, [...classes, ...(Array.isArray(node.properties.className) ? node.properties.className.map(String) : [])]);
  });
  visit(highlighter.highlight(language, lines.join('\n')).children, []);
  return output;
}
