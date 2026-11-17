import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ClockIcon, CodeIcon, Cross2Icon, FileTextIcon, LayersIcon, MagnifyingGlassIcon, PlusIcon, ReloadIcon, Share2Icon } from '@radix-ui/react-icons';
import type { Branch, Commit, DiffResult, RepoState, Request } from '../shared/protocol';
import type { GitTransport, WorkbenchHost } from './host';
import { DiffView } from './DiffView';
import { History } from './History';
import { FileTree } from './FileTree';
import { Worktrees } from './Worktrees';
import { Branches, branchKey } from './Branches';

type Tab = 'changes' | 'history' | 'branches' | 'stash' | 'worktrees';
type AppProps = ({ host: WorkbenchHost; transport?: never } | { host?: undefined; transport: GitTransport }) & { refreshKey?: number };
export function App({ host, transport, refreshKey = 0 }: AppProps) {
  const formId = useId();
  const call = host ? host.call : transport!;
  const [state, setState] = useState<RepoState | undefined>(host?.initialState);
  const [repository, setRepository] = useState(() => host ? host.repository : new URLSearchParams(location.search).get('repo') || localStorage.getItem('git-workbench-repo') || '');
  const [tab, setTab] = useState<Tab>('changes');
  const [file, setFile] = useState('');
  const [staged, setStaged] = useState(false);
  const [diff, setDiff] = useState<DiffResult>();
  const [loadedDiffKey, setLoadedDiffKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [favoriteBranches, setFavoriteBranches] = useState<string[]>([]);
  const [historyBranch, setHistoryBranch] = useState<Branch>();
  const [historyLoading, setHistoryLoading] = useState(false);
  const [pendingPush, setPendingPush] = useState<{ version: string; branch: string; upstream: string; head: string; ahead: number }>();
  const [dropStash, setDropStash] = useState<{ index: number; ref: string; message: string; version: string }>();
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commit, setCommit] = useState<Commit>();
  const [commitFiles, setCommitFiles] = useState<string[]>([]);
  const active = useRef(host?.initialState?.repo ?? '');
  const activeCommit = useRef('');
  const busyRef = useRef(false);
  const [revision, setRevision] = useState(0);
  const repo = state?.repo;
  const currentDiffKey = JSON.stringify([repo, file, staged, tab === 'history' ? commit?.hash : undefined, state?.version, revision]);
  const visibleDiff = loadedDiffKey === currentDiffKey ? diff : undefined;
  useEffect(() => { if (state) host?.onStateChange?.(state); }, [state, host?.onStateChange]);

  const refresh = useCallback(async (id: string) => {
    const next = await call<RepoState>({ action: 'status', repo: id });
    if (active.current === id) setState(previous => previous?.version === next.version && JSON.stringify(previous.branches) === JSON.stringify(next.branches) && JSON.stringify(previous.stashes) === JSON.stringify(next.stashes) && previous.ahead === next.ahead && previous.behind === next.behind ? previous : next);
  }, [call]);

  async function openRepository() {
    if (!repository.trim() || busyRef.current) return;
    busyRef.current = true; setBusy('打开仓库'); setError('');
    try {
      const next = await call<RepoState>({ action: 'open', path: repository.trim() });
      active.current = next.repo; setState(next); setFile(''); setDiff(undefined); setCommit(undefined); setCommits([]); setTab('changes'); setMessage('');
      if (!host) localStorage.setItem('git-workbench-repo', next.root);
      setRepository(next.root); setNotice(`已连接 ${next.name}`);
    } catch (error) { setError(String(error)); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const initial = useRef(!!host?.initialState);
  useEffect(() => { if (!initial.current) { initial.current = true; if (repository) void openRepository(); } }, []);
  useEffect(() => {
    if (!repo || host?.visible === false) return;
    const timer = setInterval(() => { if (!busyRef.current && !document.hidden) void refresh(repo).catch(error => setError(String(error))); }, 3000);
    const focus = () => { if (!busyRef.current) void refresh(repo).catch(error => setError(String(error))); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [repo, refresh, host?.visible]);
  const firstRefresh = useRef(!!host?.initialState);
  useEffect(() => { if (firstRefresh.current) { firstRefresh.current = false; return; } if (repo && host?.visible !== false) void refresh(repo).then(() => setRevision(value => value + 1)).catch(error => setError(String(error))); }, [refreshKey, repo, refresh, host?.visible]);

  useEffect(() => {
    if (!repo || !file) { setDiff(undefined); return; }
    let valid = true; setLoading(true);
    call<DiffResult>({ action: 'diff', repo, path: file, staged, commit: tab === 'history' ? commit?.hash : undefined }).then(result => { if (valid) { setDiff(result); setLoadedDiffKey(currentDiffKey); } }).catch(error => { if (valid) { setDiff(undefined); setLoadedDiffKey(currentDiffKey); setError(String(error)); } }).finally(() => { if (valid) setLoading(false); });
    return () => { valid = false; };
  }, [repo, file, staged, state?.version, tab, commit?.hash, revision]);

  useEffect(() => {
    if (tab !== 'history' || !repo) return;
    let valid = true; setHistoryLoading(true); setCommits([]);
    call<Commit[]>({ action: 'history', repo, skip: 0, ref: historyBranch ? `refs/${historyBranch.remote ? 'remotes' : 'heads'}/${historyBranch.name}` : undefined }).then(value => { if (valid) setCommits(value); }).catch(error => { if (valid) setError(String(error)); }).finally(() => { if (valid) setHistoryLoading(false); });
    return () => { valid = false; };
  }, [tab, repo, state?.head, revision, historyBranch]);

  async function mutate(request: Request, label: string) {
    if (busyRef.current || !repo) return false;
    const id = repo;
    busyRef.current = true; setBusy(label); setError(''); setNotice('');
    try {
      const next = await call<RepoState>(request);
      if (active.current === id) { setState(next); setNotice(`${label}完成`); setRevision(value => value + 1); }
      return true;
    } catch (error) {
      setError(String(error));
      await refresh(id).catch(() => {});
      return false;
    } finally { busyRef.current = false; setBusy(''); }
  }

  const choose = (path: string, index = false) => { setFile(path); setStaged(index); };
  async function selectCommit(value: Commit) {
    if (!repo) return;
    activeCommit.current = value.hash;
    setCommit(value); setFile(''); setCommitFiles([]);
    try {
      const files = await call<string[]>({ action: 'commitFiles', repo, commit: value.hash });
      if (active.current === repo && activeCommit.current === value.hash) { setCommitFiles(files); setFile(files[0] || ''); }
    } catch (error) { setError(String(error)); }
  }
  const base = state ? { repo: state.repo, version: state.version } : undefined;
  const unstagedFiles = state?.files.filter(item => item.worktree !== ' ') ?? [];
  const stagedFiles = state?.files.filter(item => item.index !== ' ' && item.index !== '?') ?? [];
  const selected = (staged ? stagedFiles : unstagedFiles).find(item => item.path === file);
  const action = (paths: string[], unstage: boolean) => base && void mutate({ ...base, action: 'stage', paths, unstage }, unstage ? '取消暂存' : '暂存');
  const submitCommit = () => { if (base && message.trim() && stagedFiles.length && !state?.operation && !state?.files.some(item => item.conflict)) void mutate({ ...base, action: 'commit', message }, '提交').then(ok => { if (ok) setMessage(''); }); };
  const createBranch = (name: string) => base ? mutate({ ...base, action: 'branch', name, create: true }, '创建并切换分支') : Promise.resolve(false);
  const changeTab = (value: Tab) => { activeCommit.current = ''; setTab(value); setFile(''); setDiff(undefined); setCommit(undefined); };
  const branches = state && <Branches branches={state.branches} selected={selectedBranch} favorites={favoriteBranches} onFavorites={setFavoriteBranches} busy={!!busy} onCreate={createBranch}
    onSelect={branch => { setSelectedBranch(branchKey(branch)); if (tab === 'history' && (historyBranch?.name !== branch.name || historyBranch?.remote !== branch.remote)) { setCommits([]); setHistoryLoading(true); setHistoryBranch(branch); setCommit(undefined); setFile(''); } }}
    onCheckout={branch => base && void mutate({ ...base, action: 'branch', name: branch.name, create: false }, '切换分支')}
    onHistory={branch => { setCommits([]); setHistoryLoading(true); setHistoryBranch(branch); setSelectedBranch(branch ? branchKey(branch) : ''); setRevision(value => value + 1); changeTab('history'); }}/>;

  return <div className={`workbench ${host ? 'embedded' : ''}`}>
    <div className="workspace-bar">
      {host ? <div className="host-repository"><strong title={repository}>{state?.name || 'Git'}</strong><button className="branch-chip" onClick={() => changeTab('branches')}><Share2Icon/>{state?.branch || '读取仓库…'}</button></div> : <div className="repo-input"><label htmlFor="repo">开发预览 · 仓库路径</label><input id="repo" value={repository} placeholder="仓库绝对路径" onChange={event => setRepository(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void openRepository(); }}/><button disabled={!!busy || !repository.trim()} onClick={() => void openRepository()}>打开</button></div>}
      <div className="remote-actions">
        <button disabled={!state || !!busy} onClick={() => base && void mutate({ ...base, action: 'remote', operation: 'fetch' }, 'Fetch')}><ReloadIcon/>Fetch</button>
        <button disabled={!state || !!busy} onClick={() => base && void mutate({ ...base, action: 'remote', operation: 'pull' }, 'Pull')}><ArrowDownIcon/>Pull</button>
        <button disabled={!state || !!busy} onClick={() => state && setPendingPush({ version: state.version, branch: state.branch, upstream: state.upstream, head: state.head, ahead: state.ahead })}><ArrowUpIcon/>Push</button>
      </div>
    </div>
    {error && <div className="error-banner" role="alert"><span>{error.replace(/^Error: /, '')}</span><button aria-label="关闭错误提示" onClick={() => setError('')}><Cross2Icon/></button></div>}
    {state?.operation && <div className="operation-banner">正在进行 {state.operation}。请在发起操作的工具中完成或中止。</div>}
    {pendingPush && <div className="push-confirm" role="region" aria-label="确认推送"><strong>Push · {pendingPush.branch} → {pendingPush.upstream || '未设置远端跟踪分支'}</strong><span>提交 {pendingPush.head.slice(0, 8)} · 待推送 {pendingPush.ahead} 个提交</span><div><button disabled={!!busy} onClick={() => setPendingPush(undefined)}>取消</button><button className="primary" disabled={!!busy || !pendingPush.upstream} onClick={() => base && void mutate({ ...base, version: pendingPush.version, action: 'remote', operation: 'push' }, 'Push').then(() => setPendingPush(undefined))}>推送当前分支</button></div></div>}
    <nav className="tabs" aria-label="Git 视图">
      {([{ id: 'changes', label: 'Commit', icon: <CodeIcon/> }, { id: 'history', label: 'Log', icon: <ClockIcon/> }, { id: 'branches', label: 'Branches', icon: <Share2Icon/> }, { id: 'stash', label: 'Stash', icon: <LayersIcon/> }, { id: 'worktrees', label: 'Worktrees', icon: <Share2Icon/> }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => changeTab(item.id)}>{item.icon}{item.label}{item.id === 'changes' && <span className="count">{state?.files.length ?? 0}</span>}</button>)}
      <button className="refresh" disabled={!repo || !!busy} title="刷新仓库" onClick={() => { if (repo) void refresh(repo).then(() => setRevision(value => value + 1)).catch(error => setError(String(error))); }}><ReloadIcon/></button>
    </nav>
    {!state ? <main className="empty"><Share2Icon/><h2>{busy ? '正在读取 Git 状态…' : '尚未打开 Git 仓库'}</h2><p>{host ? '仓库来自当前会话工作区。' : '输入仓库路径以预览插件组件。'}</p></main> : <main className={`main-area view-${tab}`}>
      {tab === 'changes' && <aside className="sidebar">
        <div className="file-search"><MagnifyingGlassIcon/><input aria-label="筛选文件" placeholder="筛选文件…" value={filter} onChange={event => setFilter(event.target.value)}/></div>
        <div className="file-list">
          {[
            { label: 'Unstaged · 未暂存', files: unstagedFiles.filter(item => item.index !== '?'), staged: false },
            { label: 'Staged · 已暂存', files: stagedFiles, staged: true },
            { label: 'Unversioned · 未跟踪', files: unstagedFiles.filter(item => item.index === '?'), staged: false },
          ].map(group => <details open key={group.label} className="file-group"><summary className="group-title"><span>{group.label} <b>{group.files.length}</b></span>{group.files.length > 0 && <button disabled={!!busy} onClick={event => { event.preventDefault(); action(group.files.map(item => item.path), group.staged); }}>{group.staged ? '− 全部' : '+ 全部'}</button>}</summary>
            <FileTree files={group.files.filter(item => item.path.toLowerCase().includes(filter.toLowerCase()))} staged={group.staged} selected={staged === group.staged ? file : ''} busy={!!busy} onSelect={path => choose(path, group.staged)} onStage={path => action([path], group.staged)} onOpen={host?.openFile}/>
            {group.files.length === 0 && <p className="group-empty">无文件</p>}
          </details>)}
        </div>
        <form className="commit-form" onSubmit={event => event.preventDefault()}>
          <label htmlFor={`${formId}-message`}>Commit Message</label>
          <textarea id={`${formId}-message`} value={message} onChange={event => setMessage(event.target.value)} placeholder="提交说明" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); submitCommit(); } }}/>
          <div className="commit-hint"><span>{stagedFiles.length} 个文件已暂存</span><kbd>Ctrl ↵</kbd></div>
          <button type="button" className="primary" onClick={submitCommit} disabled={!!busy || !message.trim() || !stagedFiles.length || !!state.operation || state.files.some(item => item.conflict)}><CheckIcon/>Commit</button>
        </form>
      </aside>}
      <section className="content">
        {tab === 'worktrees' && <Worktrees state={state} call={call} visible={host?.visible !== false} refreshKey={revision} openRepository={host?.openRepository} onRemoved={host?.onRepositoryRemoved}/>}
        {tab === 'history' && <div className={`log-workspace ${commit ? 'with-diff' : ''}`}>
          <aside className="log-branches">{branches}</aside>
          <div className="log-table"><History commits={commits} selected={commit?.hash || ''} branch={historyBranch?.name} loading={historyLoading} onSelect={value => void selectCommit(value)} busy={!!busy} more={() => { void call<Commit[]>({ action: 'history', repo: state.repo, skip: commits.length, ref: historyBranch ? `refs/${historyBranch.remote ? 'remotes' : 'heads'}/${historyBranch.name}` : undefined }).then(next => setCommits(previous => [...previous, ...next])).catch(error => setError(String(error))); }}/></div>
          <aside className="log-details"><div className="group-title">Changed Files</div><div className="commit-files">{commitFiles.map(item => <button className={`file-row ${file === item ? 'selected' : ''}`} key={item} onClick={() => choose(item)}><FileTextIcon/><span title={item}>{item}</span></button>)}{!commit && <p className="group-empty">选择提交以查看文件</p>}</div>{commit && <div className="commit-details"><strong>{commit.subject}</strong><span>{commit.author}</span><time>{new Date(commit.date).toLocaleString()}</time><code title={commit.hash}>{commit.hash.slice(0, 12)}</code></div>}</aside>
        </div>}
        {(tab === 'changes' || tab === 'history' && commit) && <>
          <div className="diff-toolbar"><div className="min-w-0 flex items-center gap-2"><FileTextIcon/><span className="truncate" title={file}>{file || 'Diff'}</span>{selected?.conflict && tab === 'changes' && <span className="conflict-tag">存在冲突</span>}</div><div className="flex items-center gap-2">{host?.openFile && file && tab === 'changes' && <button onClick={() => host.openFile!(file)}>打开文件</button>}{tab === 'changes' && selected && <button disabled={!!busy} onClick={() => action([file], staged)}>{staged ? '− 取消暂存' : '+ 暂存文件'}</button>}</div></div>
          <DiffView file={file} diff={visibleDiff} loading={loading || !!file && loadedDiffKey !== currentDiffKey} staged={staged} commit={tab === 'history' ? commit?.hash : undefined} busy={!!busy} onHunk={index => { if (base && visibleDiff && !loading) void mutate({ ...base, version: visibleDiff.version, action: 'hunk', path: file, index, unstage: staged }, staged ? '取消暂存代码块' : '暂存代码块'); }}/>
        </>}
        {tab === 'branches' && branches}
        {tab === 'stash' && <div className="management"><div className="section-heading"><h2>Stash</h2><button className="primary" disabled={!!busy || !state.files.length} onClick={() => base && void mutate({ ...base, action: 'stash', operation: 'save' }, '保存 Stash')}><PlusIcon/>保存当前改动</button></div>{dropStash && <div className="stash-confirm" role="alert"><p>删除 {dropStash.ref}：{dropStash.message}？此操作会移除此 Stash 记录。</p><button disabled={!!busy} onClick={() => setDropStash(undefined)}>取消</button><button className="danger" disabled={!!busy} onClick={() => { if (base) void mutate({ ...base, version: dropStash.version, action: 'stash', operation: 'drop', index: dropStash.index }, '删除 Stash').then(() => setDropStash(undefined)); }}>确认删除</button></div>}{!state.stashes.length && <div className="empty"><LayersIcon/><p>没有 Stash</p></div>}{state.stashes.map((entry, index) => <div className="management-row" key={entry.ref}><LayersIcon/><div className="flex-1"><strong>{entry.message}</strong><small>{entry.ref}</small></div><button disabled={!!busy} onClick={() => base && void mutate({ ...base, action: 'stash', operation: 'apply', index }, '应用 Stash')}>Apply</button><button className="danger" disabled={!!busy} onClick={() => setDropStash({ ...entry, index, version: state.version })}>Drop</button></div>)}</div>}
      </section>
    </main>}
    <footer className="status-bar"><span>{busy ? `${busy}中…` : notice || '就绪'}</span><span title={state?.root}>{state ? `${state.files.length} 个修改 · ${state.branch}` : 'Git'}</span></footer>
  </div>;
}
