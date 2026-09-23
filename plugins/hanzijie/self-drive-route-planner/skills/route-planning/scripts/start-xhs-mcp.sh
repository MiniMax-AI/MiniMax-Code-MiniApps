#!/usr/bin/env bash
# 启动小红书数据源服务（xiaohongshu-mcp，幂等：已在运行则直接返回）
# 二进制不随插件打包（市场要求包平台无关）：首次运行从 GitHub Release 下载到 ~/.xhs-mcp/bin/
# 并做 sha256 校验；GitHub 直连失败时自动走镜像。运行数据（cookie/日志）固定在 ~/.xhs-mcp/，
# 与插件包解耦，republish 不丢登录态。
set -euo pipefail

XHS_VERSION="v2.5.0"   # 源码等价于 main@aad2a3d（其后仅 docs/CI 提交，无 Go 代码变更）
BIN_NAME="xiaohongshu-mcp-darwin-arm64"
BIN_SHA256="3e32e08c3403d22a5efef2f06aa52630b458819fc54474cba23e896c7092c38e"
DATA_DIR="$HOME/.xhs-mcp"
BIN="$DATA_DIR/bin/$BIN_NAME"
HEALTH_URL="http://localhost:18060/health"
RELEASE_PATH="xpzouying/xiaohongshu-mcp/releases/download/$XHS_VERSION/$BIN_NAME"

mkdir -p "$DATA_DIR/bin"

if curl -s -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "xiaohongshu-mcp 已在运行 (http://localhost:18060)"
  exit 0
fi

verify() { echo "$BIN_SHA256  $1" | shasum -a 256 -c - >/dev/null 2>&1; }

if [ ! -f "$BIN" ] || ! verify "$BIN"; then
  echo "下载 xiaohongshu-mcp $XHS_VERSION (~16MB)..."
  ok=""
  for url in "https://github.com/$RELEASE_PATH" \
             "https://gh-proxy.com/https://github.com/$RELEASE_PATH" \
             "https://ghfast.top/https://github.com/$RELEASE_PATH"; do
    echo "  尝试: $url"
    if curl -fL --connect-timeout 10 -m 300 -o "$BIN.tmp" "$url" 2>/dev/null && verify "$BIN.tmp"; then
      mv "$BIN.tmp" "$BIN"
      ok=1
      break
    fi
    rm -f "$BIN.tmp"
  done
  if [ -z "$ok" ]; then
    echo "下载失败：GitHub 与镜像均不可达，或 sha256 校验不通过"
    echo "可手动下载 https://github.com/$RELEASE_PATH 放到 $BIN 后重试"
    exit 1
  fi
  echo "下载完成，校验通过"
fi

chmod +x "$BIN" 2>/dev/null || true

cd "$DATA_DIR"
COOKIES_PATH="$DATA_DIR/cookies.json" nohup "$BIN" "$@" > "$DATA_DIR/xhs-mcp.log" 2>&1 &
echo "启动中 (pid $!)，首次运行需下载 ~150MB 内置浏览器..."

for i in $(seq 1 120); do
  if curl -s -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "服务已就绪: http://localhost:18060/mcp"
    exit 0
  fi
  sleep 5
done

echo "启动超时，查看日志: $DATA_DIR/xhs-mcp.log"
tail -20 "$DATA_DIR/xhs-mcp.log"
exit 1
