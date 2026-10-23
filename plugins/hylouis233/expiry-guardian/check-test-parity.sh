#!/usr/bin/env bash
# 校验「工作区源码」与「插件包」**测试文件**保持一致。
#
# 2026-10-20 反复踩到的坑：工作区（miniapps/expiry-guardian/）与插件包
# （plugins/hylouis233/reset-card-autouse/）各有一份测试，路径布局还不同
# （工作区是 `./x.mjs`，插件包是 `../miniapp/node/x.mjs`）。
# 改了一边忘了另一边 ⇒ 插件包跑的是旧测试，出现「17/18」这种看不懂的结果。
#
# ⇒ 这个脚本只比**测试文件的内容**（忽略 import 路径差异），
# 不一致就报错并指出是哪几个文件。
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/Desktop/mmx/miniapps/expiry-guardian}"
PLUGIN="${PLUGIN:-$(cd "$(dirname "$0")" && pwd)}"

# 插件包里测试在 tests/，工作区在 miniapp/node/。
PAIRS=(
  "config-fidelity.test.mjs"
  "decision.test.mjs"
  "mcp.test.mjs"
  "server-lint.test.mjs"
)

fail=0
for f in "${PAIRS[@]}"; do
  a="$WORKSPACE/miniapp/node/$f"
  b="$PLUGIN/tests/$f"
  if [ ! -f "$a" ] || [ ! -f "$b" ]; then
    echo "  SKIP  $f（缺文件）"
    continue
  fi
  # 归一化：去掉 import 路径差异与空白差异。
  na=$(sed -E "s#\.\./miniapp/node/##g; s#'\./#'#g" "$a" | tr -d ' \t\r\n')
  nb=$(sed -E "s#\.\./miniapp/node/##g; s#'\./#'#g" "$b" | tr -d ' \t\r\n')
  if [ "$na" = "$nb" ]; then
    echo "  OK    $f"
  else
    echo "  DIFF  $f  ← 工作区与插件包不一致"
    diff <(sed -E "s#\.\./miniapp/node/##g; s#'\./#'#g" "$a") \
         <(sed -E "s#\.\./miniapp/node/##g; s#'\./#'#g" "$b") | head -12 || true
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "❌ 工作区与插件包的测试文件不一致 —— 改完记得两边都同步。"
  exit 1
fi
echo
echo "✅ 工作区与插件包的测试文件一致"
