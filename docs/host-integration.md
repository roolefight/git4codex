# 宿主边界

2026-11-15 用户调整优先级：先做好 Codex，DSH 暂缓。正式交付用 `build:codex` 和 `package:codex`；通用开发预览与 DSH 代码保留在源码，不作为已验收功能发布。

## Codex

使用 portable plugin.json、mcp.json、Skill 和 stdio MCP。0.3 增加 `git_workbench_panel`：`_meta.ui.resourceUri` 指向 `ui://git-workbench/panel.html`，`_meta["openai/ui"].entrypoints=[{type:"thread"}]` 注册会话内容入口。资源 MIME 为 `text/html;profile=mcp-app`，默认 fullscreen；这是宿主面板显示模式，并非独立操作系统窗口。

内嵌 React 视图使用官方 MCP Apps SDK，通过 `callServerTool` 调用相同工具，无 localhost HTTP 或访问令牌。0.4 初始化工具接收当前会话项目目录，或读取 MCP roots，自动发现并加载范围内的多个仓库。workspace 工具可重新扫描，每次重新解析当前 roots，不记住服务端「最近项目」。原生文件打开只在宿主声明 `openai/files` 后启用。

接入限制：0.3 在当前聊天的空参数调用只返回空 roots，没有拿到项目目录。mcp.json 的 cwd 是插件安装目录，不是会话路径。0.4 的 Skill 始终使用会话环境中已知的项目路径初始化；宿主无 roots 时，单独空参数入口仍无法自行推断项目。不为绕过这一限制读取聊天数据库、全局最近项目或添加需要信任的生命周期 hook。

已实现协议接入，目标 Codex 的实际面板显示仍需单独验收。ChatGPT MCP Apps/Extensions 文档是实现依据，不能直接作为具体 Codex 版本已支持面板的证明。

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/build/extensions
- https://github.com/openai/mcp-extensions/blob/main/docs/spec.md

## DSH（暂缓）

已编写实验适配：侧栏类型 + keyed slot，`useSessions(s => s.byId[sessionId]?.cwd)` 跟随工作区，`useTabInfo()` 控制生命周期、可见性、刷新及宿主文件导航。React 组件在 ShadowRoot 内直接挂载以隔离样式，无 iframe 或粘贴令牌。数据通过 Connection 的认证 RPC channel；只允许 owner Peer，复用 Git 服务。当前适配只通过结构类型与模拟注册测试，尚未在目标 DSH 宿主验收。

依据官方 master 源码（读取日期 2026-11-15）：

- `packages/client/connection/src/rpc.ts`：Host `rpc.handle(channel, handler)` 与 Client `rpc.call`。
- `packages/client/connection/src/rpc-host.ts`：channel 的认证及 Peer 契约。
- `packages/client/ui-sidebar-files/src/client/FilesBody.tsx`：会话 cwd、文件导航和刷新绑定。
- `packages/client/ui-sidebar-right/src/client/contract/slots.ts`：Tab owner props。
- https://deepseek-harness.github.io/deepseek-harness/reference/subsystems/sidebar-right

最新 npm 依赖树引用未发布的 `@deepseek-ai/dsh-paths`，完整 SDK 安装失败。因此 `contracts.ts` 是上述源码公开接口的最小结构投影，并非已通过全部 DSH 官方类型检查。复工时必须对照用户实际 DSH 版本，不宣称兼容所有预览版。

## IDEA 参考

- `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitPanel.kt`：变更审阅、提交说明和底部提交动作。
- `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/frame/MainFrame.java`：分支/提交列表/文件与详情的分栏。
- `platform/diff-impl/src/com/intellij/diff/tools/simple/SimpleDiffViewer.java`：双栏对齐、差异导航。
- https://www.jetbrains.com/help/idea/commit-and-push-changes.html
- https://www.jetbrains.com/help/idea/log-tab.html
- https://www.jetbrains.com/help/idea/differences-viewer.html

共享 Git 核心独立于宿主；共享视图通过每个面板独立的 `WorkbenchHost` 接受 transport、仓库与文件打开回调，不保存跨宿主的全局当前仓库。新增工具需落实真实扩展接口后再接入。
