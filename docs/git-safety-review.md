# Git Workbench 0.6.0 · git4idea 对照审查

审查日期：2026-11-17。审查对象为插件实际暴露的 Git 操作和图形界面，不代表移植或完整审计 IntelliJ，也不是“零风险”保证。

## 参考源码

直接阅读 JetBrains 官方 IntelliJ Community 源码。分支树参考移动目录前的固定版本 `f897bfcc921dab4d21563c9874e81ef2cddf6069`；操作实现参考审查时 master（HEAD `4fcaef298f3f1336317d2e9cb8e99e3788ac58aa`）。只参考行为与结构，没有复制 Java/Kotlin 实现或品牌图标。

- [BranchesTreeModel.kt](https://github.com/JetBrains/intellij-community/blob/f897bfcc921dab4d21563c9874e81ef2cddf6069/plugins/git4idea/src/git4idea/ui/branch/dashboard/BranchesTreeModel.kt)：Local／Remote、远端和名称前缀分组。
- [BranchesTree.kt](https://github.com/JetBrains/intellij-community/blob/f897bfcc921dab4d21563c9874e81ef2cddf6069/plugins/git4idea/src/git4idea/ui/branch/dashboard/BranchesTree.kt)：当前分支、收藏、搜索、树菜单。
- [GitCheckoutOperation.java](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/branch/GitCheckoutOperation.java)：未合并、本地修改、未跟踪覆盖和其他 Worktree 占用检测。
- [GitStageCommitter.kt](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/index/GitStageCommitter.kt)：提交暂存区和结果刷新。
- [GitStashUtils.kt](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/stash/GitStashUtils.kt)：删除确认、Apply 与 Pop、包含未跟踪文件的保存。
- [GitPushOperation.java](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/push/GitPushOperation.java) 和 [GitImpl.java](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/commands/GitImpl.java)：明确推送目标和 refspec，独立区分普通与强制推送。
- [GitWorkingTreesService.kt](https://github.com/JetBrains/intellij-community/blob/4fcaef298f3f1336317d2e9cb8e99e3788ac58aa/plugins/git4idea/backend/src/workingTrees/GitWorkingTreesService.kt)：删除队列、打开项目的处理及结果通知。底层 remove 命令与上层确认必须一起理解，不能只复制一个命令。
- [官方 Log 布局](https://www.jetbrains.com/help/idea/log-tab.html)、[分支管理](https://www.jetbrains.com/help/idea/manage-branches.html)。

## 对照结果与修复

| 范围 | 插件的实际保护 |
| --- | --- |
| 整文件暂存／取消暂存 | 仅接受当前改动列表里的相对路径，拒绝路径逃逸和 `.git`；使用 literal pathspec 和 `--`。取消暂存保留工作文件，首次提交前使用 `rm --cached`。已有真实文件、重命名、删除和通配符测试。 |
| 按块暂存 | 后端重新生成 Diff，并校验版本与块序号，仅修改 index。图形 Diff 现在绑定仓库、路径、比较方式、提交和状态版本；切换文件或等待响应期间不展示旧 Diff，也不允许用旧内容按块暂存。 |
| 提交 | 只提交暂存区，不隐式 add、amend、push。拒绝冲突、空 index 和正在进行的合并／变基等操作。保留正常 Git hooks。 |
| 分支切换 | Git4idea 提供用户选择的 smart checkout 等流程。本插件在冲突时直接停止，不自动 Stash 或强制覆盖；严格校验实际本地分支，禁用猜测、覆盖忽略文件和递归修改 submodule。其他 Worktree 占用由 Git 拒绝。 |
| 版本校验 | 修复原来只对分支名、Stash 标签和消息计算版本的问题；现在包含分支对象哈希、Stash 对象哈希及推送目标配置摘要。同名对象被替换也会拒绝旧请求。 |
| Stash | Save 包含未跟踪文件；Apply 使用已选对象哈希且不删除记录。Drop 需要界面确认，保留确认时的版本；失败不自动重试。 |
| Push | 修复裸 `git push` 受 matching、mirror 和强制 refspec 配置影响的问题。界面显示分支、上游、提交和数量，确认后使用已审阅的提交哈希与单个明确目标；关闭 mirror、force、自动附带标签和递归推送 submodule。没有上游或远端有多个推送 URL 时停止。被远端拒绝后不自动改成强推。 |
| Pull | 仅允许快进；显式禁止 rebase、autostash、覆盖忽略文件和递归 submodule。存在本地改动先停止，让用户自行提交或保存；不会在后台替用户选择合并策略。 |
| Fetch | 使用现有远端与凭据，更新远端引用；显式关闭 prune-tags 和递归 submodule。远端跟踪引用仍按 Fetch 的 prune 语义清理。 |
| Worktree 创建 | 校验拓扑版本、分支名和新绝对目录；目标已存在时停止，不强制复用已占用分支。 |
| Worktree 删除 | 确认完整目录后校验拓扑；拒绝主目录、当前目录、detached HEAD、锁定、失效、重定向和包含其他 Worktree 的目标；拒绝本地修改、未跟踪、忽略文件及进行中的 Git 操作。执行不带 force 的 `git worktree remove`，保留分支。 |
| 并发与隔离 | 插件写操作按 common Git directory 排队，关联 Worktree 共用队列；每个 MCP 连接只操作自己已打开的仓库。新版使用独立 v3 服务，避免新界面连接旧安全规则的后端。 |

## 验证证据

`tests/safety.test.ts` 使用项目目录内的临时真实 Git 仓库和本地 bare 远端，未连接或推送用户真实远端：

1. 忽略文件与目标分支发生覆盖冲突：拒绝切换，文件字节保持不变，不生成自动 Stash。
2. 仅另一个分支 tip 变化：旧切换请求失效；按分支筛选历史返回对应提交。
3. Stash 序号与消息完全相同但对象不同：旧删除请求失效，替换后的记录保留。
4. 同时设置 matching、mirror、带 `+` 的 refspec 和自动标签：只推送选定当前分支，其他分支与标签保持原状。
5. 远端发生分叉：拒绝覆盖；配置 rebase/autostash 时，脏工作区仍拒绝 Pull；干净但分叉时也不变基。
6. detached Worktree：拒绝删除，文件保留。

其他回归覆盖真实文件的部分暂存、暂存区提交、首次提交、重命名、二进制、跨仓库隔离、MCP App 桥接、升级后资源缓存、工作树拓扑竞争及非 Git 项目的浅层发现。语法高亮测试验证多语言、跨行注释、源码原样保留、HTML 不执行和超长行降级。

## 实际边界

- Git4idea 依赖完整 IDE 的编辑器、文档保存、Local History 和冲突解决服务；Codex 插件无法因此获得这些能力。本版没有自动保存宿主编辑器、三方合并、交互式 Rebase 或 Local History 恢复。
- 本地终端、其他 IDE、Git hooks 和其他进程不受插件队列控制。版本复核与执行之间仍有外部竞争窗口；Git 锁及拒绝覆盖提供最后保护，不能保证跨进程的原子快照。操作时不要在其他工具同时更改同一仓库。
- Git 沿用用户配置、凭据、远端辅助程序和 hooks。该插件不是针对恶意 Git 配置或 hooks 的沙盒；不会禁用正常 hooks 来制造“安全”的假象。
- 超时或失败可能发生在 Git 已完成部分动作之后，界面会刷新状态，不能把所有错误都解释为“完全没有发生改变”。
- Diff 语法高亮处理可见差异片段，不是完整 IDE 的语义分析；片段之前的多行语法上下文、复杂模板嵌套和未知语言可能降级。二进制与超长代码不会强行高亮。
- 图形界面通过本地官方 MCP App 测试宿主验证；真实 Codex 侧栏需重启加载新进程后另行验收，不能把浏览器测试当成实机验收。
