import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { git } from '../src/core/git';

const project = path.resolve('.test-repos', `multi-repo-demo-${Date.now()}`);
for (const name of ['frontend', 'backend']) {
  const root = path.join(project, name);
  await mkdir(root, { recursive: true });
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.name', 'Panel Test']);
  await git(root, ['config', 'user.email', 'panel@example.invalid']);
  await git(root, ['config', 'core.autocrlf', 'false']);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n\nOriginal content.\n`);
  await writeFile(path.join(root, 'context.ts'), '// Project context\nexport interface Project {\n  id: string;\n  name: string;\n}\n\nexport function label(project: Project): string {\n  return project.name;\n}\n');
  await writeFile(path.join(root, 'config.json'), '{\n  "name": "Git Workbench",\n  "enabled": false\n}\n');
  await git(root, ['add', '.']); await git(root, ['commit', '-m', `Initialize ${name}`]);
  for (const branch of ['dev', 'release/0.5', 'release/0.6', 'feature/branch-tree', 'feature/syntax-highlighting', 'backup/before-update', 'codex/worktree-support', 'codex/loading-progress', 'codex/git-safety']) await git(root, ['branch', branch]);
  await git(root, ['update-ref', 'refs/remotes/origin/main', 'HEAD']); await git(root, ['update-ref', 'refs/remotes/origin/dev', 'HEAD']);
  await writeFile(path.join(root, 'README.md'), `# ${name}\n\nChanges in ${name} only.\n`);
  await writeFile(path.join(root, 'context.ts'), '// Project context\nexport interface Project {\n  id: string;\n  name: string;\n  branch?: string;\n}\n\nexport function label(project: Project): string {\n  const branch = project.branch ?? "main";\n  return `${project.name} · ${branch}`;\n}\n');
  await writeFile(path.join(root, 'config.json'), '{\n  "name": "Git Workbench",\n  "enabled": true\n}\n');
}
await mkdir('.runtime', { recursive: true });
await writeFile('.runtime/demo-path.txt', project);
console.log(project);
