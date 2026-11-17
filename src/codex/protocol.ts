import type { RepoState } from '../shared/protocol';

export interface CodexProject { id: string; name: string; paths: string[] }

export interface PanelData {
  kind: 'git-workbench-panel';
  state?: RepoState;
  repositories: RepoState[];
  roots: { name: string; path: string }[];
  source: 'explicit' | 'codex-thread' | 'mcp-roots' | 'unavailable';
  warnings: string[];
  phase?: 'pending' | 'ready';
  projects?: CodexProject[];
  error?: string;
}
