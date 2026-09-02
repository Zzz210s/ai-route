# ai-route

**[English](./README.md) | 简体中文**

本地 AI API 中央路由:让机器上所有 CLI 工具共享同一个活跃端点——即你最近使用的 AI CLI 会话所在的端点——零硬编码 key,附带 OpenAI/Anthropic 协议转换代理。

## 背景

如果你同时用多个 AI CLI(pi、Claude Code、OpenCode、Codex)和多个辅助工具(git 提交信息生成器、编辑器插件、一次性脚本),每个工具都要单独配 API 地址、key 和模型——而且一旦换模型或触发限流就全部失效。

ai-route 用一条规则解决:**路由到最近活跃的 AI CLI 会话所用的端点**。在编码 agent 里切模型,所有接入 ai-route 的工具立即跟随。

## 安装

要求 Node.js >= 18,零 npm 依赖。

```bash
git clone https://github.com/Zzz210s/ai-route ~/ai-route
bash ~/ai-route/setup.sh        # 注册 ~/bin/ai-route
```

或用 npm 全局安装:

```bash
npm install -g Zzz210s/ai-route
```

## 使用

```bash
ai-route status                     # 人读摘要
ai-route json                       # 完整端点 JSON(含 key,勿外传)
ai-route env [--openai|--anthropic] # 输出 eval 用的 shell 环境变量
ai-route proxy [--port=8787]        # 本地协议转换代理

# 给任意 OpenAI 兼容 CLI 一次性注入凭据:
eval "$(ai-route env --openai)" && some-cli

# 或让 CLI 走本地代理(同时支持两种协议):
export OPENAI_BASE_URL=http://127.0.0.1:8787/v1 OPENAI_API_KEY=route
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787  ANTHROPIC_API_KEY=route
```

## 路由原理

端点候选按优先级解析(`lib/detect.js`):

1. **活跃会话**——在 pi(`~/.pi/agent/sessions`)、Claude Code(`~/.claude/projects`)、OpenCode、Codex 的会话文件里取最近修改者;其 provider/model 经你自己的 pi 配置(`~/.pi/agent/model-hub.json` + `auth.json`)解析。
2. **模型名映射**——`glm-*` / `claude-*` / `doubao-*` 模型映射到你 `model-hub.json` 里声明的网关 provider。
3. **静态兜底**——`~/.opencommit` 配置。

API key 只在运行时从你的本地配置文件读取;本仓库不含任何密钥。

## 代理行为

- 同时接受 OpenAI 兼容(`/v1/chat/completions`)与 Anthropic Messages 请求,双向转换到活跃上游。
- 剥除 `temperature` / `top_p` / 惩罚参数(部分网关拒绝非默认采样)。
- 请求 `model` 改写为活跃模型;`GET /v1/models` 列出当前候选。
- 流式请求降级为单个 SSE chunk(适用于非流式文本场景)。
- 失败时自动回退到下一个候选端点。
- 不转换:工具/函数调用、图片输入、多轮流式增量。

## 复用

`lib/detect.js` 是单文件零依赖 CommonJS 模块(`detectActiveAi()` / `route()` / `staticEndpoint()`);其他工具——例如生成提交信息的 git hook——可以直接复用它。

## 贡献

欢迎提 Issue 与 Pull Request:https://github.com/Zzz210s/ai-route

## License

[MIT](./LICENSE)
