# opencode-statusline

My OpenCode status line, in the spirit of [claude-statusline](https://github.com/0xcvaliente/claude-statusline).

OpenCode has no external "statusLine command" setting, so this is a **TUI plugin** that replaces the
built-in prompt footer with a single line:

```
[Claude Sonnet 4.5] 📁 my-project | 🌿 main *3 | +12 -4 | [ctx] ● ● ● ● ○ ○ ○ ○ ○ ○ 42% · 138K | $0.04
```

- `tui.tsx` — the plugin. Copy it to `~/.config/opencode/plugins/statusline/tui.ts` (or install the
  package and reference it from `cli.json`).
- `cli.snippet.json` — merge the `plugins` key into `~/.config/opencode/cli.json`.

## What it shows

| Part | Source |
| --- | --- |
| `[model]` | the prompt's selected model |
| `📁 folder` | the session working directory |
| `🌿 branch` | current git branch |
| `*N` | number of changed files |
| `+A -R` | lines added / removed vs. `HEAD` |
| `[ctx] ● ● …` | context-window usage, from the latest assistant step ÷ `model.limit.context` |
| `· 138K` | cumulative session tokens |
| `$cost` | session cost |

The `[ctx]` bar and cost are hidden on narrow terminals (when OpenCode sets `showDetails` to false).

The line adapts to the terminal width: the `[ctx]` meter shrinks from the full dot bar to `[ctx] 42%`
and then drops, followed by the line deltas and cost, as space runs out.

## Not included

Claude Code's **5-hour and weekly rate-limit bars** come from Claude's subscription headers. OpenCode's
plugin API only exposes `experimental.usage.limits`, which reports OpenCode Console/Go budgets — not your
Anthropic/Codex subscription windows — so those bars are not reproduced.

## Install

Enable the plugin and disable the built-in footer it replaces, in `~/.config/opencode/cli.json`:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["-opencode.prompt.footer", "opencode-statusline"]
}
```

Then make the plugin discoverable, in one of two ways.

**Option A — copy a single file** (no npm):

```sh
mkdir -p ~/.config/opencode/plugins/statusline
cp tui.tsx ~/.config/opencode/plugins/statusline/tui.tsx
```

Keep the `.tsx` extension — the loader parses JSX only in `.tsx`, and a `tui.ts` with JSX fails
to build.

Then drop `"opencode-statusline"` from the `plugins` list — OpenCode auto-discovers everything under
`~/.config/opencode/plugins/`:

```json
{
  "plugins": ["-opencode.prompt.footer"]
}
```

**Option B — keep the checkout and reference it by path**:

```json
{
  "plugins": ["-opencode.prompt.footer", "/absolute/path/to/opencode-statusline"]
}
```

Changes to `cli.json` reload without restarting OpenCode.

## Requirements

- OpenCode V2 (tested against `2.2.7`)
- A terminal that renders emoji and the `●`/`○` glyphs
