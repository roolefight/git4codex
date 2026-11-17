import type { ComponentType } from 'react';
import type { Request } from '../../src/shared/protocol';

// Structural projections of the official 2026-11-15 contracts. The npm/source
// version gap and source links are documented in docs/host-integration.md.
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string; details: object } };
export type RpcHandler = (endpoint: string, payload: unknown, signal: AbortSignal, peer: { principal: { kind: string }; signal: AbortSignal }) => Promise<RpcResult>;
export interface HostConnection { rpc: { handle: (channel: string, handler: RpcHandler) => () => Promise<void> } }
export interface ClientConnection { rpc: { call: (channel: string, endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<RpcResult> } }
export interface TabInfo {
  tab: { visible: boolean; signal: AbortSignal; actions: {
    openResource: (address: string) => void;
    bindCommands: (commands: { refresh: () => void }) => () => void;
  } };
}
export interface PanelProps {
  sessionId: string;
  useSessions: <T>(select: (sessions: { byId: Record<string, { cwd?: string } | undefined> }) => T) => T;
  useTabInfo: () => TabInfo;
  request: (request: Request, signal?: AbortSignal) => Promise<unknown>;
}
export interface ClientContext {
  connection: ClientConnection;
  effect: (effect: () => (() => void), label?: string) => void;
  sidebarRightTabs: { register: (definition: { id: string; kind: string; title: () => string; keepMounted: boolean; guide: { order: number; title: () => string; description: () => string } }) => () => void };
  slots: {
    inject: (name: string, callback: () => unknown) => () => void;
    register: (entry: { name: string; key: string; inject: (sessionId: string) => Pick<PanelProps, 'request'> }, component: ComponentType<PanelProps>) => () => void;
  };
}
