import type { RepoState, Request } from '../shared/protocol';

// Each mounted panel owns its transport; conversations never share UI state.
export type GitTransport = <T>(request: Request) => Promise<T>;
export interface WorkbenchHost {
  call: GitTransport;
  repository: string;
  initialState?: RepoState;
  visible: boolean;
  openFile?: (path: string) => void;
  onStateChange?: (state: RepoState) => void;
  openRepository?: (path: string) => Promise<void>;
  onRepositoryRemoved?: (path: string) => void;
}
