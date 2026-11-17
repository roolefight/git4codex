import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { CodexProject, PanelData } from './codex/protocol';
import type { RepoState } from './shared/protocol';
import { discoverRepositories } from './core/discovery';

export function registerPanel(server: McpServer, open: (directory: string) => Promise<RepoState>, panelHtml: string, threadWorkspace?: (meta?: Record<string, unknown>) => Promise<string | undefined>, projects?: () => Promise<CodexProject[]>) {
  const uri = 'ui://git-workbench/panel.html';
  registerAppResource(server, 'Git Workbench', uri, { description: 'Commit, Log and Diff panel for the current chat workspace' }, async () => ({
    contents: [{
      uri, mimeType: RESOURCE_MIME_TYPE,
      text: panelHtml,
      _meta: {
        ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
        'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'fullscreen' },
      },
    }],
  }));
  const absolutePath = z.string().min(1).refine(value => path.isAbsolute(value), 'Use an absolute workspace path');
  const inputSchema = { path: absolutePath.optional(), paths: z.array(absolutePath).min(1).max(32).optional() };
  async function workspace(args: { path?: string; paths?: string[]; mode?: 'quick' | 'deep' }, meta?: Record<string, unknown>, bootstrap = false): Promise<PanelData> {
    const data: PanelData = { kind: 'git-workbench-panel', roots: [], repositories: [], warnings: [], source: 'unavailable', phase: bootstrap ? 'pending' : 'ready' };
    try {
      if (args.path && args.paths) throw new Error('Use either path or paths.');
      if (args.path || args.paths) { data.roots = [...new Set(args.paths ?? [args.path!])].map(directory => ({ name: path.basename(directory), path: directory })); data.source = 'explicit'; }
      else {
        const directory = await threadWorkspace?.(meta);
        if (directory) { data.roots = [{ name: path.basename(directory), path: directory }]; data.source = 'codex-thread'; }
      }
      if (!data.roots.length && server.server.getClientCapabilities()?.roots) {
        const result = await server.server.listRoots({}, { timeout: 5000 });
        data.roots = result.roots.filter(root => root.uri.startsWith('file:')).map(root => ({ name: root.name || fileURLToPath(root.uri), path: fileURLToPath(root.uri) }));
        if (data.roots.length) data.source = 'mcp-roots';
      }
      if (bootstrap || !data.roots.length) data.projects = await projects?.().catch(() => []) ?? [];
      // Mount the app before slow Git work, so users see the loading view.
      if (bootstrap || !data.roots.length) return data;
      const discovered = await discoverRepositories(data.roots.map(root => root.path), args.mode);
      data.warnings = discovered.warnings;
      for (const directory of discovered.repositories) {
        try { data.repositories.push(await open(directory)); }
        catch (error) { data.warnings.push(`${directory}: ${String(error)}`); }
      }
      data.state = data.repositories[0];
    } catch (error) { data.error = String(error); data.phase = 'ready'; }
    return data;
  }
  const result = (data: PanelData) => ({
    content: [{ type: 'text' as const, text: data.phase === 'pending' ? 'Git Workbench · 面板已打开，正在加载项目。' : data.state ? `Git Workbench · 已加载 ${data.repositories.length} 个仓库 · ${data.state.name}` : data.error || (data.roots.length ? '当前项目范围内未发现 Git 仓库。' : '宿主未提供当前项目目录，可在面板选择 Codex 项目。') }],
    structuredContent: { ...data },
  });
  server.registerTool('git_workbench_workspace', {
    title: '发现当前项目的 Git 仓库',
    description: 'Discover repositories under the current chat project. Empty arguments resolve the exact Codex thread from host request metadata, or use host MCP roots. Explicit path/paths select other projects. Never guesses from process cwd or a recent chat. Read-only.',
    inputSchema: { ...inputSchema, mode: z.enum(['quick', 'deep']).default('quick').describe('Quick uses Git metadata and a two-level container search. Deep explicitly searches nested repositories.') }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args, extra) => result(await workspace(args, extra._meta)));
  registerAppTool(server, 'git_workbench_panel', {
    title: 'Git Workbench',
    description: 'Open the graphical Git panel and load this chat project automatically. Native empty sidebar calls resolve the exact Codex thread workspace/worktree from host request metadata, with MCP roots as fallback. Model calls can pass the known absolute workspace path. Each repository has isolated selection and commit drafts.',
    inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: false },
    _meta: { ui: { resourceUri: uri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  }, async (args, extra) => result(await workspace(args, extra._meta, true)));
}
