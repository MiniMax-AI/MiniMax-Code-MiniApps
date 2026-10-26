#!/bin/sh
# 一致性总检查：决策单测 + 跨语言一致性 + 校验器自检。
#
# 第三步是重点：如果校验器对「已知错误」也报一致，那它本身失效了，
# 等于没有校验。所以这里主动注入一处漂移，要求必须被抓到。
#
# 任一环节失败即以非零退出，可直接挂到 CI 或 git hook 上。
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail=0

echo "=== 1/3 后台决策单测 ==="
if python3 bg_decision.test.py > "$TMP/unit.log" 2>&1; then
  tail -1 "$TMP/unit.log"
else
  echo "✗ 决策单测失败"
  tail -20 "$TMP/unit.log"
  fail=1
fi

echo
echo "=== 2/3 跨语言一致性（后台 vs Mini App「蹬王之王」）==="
if node verify-parity.mjs > "$TMP/parity.log" 2>&1; then
  tail -1 "$TMP/parity.log"
else
  echo "✗ 两边策略已漂移"
  tail -25 "$TMP/parity.log"
  fail=1
fi

echo
echo "=== 3/3 校验器自检（注入漂移必须被抓到）==="
python3 - "$TMP" <<'PY'
import pathlib, sys
tmp = pathlib.Path(sys.argv[1])
src = pathlib.Path("reset_card_autouse.py").read_text()
needle = 'f"没有可用的重置卡，让{credit_desc}（{_fmt_day(credit_expiry_ms)}到期）先消耗"'
if needle not in src:
    print("✗ 自检锚点已失效：后台代码结构变了，请同步更新 check-parity.sh")
    raise SystemExit(1)
# 把「无卡 → keep-credit」改成「无卡 → wait」，这是一处真实的漂移
broken = src.replace(
    'return "keep-credit", (\n            ' + needle,
    'return "wait", "自检注入的错误行为"',
)
if broken == src:
    print("✗ 注入失败：目标分支结构与预期不符")
    raise SystemExit(1)
(tmp / "broken.py").write_text(broken)
PY

if [ ! -f "$TMP/broken.py" ]; then
  echo "✗ 自检注入失败，跳过"
  fail=1
elif MCODE_BG_SCRIPT="$TMP/broken.py" node verify-parity.mjs > "$TMP/selftest.log" 2>&1; then
  echo "✗ 校验器对注入的漂移仍报一致 —— 校验器本身已失效"
  fail=1
else
  echo "✓ 成功检出注入的漂移"
  grep -m1 '动作不一致' "$TMP/selftest.log" | sed 's/^/  /' || true
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ 全部通过：后台服务与 Mini App 策略一致"
else
  echo "✗ 存在不一致，需修复"
fi
exit "$fail"
