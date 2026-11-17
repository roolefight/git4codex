# Git Workbench for Codex 0.6.0

本地插件包含 IDEA 式图形 Git 面板、MCP 工具和 Skill。面板通过 MCP App 资源加载到会话内容区；操作经宿主桥接直接调用 Git 工具，不依赖外部网页或复制访问令牌。

## 安装与打开

需要 Node.js 22.13+、系统 Git，以及支持本地插件的 Codex。在发布目录运行：

```powershell
codex plugin marketplace add .
codex plugin add git-workbench@git-workbench-local
```

重启桌面应用使插件工具和入口重新加载，然后说：**「打开当前工作区的 Git Workbench 图形面板」**。Skill 会调用 `git_workbench_panel` 并携带当前聊天的绝对 workspace/worktree 路径。

升级后应完整退出并重新启动 Codex；关闭侧栏或点击「重试」可能继续使用旧 MCP 进程。0.5.1 已修复旧进程在安装缓存被清理后再次读取 `panel.html` 导致侧栏「未能显示」的问题：进程启动时读取并保留面板内容。0.5.2 进一步接入原生侧栏请求携带的会话 ID，自动解析当前项目。

从会话内容面板入口打开 **Git Workbench** 时，Codex Desktop 的工具请求元数据携带 `thread_id` / `threadId`。插件据此只读查询已有会话的 `cwd`，自动加载项目内仓库；会话使用 Worktree 时保留其真实目录。有 MCP roots 的宿主仍支持通过 roots 自动发现，显式选择其他路径时以用户选择为准。

**新建但尚未发送的聊天有宿主限制**：本机 Codex 26.1111.2228.0 的侧栏使用共享临时 MCP 会话，未传所选项目目录，SQLite 也没有该临时记录。0.6.0 对此不再报“刷新会话”，而是展示 Codex 已登记项目供选择，支持多根项目。不会拿全局选中项目或最近会话冒充当前项目；无法保证空白聊天零点击绑定。手动路径只作为额外入口。

会话适配器位于 `src/codex/workspace.ts`，按精确 ID 参数化查询本机 `$CODEX_HOME/state_5.sqlite` 的 `threads.cwd`，不读聊天正文、不查最近会话、不写 Codex 数据库。项目选择器只读取 `.codex-global-state.json` 中 `local-projects` 的名称和根目录。适配基于本机版本；数据库结构改变等真正错误会停止自动选择，保留手动入口。Git 引擎不依赖这些数据。

## 当前项目与多仓库

项目目录本身不必是 Git 仓库。例如聊天工作区为 `F:\projects\shop`，其中 `frontend`、`backend` 各有 `.git`，打开当前项目面板会自动加载两个仓库。顶部「仓库」选择器显示名称、分支、改动数量及路径。各仓库的提交说明、文件选择和视图分别保留；切换时刷新状态，只有当前仓库持续轮询。重新扫描可发现新仓库。

顶部「添加项目」可选择 Codex 已登记项目，也可加载其他绝对目录；刷新会保留本面板已添加的项目。切换保留各仓库的草稿、文件选择、收藏和视图，打开或关闭整个面板后不保证保留这些内存状态。

识别普通 `.git` 目录和 worktree/submodule 的 `.git` 文件；从仓库子目录打开时识别所属仓库。自动扫描限于指定项目。Worktrees 标签可单独列出所选仓库登记的所有工作树，包括项目外目录；点击「打开」将其加入顶部切换列表。不会使用插件进程 cwd、全局最近项目或其他聊天的路径。发现只读，不自动暂存或提交。

默认优先 `git rev-parse` 定位仓库，再读取 `.gitmodules` 中已初始化的 submodule；找到 Git 根目录后不遍历其文件树。只有非 Git 项目容器才浅查两层、最多 128 个目录。需要更深的独立嵌套仓库时，主动点击「深层查找」，最多 6 层、2000 个目录。两种方式均最多 32 个仓库，跳过目录链接、依赖和生成目录。

面板先返回界面，再通过 MCP 读取 Git 状态。首次加载显示旋转指示、阶段文字和已用时；已有仓库的刷新／深层查找显示顶部进度，不遮住正在使用的界面。不显示无法计算的百分比。一次同 Worktree 对照中，发现阶段从约 1291ms 降至 245ms、深度提示从 212 条降至 0；不含 Git 状态读取，非总体性能保证。

验证安装：`codex plugin list --marketplace git-workbench-local --json`。
卸载：`codex plugin remove git-workbench@git-workbench-local`；删除来源：`codex plugin marketplace remove git-workbench-local`。卸载不修改 Git 仓库。

## 图形操作

- **Commit**：Unstaged / Staged / Unversioned 分组、可折叠目录树、文件过滤、整文件与整组暂存、提交说明和 Ctrl+Enter 提交。
- **Diff**：双栏与统一视图、行号、改动着色、按文件类型的离线语法高亮，支持 TS/JS、Java/Kotlin、Python、Go、Rust、HTML/Vue、CSS、JSON、SQL、YAML、Shell 等常见语言。深浅主题分别着色。保留 F7 / Shift+F7 导航和按块暂存；切换文件时不会沿用旧文件的 Diff。未知类型、超长行和二进制安全降级。
- **Log**：左侧分支树、中间紧凑提交图和列表、右侧文件与提交详情，选中提交后下方查看 Diff。选择分支过滤日志，「全部日志」恢复所有分支。
- **Branches / Stash**：26px 分支行，Local／Remote 与路径前缀分组、搜索、折叠、收藏、当前分支标记、工具栏和右键菜单；创建与切换本地分支。保存、应用和删除 Stash；删除使用确认前的版本和对象身份校验。
- **Fetch / Pull / Push**：使用系统现有 Git 凭据。Pull 只允许干净工作区快进，不隐式 Rebase／Stash。Push 先显示目标与提交信息，仅推送已确认的当前提交到单个上游分支，不采用 matching／mirror／强制 refspec。首次推送尚无上游时需先配置跟踪关系。
- **Worktrees**：列出主目录和关联工作树，显示路径、分支、当前查看、锁定与失效状态。新建可从当前 HEAD 创建新分支，也可使用尚未占用的本地分支；目标必须是已有父目录下的新目录。创建并打开后直接加入顶部列表，查看切换不会执行 branch checkout，也不改变 Codex 聊天所属项目。
- **移除 Worktree**：在另一个工作树的列表中确认完整路径后操作；保留分支。拒绝主目录、当前查看目录、detached HEAD、锁定/失效目录、有 Git 操作或有改动（含未跟踪及被忽略文件）的目录。不提供 force、prune、move 或 unlock。

面板跟随宿主深浅主题，支持窄侧栏布局。宿主声明文件打开能力后，可双击文件或点击「打开文件」使用原生查看器。

## 数据与安全边界

16 个 `git_workbench_` 工具：panel、workspace、open、status、diff、history、commitFiles、stage、hunk、commit、branch、remote、stash、worktrees、worktreeAdd、worktreeRemove。panel 返回 pending 界面上下文，UI 调用 workspace 取得实际仓库状态。workspace 接受 path／paths 和 quick／deep 模式；history 支持明确的本地或远端 ref。每个仓库独立保存选择与提交说明，不把工作区存到全局 localStorage。

写入校验仓库版本并按 common Git directory 排队。过期版本报错并刷新，不静默重试。提交仅使用已暂存内容，不自动 stage、amend 或 push。外部终端不受插件队列控制，仍由 Git 锁保护。

Worktree 增删使用 worktrees 返回的列表版本，重新确认拓扑后与普通 Git 写入共用队列。0.6 使用独立 v3 服务状态目录和默认端口 47833，避免新版界面连接旧安全规则的后台；不会终止旧聊天使用的服务。

具体源码对照、发现的问题、回归证据和跨进程竞争／Git hooks 等边界见 [Git 安全审查](git-safety-review.md)。

按块暂存仅支持普通已跟踪文本修改；重命名、二进制、新文件和删除按整文件处理。三方冲突编辑、交互式 Rebase、Cherry-pick、Revert、force push 和 hard reset 不在本版范围。

## 实现与验收

发布包包含插件清单、Skill、MCP、Git 服务、自包含 `panel.html` 资源及许可证。HTML 是宿主沙盒内的插件视图，不包含独立 HTTP 启动入口或 DSH 包。面板无网络资源依赖；Git 服务仅监听本机回环，认证凭据不进入 UI 或工具输出。

协议测试覆盖资源读取、thread 入口自动发现、官方 App → AppBridge → stdio MCP → 临时真实 Git 仓库，以及按块暂存、过期写入、首次提交和 worktree 隔离。多仓库测试覆盖非 Git 项目目录、嵌套仓库、重叠 roots 去重、两个会话隔离、roots 改变、不跟随目录链接、无 roots 回退和分仓库暂存。

会话上下文测试覆盖无 roots、空参数侧栏调用，两个精确会话 ID 并发加载不同项目/Worktree，Windows 扩展路径规范化，工作目录更新，未知/冲突 ID 拒绝，以及显式添加项目优先。已使用原生侧栏日志中的实际会话 ID 做只读加载核对，成功定位其独立 Worktree。数据字段参考 [Codex ThreadMetadata 查询](https://github.com/openai/codex/blob/main/codex-rs/state/src/runtime/threads.rs)。

**宿主验收单独进行**：官方 OpenAI Extensions 说明了 Desktop thread entrypoint，但 CLI 安装成功、SDK 测试通过不能证明当前 Codex 版本已启用它。若重启后仅显示文字或工具、未呈现 Git 面板，图形侧栏尚未通过该宿主验收，不能用网页预览冒充完成。

参考：[IntelliJ Community](https://github.com/JetBrains/intellij-community)、[Git Worktree](https://git-scm.com/docs/git-worktree/2.48.0)、[MCP Apps](https://github.com/modelcontextprotocol/ext-apps)、[OpenAI MCP Extensions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)。未复制 JetBrains 商标资产或 Java 实现。
