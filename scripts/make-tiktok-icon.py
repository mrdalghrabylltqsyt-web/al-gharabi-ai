#!/usr/bin/env python3
"""يبني أيقونة تطبيق TikTok (1024×1024 PNG، خلفية بيضاء، الشعار في الوسط بهوامش)
من ملف شعار حقيقي. لا يرسم الشعار ولا يخترعه: يقرأ الشعار ويضعه فقط.

الاستخدام:
    python3 scripts/make-tiktok-icon.py --input /path/to/logo.png
    python3 scripts/make-tiktok-icon.py --input logo.svg   # يُحوَّل عبر cairosvg إن وُجد
    python3 scripts/make-tiktok-icon.py --input logo.png --padding 0.14 --size 1024

المخرجات: al-gharabi-tiktok-icon-1024.png في مجلد العمل (أو --output).
"""
from __future__ import annotations

import argparse
import io
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow مطلوب: pip install Pillow")


def load_source(path: str) -> Image.Image:
    """يقرأ صورة (PNG/JPG/WEBP/GIF) أو يحوّل SVG إن أمكن، ويعيد RGBA."""
    lower = path.lower()
    with open(path, "rb") as fh:
        data = fh.read()
    if lower.endswith(".svg"):
        try:
            import cairosvg  # type: ignore
        except ImportError:
            sys.exit("SVG يحتاج cairosvg: pip install cairosvg (أو صدّر الشعار PNG أولاً)")
        png = cairosvg.svg2png(bytestring=data, output_width=2048, output_height=2048)
        return Image.open(io.BytesIO(png)).convert("RGBA")
    return Image.open(io.BytesIO(data)).convert("RGBA")


def build_icon(src: Image.Image, size: int, pad_fraction: float, bg: tuple[int, int, int]) -> Image.Image:
    """يضع الشعار في وسط لوحة بيضاء بحجم size مع هوامش، محافظاً على النسبة."""
    if not (0.0 <= pad_fraction < 0.5):
        raise ValueError("padding يجب أن يكون بين 0 و0.5")

    # 1) إسقاط الشفافية على الخلفية البيضاء (لا حواف داكنة).
    canvas_bg = Image.new("RGBA", src.size, (*bg, 255))
    src = Image.alpha_composite(canvas_bg, src)

    # 2) قصّ الحدود الفارغة لإحكام التأطير (يزيل الفراغ الأصلي قبل إضافة الهوامش).
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)

    # 3) مساحة المحتوى بعد الهوامش.
    pad = int(round(size * pad_fraction))
    content = size - 2 * pad
    if content <= 0:
        raise ValueError("الهوامش أكبر من الحجم")

    # 4) احتواء مع الحفاظ على النسبة.
    w, h = src.size
    scale = min(content / w, content / h)
    new_size = (max(1, round(w * scale)), max(1, round(h * scale)))
    logo = src.resize(new_size, Image.LANCZOS)

    # 5) لوحة بيضاء معتمة + مركزة الشعار.
    canvas = Image.new("RGB", (size, size), bg)
    logo_rgb = Image.new("RGB", logo.size, bg)
    logo_rgb.paste(logo, (0, 0), logo)
    canvas.paste(logo_rgb, ((size - new_size[0]) // 2, (size - new_size[1]) // 2))
    return canvas


def main() -> int:
    ap = argparse.ArgumentParser(description="أيقونة TikTok 1024×1024 من شعار حقيقي")
    ap.add_argument("--input", "-i", required=True, help="مسار ملف الشعار")
    ap.add_argument("--output", "-o", default="al-gharabi-tiktok-icon-1024.png")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--padding", type=float, default=0.14, help="نسبة الهامش من كل جانب (افتراضي 0.14)")
    ap.add_argument("--bg", default="ffffff", help="لون الخلفية بصيغة hex بلا #")
    args = ap.parse_args()

    if not os.path.isfile(args.input):
        sys.exit(f"ملف الشعار غير موجود: {args.input}")

    bg = tuple(int(args.bg[i : i + 2], 16) for i in (0, 2, 4))
    if args.size != 1024:
        print(f"ملاحظة: TikTok يطلب 1024×1024، لكنك اخترت {args.size}")

    icon = build_icon(load_source(args.input), args.size, args.padding, bg)

    # ضمانات الإخراج الصارمة (يفشل بصوت عالٍ إن انحرف شيء).
    assert icon.size == (args.size, args.size), icon.size
    assert icon.mode == "RGB", icon.mode
    icon.save(args.output, format="PNG", optimize=True)

    with Image.open(args.output) as v:
        print(f"OK {args.output} size={v.size} mode={v.mode} bytes={os.path.getsize(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
