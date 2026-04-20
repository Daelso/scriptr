<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:subagent-cwd-discipline -->
# Subagent cwd discipline (when dispatching implementers from a worktree)

Subagents do NOT inherit your bash cwd. When working in a `.worktrees/<name>/` worktree and dispatching an implementer/reviewer via the Agent tool, the agent's own cwd is whatever it picks — likely the repo root, not the worktree.

To avoid stray edits landing in the main checkout:

1. **Every implementer prompt must include the absolute worktree path** and an explicit instruction to work from it. Not "the working directory" — the full path like `/home/chase/projects/scriptr/.worktrees/foo`.
2. **Every `git add` / test command in the prompt must use the worktree path** or be prefixed with `cd <worktree>`. Prompts like `npm test -- tests/foo.test.ts` will run in the agent's cwd, not yours.
3. **After a subagent reports DONE, spot-check main's `git status`** before moving on. Stray untracked files or modified tracked files in the parent checkout mean the subagent wrote to the wrong place.
4. If you see drift, `git checkout -- <files>` and `rm` the stray untracked files in main before merging the branch. The committed versions on the feature branch are the reviewed truth.
<!-- END:subagent-cwd-discipline -->
