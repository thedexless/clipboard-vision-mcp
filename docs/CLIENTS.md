# MCP client configuration

All clients below speak MCP stdio. The command is always:

```
python -m clipboard_vision_mcp
```

with `GROQ_API_KEY` in the environment.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GROQ_API_KEY` | ✅ | — | Groq API key (https://console.groq.com/keys) |
| `GROQ_VISION_MODEL` | — | `qwen/qwen3.6-27b` | Vision model id, read once at startup. Override it when Groq retires a model — that is what happened to `meta-llama/llama-4-scout-17b-16e-instruct` on 2026-06-17. |
| `GROQ_VISION_MAX_TOKENS` | — | `4096` | Completion budget. Reasoning models spend part of it on a `<think>` block before answering, so this is deliberately higher than the 2048 used with Llama-4 Scout. |
| `VISION_MODEL` | — | — | Deprecated alias for `GROQ_VISION_MODEL`, still honoured when the latter is unset. |

Every example below shows only `GROQ_API_KEY`; add `GROQ_VISION_MODEL` to the same `env` block to pin a different model.

## Claude Code

Edit `~/.claude/settings.json` (or `%USERPROFILE%\.claude\settings.json`):

```json
{
  "mcpServers": {
    "clipboard-vision": {
      "command": "python",
      "args": ["-m", "clipboard_vision_mcp"],
      "env": { "GROQ_API_KEY": "gsk_..." }
    }
  }
}
```

Or CLI:

```bash
claude mcp add clipboard-vision -- python -m clipboard_vision_mcp
```

## Cursor

Settings → Features → MCP → Add new:

```json
{
  "clipboard-vision": {
    "command": "python",
    "args": ["-m", "clipboard_vision_mcp"],
    "env": { "GROQ_API_KEY": "gsk_..." }
  }
}
```

## Cline / Continue

Both clients use the same `mcpServers` shape — drop it into their MCP config file.

## Generic stdio

If your client accepts raw commands, pass:

```
env GROQ_API_KEY=gsk_... python -m clipboard_vision_mcp
```
