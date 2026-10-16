# Arjun's Claude Code mods

Four small mods for Claude Code. Install the ones you want.

| Mod | What it does |
|---|---|
| `codex` | Claude can hand a task to Codex (OpenAI's gpt-6.1-sol), like a code review or a bug hunt. It runs in the background so the chat isn't blocked. |
| `imagegen` | Claude can make and edit images through Codex, and shows the finished images right in the chat. |
| `devserver-limit` | Stops Claude from starting a dev server when 2 are already running. Good for laptops with little memory. |
| `done-sound` | Plays a chime when a task that took over a minute finishes. |

## Install

In a Claude Code terminal session, type one line per mod:

```
/plugin install codex --marketplace arjunkambj/claude-mods
/plugin install imagegen --marketplace arjunkambj/claude-mods
/plugin install devserver-limit --marketplace arjunkambj/claude-mods
/plugin install done-sound --marketplace arjunkambj/claude-mods
```

The first time, it asks to add the marketplace: press `y`. Then pick a scope (Enter picks "user", so it works in every project).

## What you need

- A Mac. `imagegen` and `done-sound` use macOS tools and sounds.
- For `codex` and `imagegen`: the Codex CLI installed and signed in (`codex login`). Images count against your Codex plan.
