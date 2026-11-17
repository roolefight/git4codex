import { useEffect, useId, useRef, useState } from 'react';
import { PlusIcon, ReloadIcon, Share2Icon } from '@radix-ui/react-icons';
import type { RepoState, Request, Worktree, WorktreeState } from '../shared/protocol';
import type { GitTransport } from './host';

export function Worktrees({ state, call, visible, refreshKey, openRepository, onRemoved }: { state: RepoState; call: GitTransport; visible: boolean; refreshKey: number; openRepository?: (path: string) => Promise<void>; onRemoved?: (path: string) => void }) {
  const id = useId();
  const [snapshot, setSnapshot] = useState<WorktreeState>();
  const [creating, setCreating] = useState(false);
  const [directory, setDirectory] = useState('');
  const [branch, setBranch] = useState('');
  const [newBranch, setNewBranch] = useState(true);
  const [removing, setRemoving] = useState<{ entry: Worktree; version: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    if (!visible) return;
    let valid = true;
    const refresh = () => {
      if (pending.current) return;
      void call<WorktreeState>({ action: 'worktrees', repo: state.repo }).then(value => { if (valid && !pending.current) setSnapshot(value); }).catch(error => { if (valid) setError(String(error)); });
    };
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    return () => { valid = false; clearInterval(timer); };
  }, [call, state.repo, visible, refreshKey, state.head]);

  async function run(request?: Extract<Request, { action: 'worktreeAdd' | 'worktreeRemove' }>, directoryToOpen?: string) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (request) {
        setSnapshot(await call<WorktreeState>(request));
        if (request.action === 'worktreeRemove') { onRemoved?.(request.path); setRemoving(undefined); setNotice('已移除 Worktree，分支已保留。'); }
        else { setCreating(false); setDirectory(''); setBranch(''); setNotice('Worktree 已创建，可在列表中打开。'); }
      }
      if (directoryToOpen) await openRepository?.(directoryToOpen);
      if (!request && !directoryToOpen) setSnapshot(await call<WorktreeState>({ action: 'worktrees', repo: state.repo }));
    } catch (error) { setError(String(error)); setRemoving(undefined); }
    finally { pending.current = false; setBusy(false); }
  }
  const create = () => { if (snapshot && directory.trim() && branch.trim()) void run({ action: 'worktreeAdd', repo: state.repo, version: snapshot.version, path: directory.trim(), branch: branch.trim(), newBranch }, openRepository ? directory.trim() : undefined); };
  return <div className="management worktrees">
    <div className="section-heading"><h2>Worktrees <span className="count">{snapshot?.entries.length ?? '…'}</span></h2><div className="worktree-actions"><button disabled={busy} title="刷新 Worktrees" onClick={() => void run()}><ReloadIcon/></button><button disabled={busy} onClick={() => setCreating(value => !value)}><PlusIcon/>新建 Worktree</button></div></div>
    <p className="worktree-help">每个 Worktree 有独立的工作文件和暂存区。打开后可在顶部切换查看。</p>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <p role="status" className="worktree-help">{notice}</p>}
    {creating && <form className="worktree-form" onSubmit={event => event.preventDefault()}>
      <label htmlFor={`${id}-mode`}>分支方式<select id={`${id}-mode`} disabled={busy} value={newBranch ? 'new' : 'existing'} onChange={event => { setNewBranch(event.target.value === 'new'); setBranch(''); }}><option value="new">从当前 HEAD 创建新分支</option><option value="existing">使用已有本地分支</option></select></label>
      <label htmlFor={`${id}-branch`}>{newBranch ? '新分支名称' : '本地分支'}{newBranch ? <input id={`${id}-branch`} disabled={busy} value={branch} onChange={event => setBranch(event.target.value)} placeholder="feature/my-task"/> : <select id={`${id}-branch`} disabled={busy} value={branch} onChange={event => setBranch(event.target.value)}><option value="">选择未被 Worktree 使用的分支</option>{state.branches.filter(item => !item.remote).map(item => <option key={item.name} value={item.name} disabled={snapshot?.entries.some(entry => entry.branch === item.name)}>{item.name}{snapshot?.entries.some(entry => entry.branch === item.name) ? ' · 已使用' : ''}</option>)}</select>}</label>
      <label htmlFor={`${id}-path`}>新目录的绝对路径<input id={`${id}-path`} disabled={busy} value={directory} onChange={event => setDirectory(event.target.value)} placeholder="选择已存在父目录下的新目录" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } }}/></label>
      <div className="worktree-actions"><button type="button" className="primary" disabled={busy || !snapshot || !directory.trim() || !branch.trim() || !state.head} onClick={create}>{busy ? '处理中…' : openRepository ? '创建并打开' : '创建'}</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button></div>
    </form>}
    {removing && <div className="stash-confirm" role="alert"><p>移除目录 <strong>{removing.entry.path}</strong>？将删除该 Worktree 的工作文件，保留分支 {removing.entry.branch || '（detached HEAD）'}。存在本地改动或额外文件时会停止。</p><button disabled={busy} onClick={() => setRemoving(undefined)}>取消</button><button className="danger" disabled={busy} onClick={() => void run({ action: 'worktreeRemove', repo: state.repo, version: removing.version, path: removing.entry.path })}>确认移除</button></div>}
    {!snapshot && <p className="worktree-help">正在读取 Worktrees…</p>}
    {snapshot?.entries.map(entry => <div className="management-row worktree-row" key={entry.path}>
      <Share2Icon/><div className="worktree-info"><strong>{entry.branch || (entry.bare ? 'Bare repository' : `detached ${entry.head.slice(0, 8)}`)}</strong><small>{entry.path}</small><small>{[entry.main && '主目录', entry.current && '当前查看', entry.locked !== undefined && `已锁定${entry.locked ? `：${entry.locked}` : ''}`, entry.prunable !== undefined && `目录失效：${entry.prunable}`].filter(Boolean).join(' · ')}</small></div>
      <div className="worktree-actions">{openRepository && !entry.current && !entry.bare && entry.prunable === undefined && <button disabled={busy} onClick={() => void run(undefined, entry.path)}>打开</button>}{!entry.main && !entry.current && !entry.bare && !entry.detached && entry.locked === undefined && entry.prunable === undefined && <button className="danger" disabled={busy} onClick={() => setRemoving({ entry, version: snapshot.version })}>移除</button>}</div>
    </div>)}
  </div>;
}
