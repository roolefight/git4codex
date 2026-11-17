import { useMemo, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, DoubleArrowUpIcon, DotsHorizontalIcon, EnterIcon, FileTextIcon, MagnifyingGlassIcon, PlusIcon, StarFilledIcon, StarIcon } from '@radix-ui/react-icons';
import type { Branch } from '../shared/protocol';

export const branchKey = (branch: Branch) => `${branch.remote ? 'remote' : 'local'}:${branch.name}`;
interface Node { id: string; label: string; branch?: Branch; children: Node[] }

export function branchNodes(branches: Branch[], grouped: boolean, favorites: string[], prefix = '', depth = 0): Node[] {
  const folders = new Map<string, Branch[]>();
  const leaves: Node[] = [];
  for (const branch of branches) {
    const parts = branch.name.split('/');
    if (grouped && parts.length > depth + 1) {
      const name = parts[depth];
      folders.set(name, [...(folders.get(name) ?? []), branch]);
    } else leaves.push({ id: branchKey(branch), label: grouped ? parts[depth] : branch.name, branch, children: [] });
  }
  const nodes = [...leaves, ...[...folders].map(([name, items]) => ({ id: `${prefix}/${name}`, label: name, children: branchNodes(items, grouped, favorites, `${prefix}/${name}`, depth + 1) }))];
  const weight = (node: Node): number => node.branch?.current ? 0 : node.branch && favorites.includes(node.id) ? 1 : node.children.length ? 2 : 3;
  return nodes.sort((a, b) => weight(a) - weight(b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export function Branches({ branches, selected, favorites, onFavorites, onSelect, onCheckout, onCreate, onHistory, busy }: { branches: Branch[]; selected: string; favorites: string[]; onFavorites: (value: string[]) => void; onSelect: (branch: Branch) => void; onCheckout: (branch: Branch) => void; onCreate: (name: string) => Promise<boolean>; onHistory: (branch?: Branch) => void; busy: boolean }) {
  const [search, setSearch] = useState('');
  const [grouped, setGrouped] = useState(true);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<{ branch: Branch; x: number; y: number }>();
  const tree = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = branches.find(branch => branchKey(branch) === selected);
  const nodes = useMemo(() => [false, true].map(remote => ({ id: remote ? 'remote' : 'local', label: remote ? 'Remote' : 'Local', children: branchNodes(branches.filter(branch => branch.remote === remote && branch.name.toLowerCase().includes(search.toLowerCase())), grouped, favorites, remote ? 'remote-group' : 'local-group') })), [branches, search, grouped, favorites]);
  const visible: { node: Node; level: number; parent?: string }[] = [];
  const flatten = (items: Node[], level: number, parent?: string) => items.forEach(node => { visible.push({ node, level, parent }); if (search || !collapsed.includes(node.id)) flatten(node.children, level + 1, node.id); });
  flatten(nodes, 1);
  const tabStop = visible.some(item => item.node.id === selected) ? selected : visible[0]?.node.id;
  const count = (node: Node): number => node.branch ? 1 : node.children.reduce((total, child) => total + count(child), 0);
  const toggle = (id: string) => setCollapsed(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const favorite = (branch: Branch) => onFavorites(favorites.includes(branchKey(branch)) ? favorites.filter(item => item !== branchKey(branch)) : [...favorites, branchKey(branch)]);
  const showMenu = (branch: Branch, x: number, y: number) => { onSelect(branch); setMenu({ branch, x: Math.max(4, Math.min(x, window.innerWidth - 240)), y: Math.max(4, Math.min(y, window.innerHeight - 160)) }); };
  const create = async () => { if (!busy && name.trim() && await onCreate(name.trim())) { setCreating(false); setName(''); } };
  return <div className="branches-pane" onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'f') { event.preventDefault(); input.current?.focus(); } if (event.key === 'Escape') { setMenu(undefined); setCreating(false); } }}>
    <div className="branches-toolbar" role="toolbar" aria-label="分支操作">
      <button title="从当前分支新建" aria-label="新建分支" disabled={busy} onClick={() => setCreating(value => !value)}><PlusIcon/></button>
      <button title={active?.remote ? '请先创建本地跟踪分支' : '切换到选中的本地分支'} aria-label="切换选中分支" disabled={busy || !active || active.current || active.remote} onClick={() => active && onCheckout(active)}><EnterIcon/></button>
      <button title="收藏选中分支" aria-label="收藏选中分支" aria-pressed={!!active && favorites.includes(branchKey(active))} disabled={!active} onClick={() => active && favorite(active)}>{active && favorites.includes(branchKey(active)) ? <StarFilledIcon/> : <StarIcon/>}</button>
      <span className="toolbar-separator"/>
      <button title="按名称目录分组" aria-label="按目录分组" aria-pressed={grouped} onClick={() => setGrouped(value => !value)}><FileTextIcon/></button>
      <button title="折叠所有分组" aria-label="折叠所有分组" onClick={() => setCollapsed(visible.filter(item => !item.node.branch).map(item => item.node.id))}><DoubleArrowUpIcon/></button>
      <button className="branches-all" title="显示所有分支的日志" onClick={() => onHistory()}>全部日志</button>
    </div>
    {creating && <form className="branch-create" onSubmit={event => { event.preventDefault(); void create(); }}><label>从当前分支新建<input autoFocus aria-label="新分支名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="feature/my-change"/></label><div><button className="primary" disabled={busy || !name.trim()} type="submit">创建并切换</button><button type="button" disabled={busy} onClick={() => setCreating(false)}>取消</button></div></form>}
    <div className="file-search"><MagnifyingGlassIcon/><input ref={input} aria-label="搜索分支" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索分支…"/>{search && <button aria-label="清除分支搜索" onClick={() => setSearch('')}>×</button>}</div>
    <div className="branch-tree" ref={tree} role="tree" aria-label="Git 分支" onScroll={() => setMenu(undefined)}>
      {visible.map(({ node, level, parent }, index) => <button key={node.id} type="button" role="treeitem" aria-level={level} aria-expanded={node.branch ? undefined : !collapsed.includes(node.id) || !!search} aria-selected={node.branch ? selected === node.id : undefined} tabIndex={tabStop === node.id ? 0 : -1} className={`branch-tree-row ${selected === node.id ? 'selected' : ''} ${node.branch?.current ? 'current' : ''}`} style={{ paddingLeft: 8 + (level - 1) * 16 }} title={node.branch?.name ?? node.label}
        onClick={() => node.branch ? onSelect(node.branch) : toggle(node.id)}
        onDoubleClick={event => { if (node.branch) { const rect = event.currentTarget.getBoundingClientRect(); showMenu(node.branch, rect.left + 20, rect.bottom); } }}
        onContextMenu={event => { if (node.branch) { event.preventDefault(); showMenu(node.branch, event.clientX, event.clientY); } }}
        onKeyDown={event => {
          const elements = tree.current?.querySelectorAll<HTMLButtonElement>('[role=treeitem]');
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); elements?.[event.key === 'Home' ? 0 : event.key === 'End' ? visible.length - 1 : Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
          if (event.key === 'ArrowRight' && !node.branch) { event.preventDefault(); if (collapsed.includes(node.id)) toggle(node.id); else elements?.[index + 1]?.focus(); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); if (!node.branch && !collapsed.includes(node.id)) toggle(node.id); else elements?.[visible.findIndex(item => item.node.id === parent)]?.focus(); }
          if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) { event.preventDefault(); if (node.branch) { const rect = event.currentTarget.getBoundingClientRect(); showMenu(node.branch, rect.left, rect.bottom); } }
        }}>
        {node.branch ? <span className="branch-symbol">{node.branch.current ? <CheckIcon/> : favorites.includes(node.id) ? <StarFilledIcon/> : <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.5"/><circle cx="12" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><path d="M4 5v6m0-3c8 0 8-1 8-3"/></svg>}</span> : collapsed.includes(node.id) && !search ? <ChevronRightIcon/> : <ChevronDownIcon/>}
        <span className="branch-name">{node.label}</span>{node.branch?.current && <small>HEAD</small>}{!node.branch && <small>{count(node)}</small>}
      </button>)}
      {!branches.some(branch => branch.name.toLowerCase().includes(search.toLowerCase())) && <p className="group-empty">没有匹配的分支</p>}
    </div>
    {active && <div className="branch-selection"><span title={active.name}>{active.name}</span><button aria-label="选中分支操作" onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); showMenu(active, rect.left, rect.top - 150); }}><DotsHorizontalIcon/></button></div>}
    {menu && <div className="branch-menu-dismiss" onClick={() => setMenu(undefined)}><div className="branch-context-menu" role="menu" aria-label={menu.branch.name} style={{ left: menu.x, top: menu.y }}><div title={menu.branch.name}>{menu.branch.name}</div><button role="menuitem" disabled={busy || menu.branch.current || menu.branch.remote} onClick={() => onCheckout(menu.branch)}>Checkout · 切换分支</button><button role="menuitem" onClick={() => onHistory(menu.branch)}>查看分支日志</button><button role="menuitem" onClick={() => favorite(menu.branch)}>{favorites.includes(branchKey(menu.branch)) ? '取消收藏' : '收藏分支'}</button><button role="menuitem" disabled={busy} onClick={() => setCreating(true)}>从当前分支新建…</button></div></div>}
  </div>;
}
