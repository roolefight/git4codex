import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { App } from '../../src/ui/App';
import type { GitTransport } from '../../src/ui/host';
import type { ClientContext, PanelProps } from './contracts';
import css from 'workbench:css';

const id = 'dsh-plugin-git-workbench';
export const inject = ['slots', 'sidebarRightTabs', 'connection'];
export function apply(ctx: ClientContext) {
  ctx.effect(() => ctx.sidebarRightTabs.register({ id, kind: 'git-workbench', title: () => 'Git', keepMounted: true, guide: { order: 80, title: () => 'Git', description: () => '当前会话的修改、暂存、提交与历史' } }), 'git-workbench tab');
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id,
    inject: () => ({ request: async (request, signal) => {
      const result = await ctx.connection.rpc.call('/git-workbench', 'request', request, signal);
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    } }),
  }, WorkbenchPanel)), 'git-workbench body');
}

export function WorkbenchPanel(props: PanelProps) {
  const cwd = props.useSessions(sessions => sessions.byId[props.sessionId]?.cwd);
  const { tab } = props.useTabInfo();
  const container = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot>();
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { if (container.current) setRoot(container.current.shadowRoot ?? container.current.attachShadow({ mode: 'open' })); }, []);
  useEffect(() => tab.actions.bindCommands({ refresh: () => setRefreshKey(value => value + 1) }), [tab.actions]);
  const call = useCallback<GitTransport>(async <T,>(request: Parameters<GitTransport>[0]) => await props.request(request, tab.signal) as T, [props.request, tab.signal]);
  const openFile = (path: string) => tab.actions.openResource(`dsh-resource://file/session/${encodeURIComponent(props.sessionId)}/${path.split('/').map(encodeURIComponent).join('/')}`);
  return <div ref={container} style={{ height: '100%', minHeight: 0, overflow: 'hidden' }}>
    {root && createPortal(<><style>{css}</style>{cwd ? <App key={`${props.sessionId}:${cwd}`} refreshKey={refreshKey} host={{ call, repository: cwd, visible: tab.visible, openFile }}/> : <div className="empty">当前会话没有工作区。请先在 DSH 中选择项目。</div>}</>, root)}
  </div>;
}
