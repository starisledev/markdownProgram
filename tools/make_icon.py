#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
砚屿 Markora — 应用图标生成器
构图：深墨色砚台渐变底 + 琥珀日 + 双峰岛屿（形似 M，取自 Markora/Markdown）
     + 墨水池岸线与倒影高光。输出 32/128/256 PNG 与多尺寸 ICO。
"""
import os
from PIL import Image, ImageDraw, ImageFilter

S = 1024  # 超采样渲染尺寸（抗锯齿）
R = 216   # 圆角半径（相对 1024）

# ---------- 工具 ----------
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def vgrad(w, h, top, bottom):
    img = Image.new("RGB", (1, h))
    px = img.load()
    for y in range(h):
        px[0, y] = lerp(top, bottom, y / (h - 1))
    return img.resize((w, h))

def rounded(img, radius):
    m = Image.new("L", img.size, 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), m)
    return out

def radial_glow(w, h, cx, cy, radius, color, alpha):
    """中心 alpha=alpha 到边缘为 0 的径向光斑，叠加到 base 上。"""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 用多层圆模拟渐变光晕
    steps = 24
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(alpha * (i / steps) ** 2)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (a,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius / 6))
    return Image.alpha_composite(base, layer)

# ---------- 主图 ----------
base = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 背景：深墨色渐变（上偏蓝、下近黑）
bg = vgrad(S, S, (40, 52, 78), (15, 22, 36))
base = Image.alpha_composite(base, bg.convert("RGBA"))

# 顶部柔光（制造砚台磨光的质感）
base = radial_glow(S, S, S * 0.5, S * 0.18, S * 0.55, (150, 175, 215), 42)

# 琥珀色旭日（后景，叠于山后，营造晨光）
base = radial_glow(S, S, S * 0.78, S * 0.30, S * 0.20, (242, 176, 74), 90)
d = ImageDraw.Draw(base)
sun_r = 96
sun_c = (int(S * 0.78), int(S * 0.30))
d.ellipse([sun_c[0] - sun_r, sun_c[1] - sun_r, sun_c[0] + sun_r, sun_c[1] + sun_r],
          fill=(244, 184, 84, 255))
# 日心高光
d.ellipse([sun_c[0] - sun_r * 0.55, sun_c[1] - sun_r * 0.55,
           sun_c[0] + sun_r * 0.55, sun_c[1] + sun_r * 0.55],
          fill=(250, 205, 120, 255))

# ---------- 墨水池（屿的基座，前景） ----------
d = ImageDraw.Draw(base)
water_top = int(S * 0.80)
water = Image.new("RGBA", (S, S), (0, 0, 0, 0))
dw = ImageDraw.Draw(water)
# 池体：下方一带墨蓝
dw.rounded_rectangle([0, water_top, S, S], radius=R // 2,
                     fill=(26, 38, 62, 255))
# 池面渐变微光
for i in range(0, int(S * 0.14)):
    y = int(water_top + 20 + i)
    c = int(30 + 28 * (i / (S * 0.14)))
    dw.line([0, y, S, y], fill=(c, 48 + int(10 * i / 60), 74 + int(14 * i / 60), 200))

# 岸线高光（池顶边缘的一抹亮线）
dw.rounded_rectangle([0, int(water_top - 10), S, water_top], radius=22,
                     fill=(84, 112, 156, 220))

# 倒影高光带（屿正下方、池内的纵向柔和反光）
for off, wdt in [(0, 130), (300, 130)]:
    cx = int(S * 0.5) + off - 256
    dw.rounded_rectangle([cx - wdt // 2, int(water_top + 4), cx + wdt // 2, S - 6],
                         radius=40, fill=(96, 128, 178, 36))

# ---------- 岛屿双峰（形似 M） ----------
# 后峰（右侧、更高）
d.polygon([(int(S * 0.42), int(S * 0.20)),
           (int(S * 0.16), int(S * 0.46)),
           (int(S * 0.62), int(S * 0.40))],
          fill=(239, 227, 202, 255))
# 前峰（左侧、略低，压住后峰底缘形成 M 谷）
d.polygon([(int(S * 0.205), int(S * 0.255)),
           (int(S * 0.63), int(S * 0.435)),
           (int(S * 0.29), int(S * 0.42))],
          fill=(226, 210, 176, 255))
# 前峰受光面（左上侧高光）
d.polygon([(int(S * 0.26), int(S * 0.36)),
           (int(S * 0.31), int(S * 0.40)),
           (int(S * 0.37), int(S * 0.37))],
          fill=(243, 233, 210, 220))

# 池体叠回主图
base = Image.alpha_composite(base, water)

# ---------- 导出 ----------
img = rounded(base, int(base.size[0] / 1024 * R)).resize((512, 512), Image.LANCZOS)
out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "icons")

img.resize((32, 32), Image.LANCZOS).save(os.path.join(out_dir, "32x32.png"))
img.resize((128, 128), Image.LANCZOS).save(os.path.join(out_dir, "128x128.png"))
img.resize((256, 256), Image.LANCZOS).save(os.path.join(out_dir, "128x128@2x.png"))
img.save(os.path.join(out_dir, "icon.ico"),
         sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print("OK ->", out_dir)
