#!/usr/bin/env python3
"""在图片右下角贴 MiniMax 小标记,标识 AI 生成。

用法:
    python3 add_ai_badge.py IMG [IMG...]              # 原地覆盖
    python3 add_ai_badge.py IMG -o OUT_DIR            # 输出到目录
    python3 add_ai_badge.py IMG --width-ratio 0.08 --margin-ratio 0.025 --opacity 0.9

默认 badge 为脚本旁 ../assets/minimax-logo.png(白底自动抠透明)。
仅依赖 Pillow。
"""
import argparse
import sys
from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_BADGE = SCRIPT_DIR.parent / "assets" / "minimax-logo.png"


def load_badge(badge_path: Path, white_threshold: int = 245) -> Image.Image:
    """读 badge,近白像素转透明,并裁掉四周空白。"""
    badge = Image.open(badge_path).convert("RGBA")
    data = [
        (r, g, b, 0) if (r >= white_threshold and g >= white_threshold and b >= white_threshold) else (r, g, b, a)
        for (r, g, b, a) in badge.getdata()
    ]
    badge.putdata(data)
    bbox = badge.split()[3].getbbox()
    if bbox:
        badge = badge.crop(bbox)
    return badge


def add_badge(
    img_path: Path,
    badge: Image.Image,
    out_path: Path,
    width_ratio: float = 0.08,
    margin_ratio: float = 0.025,
    opacity: float = 0.9,
) -> None:
    im = Image.open(img_path).convert("RGBA")
    w, h = im.size
    bw = max(1, round(w * width_ratio))
    bh = max(1, round(badge.height * bw / badge.width))
    b = badge.resize((bw, bh), Image.LANCZOS)
    if opacity < 1.0:
        alpha = b.split()[3].point(lambda a: round(a * opacity))
        b.putalpha(alpha)
    margin = round(w * margin_ratio)
    im.alpha_composite(b, (w - bw - margin, h - bh - margin))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    rgb = im.convert("RGB")
    suffix = out_path.suffix.lower()
    if suffix in (".jpg", ".jpeg"):
        rgb.save(out_path, quality=95)
    elif suffix == ".png":
        im.save(out_path)
    else:
        rgb.save(out_path)


def main() -> int:
    ap = argparse.ArgumentParser(description="在图片右下角贴 MiniMax AI 生成小标记")
    ap.add_argument("images", nargs="+", help="待贴标图片路径")
    ap.add_argument("--badge", default=str(DEFAULT_BADGE), help="badge 图片路径(默认 MiniMax logo)")
    ap.add_argument("-o", "--out-dir", default=None, help="输出目录(缺省原地覆盖)")
    ap.add_argument("--width-ratio", type=float, default=0.08, help="badge 宽 / 图宽,默认 0.08")
    ap.add_argument("--margin-ratio", type=float, default=0.025, help="边距 / 图宽,默认 0.025")
    ap.add_argument("--opacity", type=float, default=0.9, help="badge 不透明度 0-1,默认 0.9")
    ap.add_argument("--white-threshold", type=int, default=245, help="白底转透明阈值,默认 245")
    args = ap.parse_args()

    badge_path = Path(args.badge)
    if not badge_path.is_file():
        print(f"badge 不存在: {badge_path}", file=sys.stderr)
        return 2
    badge = load_badge(badge_path, args.white_threshold)

    failed = 0
    for img in args.images:
        p = Path(img)
        if not p.is_file():
            print(f"SKIP 不存在: {p}", file=sys.stderr)
            failed += 1
            continue
        out = Path(args.out_dir) / p.name if args.out_dir else p
        try:
            add_badge(p, badge, out, args.width_ratio, args.margin_ratio, args.opacity)
            print(f"OK {out}")
        except Exception as exc:  # noqa: BLE001
            print(f"FAIL {p}: {exc}", file=sys.stderr)
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
