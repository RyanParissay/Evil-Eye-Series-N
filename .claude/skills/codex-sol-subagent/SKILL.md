---
name: codex-sol-subagent
description: Use when a task in an Evil Eye repo is a long, well-defined, unsupervised or semi-supervised research task, or a code review that could be delegated — or when the user mentions codex, sol, or GPT-5.6.
---

# Codex Sol as a subagent

Ryan has Codex CLI installed (`/opt/homebrew/bin/codex`, logged in via
ChatGPT) with default model `gpt-5.6-sol` at high reasoning effort.

## When to delegate to Sol

- Long, WELL-DEFINED research tasks that can run unsupervised or
  semi-supervised (the task statement must stand alone).
- Code-review passes.

Not for: interactive back-and-forth work, vaguely-scoped tasks, or quick
lookups (do those yourself).

## How

```bash
# Non-interactive task (add --skip-git-repo-check outside a git repo)
codex exec --model gpt-5.6-sol "<self-contained task prompt>"

# Non-interactive code review
codex review
```

`codex exec` runs in the current directory; give it a full, self-contained
prompt with file paths and acceptance criteria, then verify its output
yourself before relying on it.

## Fallback

If Sol's usage/quota is exhausted (errors about usage or limits), fall back
to Anthropic models: dispatch Claude subagents (Sonnet/Opus/Fable) via the
Agent tool instead. Same delegation rules apply.
