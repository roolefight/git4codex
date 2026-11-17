# Git Workbench

当前交付目标是 **Codex 本地插件**。在 Codex 聊天内审阅当前仓库/worktree、按文件或代码块暂存、提交暂存区、查看历史、管理分支和 Stash。

**0.6.0 支持多项目与 Worktree 管理、紧凑分支树和多语言 Diff 高亮。** 顶部切换各项目和已打开的 Worktree，保留各自草稿；Worktrees 标签支持列表、创建、打开与安全移除。已有 Codex 会话按精确会话 ID 加载项目或 Worktree；新建但尚未发送的聊天可从已登记项目中选择。图形面板参考 IDEA 的 Commit、Diff 和 Log。

- 安装与使用：[Codex 使用说明](docs/codex.md)
- 宿主支持边界和 IDEA 参考：[集成依据](docs/host-integration.md)
- Git 操作保护与源码对照：[安全审查](docs/git-safety-review.md)
- 源码：[roolefight/git4codex](https://github.com/roolefight/git4codex)
- 本地打包产物：`release/git-workbench-codex-0.6.0.zip`

默认优先读取 Git 元数据，仅在非 Git 项目目录浅查仓库；深层扫描由用户手动触发。面板显示加载状态。会话 ID 解析只读取该会话的工作目录，不读取聊天正文。

## 开发

需要 Node.js 22.13+ 和系统 Git。

```text
npm ci
npm run build:codex
npm test
npm run package:codex
```

打包后在 `release/git-workbench-codex-0.6.0` 目录运行：

```text
codex plugin marketplace add .
codex plugin add git-workbench@git-workbench-local
```

完整退出并重启 Codex，再打开 Git Workbench 面板。构建产物和本地测试数据不提交到源码仓库。

Git 核心、HTTP 服务、MCP 适配测试使用 `.test-repos` 下的临时真实仓库，不修改用户业务仓库。Codex 安装后的新聊天需要单独验证工具加载。

```text
src/core/          宿主无关的 Git 引擎
src/core/discovery.ts 项目范围内的仓库发现
src/shared/        请求协议和 Diff 解析
src/server/        本机认证服务与跨插件写入排队
src/mcp.ts         Codex MCP 工具、仓库连接范围和 Diff 块编号
src/mcp-panel.ts   MCP App 资源与 thread 入口
src/codex/         宿主 UI 桥接、主题、工作区选择与原生文件打开
src/ui/            宿主共用的 Commit / Diff / Log 图形组件
adapters/codex/    安装清单与聊天内 Git 工作流
scripts/          构建与 Codex 打包
```

`adapters/deepseek` 按用户要求暂缓；`npm run build` 可构建全部开发产物。DSH 适配不进入 Codex 发布包，未通过 DSH 实机验收。

多仓库界面测试：先运行 `npx tsx scripts/demo-workspace.ts`，再运行 `npx tsx scripts/preview-panel.ts`。该测试宿主仅接受生成的临时仓库，不进入发布包。

## 当前边界

仅支持本地 Git。远程操作采用系统现有身份、SSH/凭据管理器与上游配置。无交互式密码终端，认证失败显示 Git 错误。

按块暂存仅支持普通已跟踪文本修改。重命名、二进制、新文件、删除、权限变更按整文件处理。没有三方冲突编辑器、交互式 Rebase、Cherry-pick、Revert、force push 或 hard reset。

写操作校验仓库版本并按 common Git directory 排队。外部终端和编辑器不受插件队列控制；这不是对外部编辑的全局事务锁。Windows 已做本地验证，其他系统未实机验证。

## 许可证

本项目采用 [MIT License](LICENSE)，Copyright (c) 2026 roolefight。

第三方依赖保留各自的许可证和版权声明；打包脚本将其收集到插件的 `licenses/` 目录，同时附带本项目的 `LICENSE`。
