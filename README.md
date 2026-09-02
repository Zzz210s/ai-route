# ai-route

**English | [简体中文](./README.zh-CN.md)**

Local AI API central router: every CLI tool on your machine shares one live endpoint - the one your most recently used AI CLI session is already on - with zero hardcoded keys and an optional OpenAI/Anthropic protocol-conversion proxy.

## Background

If you use multiple AI CLIs (pi, Claude Code, OpenCode, Codex) and multiple helper tools (git commit generators, editor plugins, one-off scripts), each of them needs its own API base URL, key, and model - and they all go stale when you switch models or a rate limit kicks in.

ai-route solves this with one rule: **route to whatever the most recently active AI CLI session is using.** Switch models in your coding agent and every ai-route-aware tool follows immediately.

## Install

Requires Node.js >= 18. Zero npm dependencies.

```bash
git clone https://github.com/Zzz210s/ai-route ~/ai-route
bash ~/ai-route/setup.sh        # registers ~/bin/ai-route
```

Or with npm (global):

```bash
npm install -g Zzz210s/ai-route
```

## Usage

```bash
ai-route status                     # human-readable summary
ai-route json                       # full endpoint JSON (contains keys - do not share)
ai-route env [--openai|--anthropic] # shell env for eval
ai-route proxy [--port=8787]        # local protocol-conversion proxy

# Inject credentials into any OpenAI-compatible CLI for one command:
eval "$(ai-route env --openai)" && some-cli

# Or point CLIs at the local proxy (handles both protocols):
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=route
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787  ANTHROPIC_API_KEY=route
```

## How routing works

Endpoint candidates are resolved in priority order (`lib/detect.js`):

1. **Active session** - the most recently modified session file across pi (`~/.pi/agent/sessions`), Claude Code (`~/.claude/projects`), OpenCode, and Codex; its provider/model is resolved via your own pi config (`~/.pi/agent/model-hub.json` + `auth.json`).
2. **Model-name mapping** - `glm-*` / `claude-*` / `doubao-*` models map to the matching gateway providers declared in your own `model-hub.json`.
3. **Static fallback** - `~/.opencommit` config.

API keys are only ever read from your local config files at runtime; this repository contains none.

## Proxy behavior

- Accepts both OpenAI-compatible (`/v1/chat/completions`) and Anthropic Messages requests; converts either direction to the active upstream.
- Strips `temperature` / `top_p` / penalty params (some gateways reject non-default sampling).
- Rewrites the request `model` to the active model; `GET /v1/models` lists current candidates.
- Streaming requests are downgraded to a single SSE chunk (non-streaming text scenarios).
- Falls back to the next candidate endpoint on failure.
- Not converted: tool/function calls, image inputs, multi-turn streaming deltas.

## Reuse

`lib/detect.js` is a single-file, zero-dependency CommonJS module (`detectActiveAi()` / `route()` / `staticEndpoint()`); other tools - for example a git hook that generates commit messages - can vendor it directly.

## Contributing

Issues and pull requests are welcome at https://github.com/Zzz210s/ai-route.

## License

[MIT](./LICENSE)
