# Worktrees & Import

## Where Worktrees Are Stored

- Git worktrees live at the directory you specify when creating them (e.g., `/path/to/course/agent-xyz-123`).
- Git stores administrative metadata under your repository’s `.git/worktrees/<name>`.
- In this project, `create_agent_worktree()` (backend) creates worktrees inside the selected course directory.
- Review data is not stored in the worktree; it persists separately under `~/.canvas-author/reviews/`.

## Importing Existing Worktrees

You can attach existing worktree directories to a repository using the command:

- Command: `Canvas: Import Worktrees from Folder`
- Prompts for:
  - Repository root (where `.git` lives)
  - External worktrees folder (defaults to `~/dig4503-worktrees`)
- The command scans subfolders:
  - If the folder is already a registered worktree → marked as already registered
  - If it contains a `HEAD` file with a branch (`ref: refs/heads/<branch>`) → attaches via `git worktree add --force <path> <branch>`
  - If no branch is detected → skipped

## Notes

- Only genuine worktree directories (or directories with a readable `HEAD` pointing to a branch) can be imported.
- If the folder contains a standalone clone (not a worktree), it won’t be attached; convert by `git worktree add` from your repo root.
- Reviews remain queryable even after worktree deletion since they’re archived under `~/.canvas-author/reviews/`.
