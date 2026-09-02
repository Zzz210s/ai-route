# ai-route

本地 AI API 中央路由:让所有 CLI 工具(git hook、编辑器插件、一次性脚本)共享同一套端点探测与协议转换,不各自硬编码 key 与 baseURL。

## 命令

| 命令 | 作用 |
|---|---|
| `ai-route status` | 人读摘要:当前活跃端点与模型 |
| `ai-route json` | 端点 JSON(含 key,勿外传) |
| `ai-route env [--openai\|--anthropic]` | 输出 `eval` 用的环境变量(OPENAI_BASE_URL/KEY/MODEL 或 ANTHROPIC_*) |
| `ai-route proxy [--port=8787]` | 启动本地协议转换代理(OpenAI 兼容入,anthropic-messages 出) |

## 端点探测优先级(lib/detect.js)

1. 当前 pi 会话的 provider/model(env `PI_PROVIDER`/`PI_MODEL`,缺失则读最新 session jsonl)
2. `~/.pi/agent/model-hub.json` + `auth.json` 直连端点(密钥唯一来源,不入本仓库)
3. `~/.opencommit` 静态 fallback

claude-* 模型走 anthropic-messages,其余走 openai-completions。

## 部署

```bash
gh repo clone Zzz210s/ai-route ~/ai-route
bash ~/ai-route/setup.sh   # 注册 ~/bin/ai-route(幂等)
```

通常无需手动:`config-cli` 的 setup.sh 会克隆/更新本仓库并链式调用上面的部署。

## 被引用方

- **config-cli**(OpenCommit git hook):`prepare-commit-msg` 部署件运行时加载本仓库 `lib/detect.js` 做端点选择,与 hook 一起部署到 `~/.githooks/lib/`。
- 密钥永远只在 `~/.pi/agent/auth.json` 与 `~/.opencommit`,本仓库不含任何密钥。

## 结构

```text
ai-route            命令入口(status/json/env/proxy 分发)
lib/detect.js       端点探测与会话感知(单文件零依赖,被 config-cli hook 复用)
lib/convert.js      openai <-> anthropic 协议转换(请求/响应/SSE)
lib/proxy.js        本地 HTTP 代理(协议转换)
setup.sh            注册 ~/bin/ai-route
```
