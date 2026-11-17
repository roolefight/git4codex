import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { ensureService, rpc } from './server/connection';
import { requestSchema, splitPatch, type DiffResult, type RepoState } from './shared/protocol';
import { registerPanel } from './mcp-panel';
import { listCodexProjects, resolveThreadWorkspace } from './codex/workspace';

const server = new McpServer({ name: 'git-workbench', version: '0.6.0' });
const opened = new Map<string, string>();
async function openRepository(directory: string) {
  const state = await rpc(await ensureService(), { action: 'open', path: directory }) as RepoState;
  opened.set(state.repo, state.root);
  return state;
}
// Codex can keep this process alive after an upgrade removes its versioned cache.
registerPanel(server, openRepository, readFileSync(path.join(path.dirname(process.argv[1]), 'panel.html'), 'utf8'), resolveThreadWorkspace, listCodexProjects);
server.registerTool('git_workbench_open', {
  title: '打开当前工作区的 Git 仓库',
  description: 'Select the current Codex chat workspace/worktree by its absolute path. Returns repository identity, branch, staged/unstaged files and version directly in this conversation. Preserve the chat worktree; do not substitute the main checkout. Does not launch a browser or change files.',
  inputSchema: { path: z.string().min(1).refine(value => path.isAbsolute(value), 'Use an absolute workspace path').describe('Current chat workspace/worktree absolute path, or another repository explicitly chosen by the user') },
  annotations: { readOnlyHint: true, openWorldHint: false },
}, async args => {
  try {
    const state = await openRepository(args.path);
    return { content: [{ type: 'text', text: JSON.stringify({ state }) }] };
  } catch (error) { return { isError: true, content: [{ type: 'text', text: String(error) }] }; }
});

const descriptions = {
  worktrees: 'List the current repository main and linked worktrees, branches, lock/prune state and a topology version. Does not scan unrelated projects.',
  worktreeAdd: 'Create a worktree in a new absolute directory. newBranch=true creates branch from current HEAD; false uses an existing local branch. Uses the version from worktrees, not status. Never forces or resets a branch. Open the returned path with git_workbench_open to manage it.',
  worktreeRemove: 'Remove a registered clean linked worktree directory, retaining its branch. Refuses main/current/locked worktrees, dirty, untracked and ignored files. Uses the version from worktrees. Requires explicit confirmation of the full target path; never forces removal.',
  status: 'Read fresh branch, staged/unstaged files, stashes and repository version. Use immediately before writes. File paths are relative to root.',
  diff: 'Review one file. staged=false compares index to worktree; staged=true compares HEAD to index. Optional commit selects a historical full commit hash and is read-only. Returns patch, explicit zero-based hunk indices and the version required for staging that exact diff.',
  history: 'Read up to 100 commits across all branches in topological order, including parents, refs, author and date. skip paginates.',
  commitFiles: 'List changed files for a full commit hash obtained from history. Use diff with commit for historical review.',
  stage: 'Stage only the listed changed files, or set unstage=true to remove them from the index while preserving working files. Never stage unrelated work automatically.',
  hunk: 'Stage one zero-based hunk returned by the latest diff, or unstage=true to reverse a staged hunk. Use that diff version; never reconstruct the patch or guess the index. Only ordinary tracked text modifications support hunks.',
  commit: 'Commit ONLY the current staged index with the supplied message. Read the staged files first. Does not stage, amend or push. Fails on conflicts, empty index or an ongoing merge/rebase.',
  branch: 'Switch to an existing local branch; create=true creates and switches to a new branch. Git refuses an unsafe switch. Read status first and act only on user intent.',
  remote: 'Run fetch (all remotes, no prune-tags), pull (clean worktree, fast-forward only, no autostash/rebase), or push (reviewed HEAD to one explicit upstream branch, never force/mirror/matching). Push requires a configured upstream and a single remote push URL. Uses existing Git credentials. Network operation: only run the requested operation.',
  stash: 'Save working changes including untracked files, apply a numbered stash while retaining it, or drop the explicitly selected stash. Read fresh status before choosing index; drop removes the record.',
} as const;

for (const schema of requestSchema.options) {
  const action = schema.shape.action.value;
  if (action === 'open') continue;
  const readOnly = ['status', 'diff', 'history', 'commitFiles', 'worktrees'].includes(action);
  const inputSchema = Object.fromEntries(Object.entries(schema.shape).filter(([key]) => key !== 'action')) as z.ZodRawShape;
  server.registerTool(`git_workbench_${action}`, {
    description: `${descriptions[action]}${readOnly ? '' : ' Requires explicit user intent and a current version. A stale-version error means stop and re-review, not silently retry.'}`,
    inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: action === 'stash' || action === 'worktreeRemove', openWorldHint: action === 'remote' },
  }, async (args: Record<string, unknown>) => {
    try {
      const request = requestSchema.parse({ ...args, action });
      if (!('repo' in request) || !opened.has(request.repo)) throw new Error('请先用 git_workbench_open 打开当前聊天的工作区；不能沿用其他连接的仓库 ID。');
      const result = await rpc(await ensureService(), request);
      const content = request.action === 'diff' ? {
        ...result as DiffResult,
        path: request.path,
        absolutePath: path.join(opened.get(request.repo)!, request.path),
        comparison: request.commit ? `commit ${request.commit}` : request.staged ? 'HEAD → Index' : 'Index → Working tree',
        hunks: splitPatch((result as DiffResult).patch).hunks.map((hunk, index) => ({ index, header: hunk.header })),
      } : result;
      return { content: [{ type: 'text' as const, text: JSON.stringify(content) }] };
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: String(error) }] }; }
  });
}
void server.connect(new StdioServerTransport()).catch(error => { console.error(error); process.exitCode = 1; });
