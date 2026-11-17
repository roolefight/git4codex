---
name: git-workbench
description: Open the IDEA-style Git graphical panel for the current Codex workspace; switch projects, manage worktrees, review diffs, stage changes, commit, inspect history, branches and stash.
---

When the user asks for the Git panel, sidebar, or graphical Git tools, call git_workbench_panel with the current chat's workspace/worktree absolute path from its environment context. Do this automatically; never ask the user to repeat an already-known project path. The directory may be a project container with several repositories and need not itself contain .git. The tool discovers nested repositories, submodules and worktrees within that project and loads them into a repository switcher. It does not enumerate sibling worktrees outside the project.

Native sidebar calls may have empty arguments: the plugin resolves the exact thread_id/threadId from host request metadata to the local Codex thread cwd, returning source=codex-thread. It reads only that directory field, never messages or a recent-thread guess. Other hosts may supply MCP roots. If neither context is available, retry once with the current chat's known workspace path. Do not use the plugin installation directory, process cwd, a globally recent project, or scan unrelated drives. Do not ask users to type a known project path into the panel.

The panel first returns phase=pending so its loading view can mount; its UI calls git_workbench_workspace to load repository state. Default discovery uses Git roots/submodule metadata and a two-level search only for non-Git project containers. Use mode=deep only when the user requests nested discovery. Worktrees outside the project are listed through the Worktrees view, not by crawling directories.

Unsent Codex chats may supply a shared ephemeral thread without a persisted cwd. The panel offers registered Codex projects for explicit selection in that case; never guess using global selected-project state. Use git_workbench_workspace to rediscover repositories without opening another panel. Do not substitute a browser URL or only summarize a graphical panel result. Each repository has its own ID/version and drafts; choose the intended repository explicitly for writes. Never combine changes from several repositories into one commit.

For multiple explicitly selected projects, pass paths (an array of absolute directories) instead of path. The graphical panel provides Add project and preserves the loaded roots when rescanning. Viewing another repository does not change the Codex chat's workspace.

For worktree management, read git_workbench_worktrees for the selected repo; it lists only worktrees registered to that repository, including paths outside the project. Use its version (not status.version) for worktreeAdd/worktreeRemove. Create only at a user-selected new absolute directory, from current HEAD with newBranch=true or an existing local branch with newBranch=false. Use git_workbench_open on the selected worktree path before further operations. Removal deletes its clean working directory but retains branches; confirm the full target path. Never force removal or delete a branch as part of removing a worktree. On stale state, refresh and re-review instead of retrying automatically.

For conversational Git operations, use git_workbench_open with the current chat's workspace/worktree path when known. Do not substitute the main checkout for a linked worktree. Ask for a path only if the chat has no workspace and the user has not selected one.

Use the returned repository ID for subsequent operations. Read status immediately before a write and pass its version. If stale, show the changed state before retrying. Commit only the staged index; never stage unrelated changes automatically. Do not switch branches, push, drop stash, or write to another repository without user intent. Git Workbench does not provide force push, hard reset, merge resolution, or rebase continuation in this version.

For review, fetch git_workbench_diff for the selected file and state whether it compares the index to the worktree or HEAD to the index. Present a concise review and clickable absolute file paths using the Codex native file viewer. Use hunk for selected code blocks only. Do not execute a shell fallback to bypass a failed plugin write or stale-version check.

The panel uses standard MCP Apps plus an OpenAI thread entrypoint. UI actions call the same Git tools through the host bridge. File opening is available only when the host advertises openai/files. If the host returns only text and does not render the resource, report that host compatibility limitation accurately; do not claim the sidebar is visible or ask users to copy URLs/tokens into a web page. It does not replace Codex's built-in Review panel.
