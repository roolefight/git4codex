import type { App } from '@modelcontextprotocol/ext-apps';
import type { GitTransport } from '../ui/host';

// UI actions go through the host's MCP bridge, never HTTP or model prompts.
export function createGitTransport(app: Pick<App, 'callServerTool'>): GitTransport {
  return async <T>(request: Parameters<GitTransport>[0]): Promise<T> => {
    const { action, ...args } = request;
    const result = await app.callServerTool({ name: `git_workbench_${action}`, arguments: args });
    const text = result.content?.filter(item => item.type === 'text').map(item => item.text).join('\n');
    if (result.isError) throw new Error(text || 'Git 操作失败');
    if (!text) throw new Error('Git 工具没有返回数据');
    const data = JSON.parse(text);
    return action === 'open' ? data.state : data;
  };
}
