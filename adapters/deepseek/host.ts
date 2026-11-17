import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { ensureService, rpc } from '../../src/server/connection';
import { requestSchema } from '../../src/shared/protocol';
import type { HostConnection, RpcHandler } from './contracts';

export const name = 'git-workbench';
export const inject = ['tools'];
export function apply(ctx: Context) {
  // CLI-only DSH still gets agent tools; web DSH uses its authenticated carrier.
  ctx.inject(['connection'], connectionCtx => {
    const connection = (connectionCtx as Context & { connection: HostConnection }).connection;
    connection.rpc.handle('/git-workbench', createHandler());
  });
  ctx.tools.register(defineTool({
    name: 'git_workbench_open',
    description: '读取当前会话工作区的 Git 状态。图形操作在会话侧栏的 Git 标签内完成，无需外部浏览器。',
    parameters: { path: { type: 'string', required: true, description: '用户选择的 Git 仓库绝对路径' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args) {
      const connection = await ensureService(__dirname);
      const state = await rpc(connection, { action: 'open', path: args.path });
      return JSON.stringify({ state });
    },
  }));
  ctx.tools.register(defineTool({
    name: 'git_workbench_request',
    description: '执行 Git Workbench 请求。request 是 JSON，action 支持 status/diff/history/commitFiles/stage/hunk/commit/branch/remote/stash；repo 来自 open。写操作须用户要求并传最新 status 的 version。提交仅使用暂存区。',
    parameters: { request: { type: 'string', required: true, description: 'Git Workbench 请求 JSON' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async args => JSON.stringify(await rpc(await ensureService(__dirname), requestSchema.parse(JSON.parse(args.request)))),
  }));
}

export function createHandler(): RpcHandler {
  return async (endpoint, payload, signal, peer) => {
    if (peer.principal.kind !== 'owner' || peer.signal.aborted) return { ok: false, error: { code: 'git/forbidden', message: 'Git 面板仅供当前宿主所有者使用。', details: {} } };
    if (endpoint !== 'request') return { ok: false, error: { code: 'git/not-found', message: '未知 Git 接口。', details: {} } };
    try {
      signal.throwIfAborted();
      const request = requestSchema.parse(payload);
      const connection = await ensureService(__dirname);
      signal.throwIfAborted();
      return { ok: true, value: await rpc(connection, request) };
    } catch (error) { return { ok: false, error: { code: 'git/failed', message: String(error), details: {} } }; }
  };
}
