import { useMemo } from 'react';
import type { Commit } from '../shared/protocol';

export function History({ commits, selected, onSelect, more, busy, branch, loading }: { commits: Commit[]; selected: string; onSelect: (commit: Commit) => void; more: () => void; busy: boolean; branch?: string; loading?: boolean }) {
  const graph = useMemo(() => {
    const lanes: string[] = [];
    return commits.map(commit => {
      if (!lanes.includes(commit.hash)) lanes.push(commit.hash);
      const before = [...lanes];
      const lane = lanes.indexOf(commit.hash);
      lanes.splice(lane, 1, ...commit.parents.filter(parent => !lanes.includes(parent)));
      const after = [...lanes];
      const edges = before.flatMap((hash, from) => hash === commit.hash ? commit.parents.map(parent => ({ from, to: after.indexOf(parent), color: lane })) : [{ from, to: after.indexOf(hash), color: from }]);
      return { lane, edges, width: Math.max(before.length, after.length, 1) };
    });
  }, [commits]);
  const colors = ['#7ac9ae', '#e2b776', '#8ba6ce', '#bd9ec6'];
  return <div className="history-list"><div className="table-label"><span>提交历史</span><span title={branch}>{commits.length} 条 · {branch || '所有分支'}</span></div>
    {loading && <div className="empty" role="status">正在读取提交历史…</div>}
    {!loading && !commits.length && <div className="empty"><h2>没有提交记录</h2><p>选择其他分支，或创建第一次提交。</p></div>}
    {commits.map((commit, i) => <button className={`commit-row ${selected === commit.hash ? 'selected' : ''}`} key={commit.hash} onClick={() => onSelect(commit)}>
      <svg style={{ width: Math.max(40, graph[i].width * 16 + 16), height: 28 }} viewBox={`0 0 ${Math.max(40, graph[i].width * 16 + 16)} 28`} preserveAspectRatio="none" className="graph" aria-hidden="true">{graph[i].edges.filter(edge => edge.to >= 0).map((edge, j) => <path key={j} d={`M ${12 + edge.from * 16} 0 L ${12 + edge.from * 16} 14 L ${12 + edge.to * 16} 28`} stroke={colors[edge.color % colors.length]} fill="none" strokeWidth="1.6"/>)}<circle cx={12 + graph[i].lane * 16} cy="14" r="3.5" fill={colors[graph[i].lane % colors.length]} stroke="var(--wb-editor)" strokeWidth="1.5"/></svg>
      {commit.refs && <span className="ref-label" title={commit.refs}>{commit.refs}</span>}<span className="commit-subject" title={commit.subject}>{commit.subject}</span><span className="commit-author" title={commit.author}>{commit.author}</span><code>{commit.hash.slice(0, 7)}</code><time>{new Date(commit.date).toLocaleDateString('zh-CN')}</time>
    </button>)}
    {commits.length > 0 && commits.length % 100 === 0 && <button className="load-more" disabled={busy} onClick={more}>加载更早的提交</button>}
  </div>;
}
