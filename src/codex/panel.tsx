import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App as McpApp, applyDocumentTheme, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { App } from '../ui/App';
import type { RepoState } from '../shared/protocol';
import type { PanelData } from './protocol';
import { createGitTransport } from './bridge';
import { ReloadIcon } from '@radix-ui/react-icons';

const bridge = new McpApp({ name: 'Git Workbench', version: '0.6.0' }, {}, { autoResize: false });
const extensions = new OpenAIExtensions(bridge);
const call = createGitTransport(bridge);

function LoadingStatus({ label, compact = false }: { label: string; compact?: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  return <div className={compact ? 'loading-status compact' : 'loading-status'} role="status" aria-live="polite"><ReloadIcon className="loading-spinner"/><strong>{label}</strong><span>{seconds > 0 ? `已用时 ${seconds} 秒` : '请稍候'}</span>{!compact && <><p>正在读取项目与仓库状态，完成后自动显示。</p><div className="loading-track"><span/></div></>}</div>;
}

function Panel() {
  const [data, setData] = useState<PanelData>();
  const [ready, setReady] = useState(false);
  const [directory, setDirectory] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('正在识别当前项目…');
  const [error, setError] = useState('');
  const [context, setContext] = useState<McpUiHostContext>({});
  const [selected, setSelected] = useState('');
  const [visited, setVisited] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const generation = useRef(0);
  const loadingWorkspace = useRef(false);
  const triedThreadWorkspace = useRef(false);
  const receive = useCallback((next: PanelData) => {
    setData(previous => ({ ...next, projects: next.projects ?? previous?.projects })); setError(next.error || '');
    setSelected(previous => next.repositories.some(repo => repo.repo === previous) ? previous : next.repositories[0]?.repo ?? '');
    setVisited(previous => [...new Set([...previous.filter(id => next.repositories.some(repo => repo.repo === id)), ...(next.repositories[0] ? [next.repositories[0].repo] : [])])]);
    setRefreshKey(previous => previous + 1);
  }, []);
  const updateRepository = useCallback((state: RepoState) => {
    setData(previous => previous && previous.repositories.some(repo => repo.repo === state.repo && repo !== state) ? { ...previous, repositories: previous.repositories.map(repo => repo.repo === state.repo ? state : repo) } : previous);
  }, []);
  useEffect(() => {
    const updateContext = (next: McpUiHostContext) => {
      if (next.theme) applyDocumentTheme(next.theme);
      if (next.styles?.variables) applyHostStyleVariables(next.styles.variables);
      setContext(previous => ({ ...previous, ...next }));
    };
    bridge.ontoolresult = result => {
      if (result.structuredContent?.kind !== 'git-workbench-panel') return;
      const next = result.structuredContent as unknown as PanelData;
      generation.current++; loadingWorkspace.current = false; setBusy(false);
      receive(next);
    };
    bridge.onhostcontextchanged = updateContext;
    bridge.onteardown = async () => { setReady(false); return {}; };
    void bridge.connect().then(() => { updateContext(bridge.getHostContext() ?? {}); setReady(true); }).catch(error => setError(`连接宿主失败：${String(error)}`));
    return () => { void bridge.close(); };
  }, [receive]);

  useEffect(() => {
    // UI tool calls carry the native host's thread metadata, even when an initial
    // model tool result did not. Resolve it once before showing a manual fallback.
    if (!ready || !data || data.error || (data.phase !== 'pending' && (data.source !== 'unavailable' || triedThreadWorkspace.current))) return;
    triedThreadWorkspace.current = true;
    void discover();
  }, [ready, data?.phase, data?.source, data?.error]);

  async function discover(directory?: string, mode: 'quick' | 'deep' = 'quick', projectPaths?: string[]) {
    if (loadingWorkspace.current) return;
    const current = ++generation.current;
    loadingWorkspace.current = true; setBusy(true); setError('');
    setLoadingLabel(mode === 'deep' ? '正在查找嵌套仓库…' : '正在读取 Git 仓库…');
    try {
      const paths = !directory && !projectPaths && data?.source === 'codex-thread' && data.roots.length === 1 ? [] : [...new Set([...(data?.roots.map(root => root.path) ?? []), ...(projectPaths ?? []), ...(directory?.trim() ? [directory.trim()] : [])])];
      const result = await bridge.callServerTool({ name: 'git_workbench_workspace', arguments: { ...(paths.length ? { paths } : {}), mode } }, { timeout: 130000 });
      if (result.isError || result.structuredContent?.kind !== 'git-workbench-panel') throw new Error(result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') || '无法加载工作区');
      if (generation.current === current) {
        receive(result.structuredContent as unknown as PanelData);
        setAdding(false); setDirectory('');
      }
    } catch (error) { if (generation.current === current) { setError(String(error)); setData(previous => previous && ({ ...previous, phase: 'ready' })); } }
    finally { if (generation.current === current) { loadingWorkspace.current = false; setBusy(false); } }
  }
  const repositories = data?.repositories ?? [];
  const loading = !error && (!ready || !data || data.phase === 'pending' || busy);
  const projectOptions = data?.projects?.length ? <select aria-label="选择 Codex 项目" disabled={busy} value="" onChange={event => { const project = data.projects?.find(item => item.id === event.target.value); if (project) void discover(undefined, 'quick', project.paths); }}><option value="">选择 Codex 项目…</option>{data.projects.map(project => <option key={project.id} value={project.id}>{project.name} — {project.paths.join(' · ')}</option>)}</select> : null;
  const choose = (id: string) => { setSelected(id); setVisited(previous => previous.includes(id) ? previous : [...previous, id]); };
  async function openWorktree(directory: string) {
    const current = generation.current;
    const state = await call<RepoState>({ action: 'open', path: directory });
    if (generation.current !== current) return;
    setData(previous => previous && ({ ...previous,
      roots: previous.roots.some(root => root.path === state.root) ? previous.roots : [...previous.roots, { name: state.name, path: state.root }],
      repositories: previous.repositories.some(repo => repo.repo === state.repo) ? previous.repositories : [...previous.repositories, state],
    }));
    choose(state.repo);
  }
  const removeWorktree = (directory: string) => {
    const key = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '');
    setData(previous => previous && ({ ...previous, roots: previous.roots.filter(root => key(root.path) !== key(directory)), repositories: previous.repositories.filter(repo => key(repo.root) !== key(directory)) }));
  };
  return <div className="codex-panel">
    {context.displayMode === 'inline' && context.availableDisplayModes?.includes('fullscreen') && <div className="panel-mode"><button onClick={() => { void bridge.requestDisplayMode({ mode: 'fullscreen' }).catch(error => setError(String(error))); }}>展开 Git 面板</button></div>}
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭连接错误">×</button></div>}
    {!!data?.warnings.length && <details className="discovery-warnings"><summary>仓库发现提示（{data.warnings.length}）</summary>{data.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details>}
    {ready && repositories.length > 0 ? <>
      <div className="repository-switcher"><label htmlFor="active-repository">仓库 · {repositories.length}</label><select id="active-repository" value={selected} onChange={event => choose(event.target.value)}>{repositories.map(repo => <option key={repo.repo} value={repo.repo}>{repo.name} · {repo.branch} · {repo.files.length} 修改 — {repo.root}</option>)}</select><button disabled={busy} aria-expanded={adding} onClick={() => setAdding(value => !value)}>添加项目</button><button disabled={busy} title="快速读取 Git 仓库" onClick={() => void discover()} aria-label="刷新项目仓库"><ReloadIcon/></button><button disabled={busy} title="主动查找更深层的嵌套仓库，最多 6 层" onClick={() => void discover(undefined, 'deep')}>深层查找</button></div>
      {busy && <LoadingStatus label={loadingLabel} compact/>}
      {adding && projectOptions && <div className="project-add">{projectOptions}</div>}
      {adding && <div className="project-add"><label htmlFor="additional-project">项目目录</label><input id="additional-project" autoFocus value={directory} onChange={event => setDirectory(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && directory.trim()) void discover(directory); if (event.key === 'Escape') setAdding(false); }} placeholder="其他项目的绝对路径"/><button disabled={busy || !directory.trim()} onClick={() => void discover(directory)}>加载</button><button disabled={busy} onClick={() => setAdding(false)}>取消</button></div>}
      {repositories.filter(repo => visited.includes(repo.repo)).map(state => <div key={state.repo} className="repository-pane" hidden={selected !== state.repo}><App refreshKey={refreshKey} host={{
        call, repository: state.root, initialState: state, visible: selected === state.repo, onStateChange: updateRepository, openRepository: openWorktree, onRepositoryRemoved: removeWorktree,
        openFile: extensions.files ? file => { void extensions.files!.open(`${state.root.replace(/[\\/]+$/, '')}/${file}`).catch(error => setError(String(error))); } : undefined,
      }}/></div>)}
    </> : loading ? <main className="repository-loading" aria-busy="true"><h1>Git Workbench</h1><LoadingStatus label={!ready ? '正在连接 Codex…' : loadingLabel}/></main> : <main className="repository-picker">
      <h1>Git Workbench</h1><p>{data?.roots.length ? '快速查找未发现 Git 仓库。可指定更小的目录，或主动查找嵌套仓库。' : '当前聊天尚未提供项目目录。请选择已登记的 Codex 项目。已有会话将自动加载对应仓库。'}</p>
      {projectOptions}
      {ready && <button disabled={busy} onClick={() => void discover()}>重新识别当前会话</button>}
      {!!data?.roots.length && <button disabled={busy} onClick={() => void discover(undefined, 'deep')}>查找嵌套仓库（最多 6 层）</button>}
      {data?.roots.map(root => <button key={root.path} disabled={!ready || busy} onClick={() => void discover(root.path)}><strong>{root.name}</strong><span>{root.path}</span></button>)}
      <details><summary>手动添加其他项目</summary><form onSubmit={event => event.preventDefault()}>
        <label htmlFor="workspace-path">项目目录</label>
        <input id="workspace-path" value={directory} onChange={event => setDirectory(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && ready && directory.trim()) { event.preventDefault(); void discover(directory); } }} placeholder="项目目录，可包含多个 Git 仓库" autoComplete="off" spellCheck={false}/>
        <button type="button" onClick={() => void discover(directory)} className="primary" disabled={!ready || busy || !directory.trim()}>{busy ? '正在发现仓库…' : '加载项目仓库'}</button>
      </form></details>
    </main>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Panel/>);
