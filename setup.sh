#!/usr/bin/env bash
# ai-route 一键部署:注册 ~/bin/ai-route 命令(包装本仓库入口)。
# 幂等;由 config-cli/setup.sh 链式调用,也可独立运行。
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log(){ printf '\033[1;34m[ai-route]\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[ai-route:warn]\033[0m %s\n' "$*" >&2; }

log "注册 ai-route 命令 -> ~/bin/ai-route"
mkdir -p "$HOME/bin"
cat > "$HOME/bin/ai-route" <<WRAPPER
#!/usr/bin/env bash
exec node "$REPO_DIR/ai-route" "\$@"
WRAPPER
chmod +x "$HOME/bin/ai-route" 2>/dev/null || true
case ":$PATH:" in
  *":$HOME/bin:"*) : ;;
  *) warn "~/bin 不在 PATH,建议加入 shell 配置: export PATH=\"\$HOME/bin:\$PATH\"" ;;
esac
log "完成:ai-route status|json|env|proxy"
