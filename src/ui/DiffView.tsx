import { useMemo, useRef, useState } from 'react';
import { FileTextIcon, PlusIcon, MinusIcon } from '@radix-ui/react-icons';
import { splitPatch, type DiffResult, type DiffHunk } from '../shared/protocol';
import { highlightLines, languageForFile, type SyntaxToken } from './syntax';

function CodeLine({ tokens }: { tokens?: SyntaxToken[] }) {
  return <code>{tokens?.map((token, index) => token.className ? <span key={index} className={token.className}>{token.text}</span> : token.text)}</code>;
}

function rows(hunk: DiffHunk) {
  const range = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(hunk.header);
  let left = Number(range?.[1] ?? 1);
  let right = Number(range?.[2] ?? 1);
  const output: { left?: string; right?: string; a?: number; b?: number; changed: boolean }[] = [];
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i];
    if (line.startsWith('\\')) continue;
    if (line.startsWith(' ')) { output.push({ left: line.slice(1), right: line.slice(1), a: left++, b: right++, changed: false }); continue; }
    const removed: string[] = [];
    const added: string[] = [];
    while (i < hunk.lines.length && !hunk.lines[i].startsWith(' ')) {
      if (hunk.lines[i].startsWith('-')) removed.push(hunk.lines[i].slice(1));
      if (hunk.lines[i].startsWith('+')) added.push(hunk.lines[i].slice(1));
      i++;
    }
    i--;
    for (let j = 0; j < Math.max(removed.length, added.length); j++) output.push({ left: removed[j], right: added[j], a: j < removed.length ? left++ : undefined, b: j < added.length ? right++ : undefined, changed: true });
  }
  return output;
}

export function DiffView({ file, diff, staged, commit, loading, busy, onHunk }: { file: string; diff?: DiffResult; staged: boolean; commit?: string; loading: boolean; busy: boolean; onHunk: (index: number) => void }) {
  const parsed = useMemo(() => splitPatch(diff?.patch ?? ''), [diff?.patch]);
  const blocks = useMemo(() => parsed.hunks.map(hunk => {
    const pairs = rows(hunk);
    const left = highlightLines(file, pairs.flatMap(row => row.left === undefined ? [] : [row.left]));
    const right = highlightLines(file, pairs.flatMap(row => row.right === undefined ? [] : [row.right]));
    let a = 0; let b = 0;
    return { hunk, pairs: pairs.map(row => ({ ...row, leftTokens: row.left === undefined ? undefined : left[a++], rightTokens: row.right === undefined ? undefined : right[b++] })) };
  }), [parsed, file]);
  const [unified, setUnified] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const current = useRef(-1);
  const navigate = (direction: number) => {
    current.current = Math.max(0, Math.min(parsed.hunks.length - 1, current.current + direction));
    scroll.current?.querySelectorAll('.hunk')[current.current]?.scrollIntoView({ block: 'nearest' });
  };
  if (loading) return <div className="p-8 space-y-4" aria-label="正在加载差异"><div className="skeleton w-2/3"/><div className="skeleton w-1/2"/><div className="skeleton w-4/5"/></div>;
  if (!file) return <div className="empty"><FileTextIcon/><p>选择文件以查看差异</p></div>;
  if (!diff) return <div className="empty">暂时无法读取差异，请刷新重试。</div>;
  if (diff.binary) return <div className="empty"><FileTextIcon width={32} height={32}/><h2>此文件不提供文本对比</h2><p>二进制、大文件或特殊文件可以按整个文件暂存。</p></div>;
  if (!parsed.hunks.length) return <div className="empty"><h2>{diff.patch ? '文件元数据发生变化' : '没有文本差异'}</h2><pre>{diff.patch}</pre><p>重命名、权限或空文件变更可按整个文件处理。</p></div>;
  return <div className="diff-view" tabIndex={0} onKeyDown={event => { if (event.key === 'F7') { event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1); } }}>
    <div className="diff-controls"><button title="上一处差异 (Shift+F7)" onClick={() => navigate(-1)}>↑</button><button title="下一处差异 (F7)" onClick={() => navigate(1)}>↓</button><span>{parsed.hunks.length} 处差异</span><span className="diff-language" title="按文件类型高亮；超长代码片段使用纯文本">{languageForFile(file) || 'Plain text'}</span><button aria-pressed={!unified} onClick={() => setUnified(false)}>Side-by-side</button><button aria-pressed={unified} onClick={() => setUnified(true)}>Unified</button></div>
    <div ref={scroll} className="diff-scroll">
    <div className="diff-columns"><span>{commit ? 'Parent' : staged ? 'HEAD' : 'Index'}</span><span>{commit ? commit.slice(0, 8) : staged ? 'Index' : 'Working tree'}</span></div>
    {blocks.map(({ hunk, pairs }, index) => <section key={hunk.header + index} className="hunk">
      <div className="hunk-bar"><code>{hunk.header}</code>{diff.canHunk && <button disabled={busy} onClick={() => onHunk(index)}>{staged ? <MinusIcon/> : <PlusIcon/>}{staged ? '取消暂存此块' : '暂存此块'}</button>}</div>
      <div className="diff-table">{pairs.map((row, i) => <div className={`diff-row ${unified ? 'unified' : ''}`} key={i}>
        {(!unified || row.changed && row.left !== undefined) && <div className={`code-cell ${row.changed ? row.left === undefined ? 'absent' : row.right !== undefined && !unified ? 'modified' : 'removed' : ''}`}><span className="line-number">{row.a}</span><span className="line-sign">{row.changed && row.left !== undefined ? '−' : ''}</span><CodeLine tokens={row.leftTokens}/></div>}
        {(!unified || row.right !== undefined) && <div className={`code-cell ${row.changed ? row.right === undefined ? 'absent' : row.left !== undefined && !unified ? 'modified' : 'added' : ''}`}><span className="line-number">{row.b}</span><span className="line-sign">{row.changed && row.right !== undefined ? '+' : ''}</span><CodeLine tokens={row.rightTokens}/></div>}
      </div>)}</div>
    </section>)}
    </div>
  </div>;
}
