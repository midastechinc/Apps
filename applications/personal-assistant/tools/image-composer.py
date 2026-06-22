#!/usr/bin/env python3
"""
Social image composer for Midas Tech social posts.
Reads JSON from stdin: { bg_b64, headline, stat, bullets, cta }
Writes PNG bytes to stdout.

The AI generates background visuals only (no text).
This script overlays all text programmatically for 100% accuracy.
"""
import sys, json, base64, io
from PIL import Image, ImageDraw, ImageFont

def load_font(paths, size):
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            pass
    return ImageFont.load_default()

BOLD    = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
           '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']
REGULAR = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
           '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']

data     = json.loads(sys.stdin.read())
bg_bytes = base64.b64decode(data['bg_b64'])
headline = data.get('headline', '').upper()
stat     = data.get('stat', '')
bullets  = data.get('bullets', [])[:4]
cta      = data.get('cta', 'Book a free IT assessment → midastech.ca')

W, H       = 1024, 1024
FOOTER_H   = 80       # reserved for the branding footer strip
CONTENT_H  = H - FOOTER_H
PAD_L      = 52
TEXT_W     = W - PAD_L * 2

WHITE   = (255, 255, 255, 255)
RED_BOX = (200, 40,  40,  220)
BLUE    = (0,   110, 175, 230)
ROW_BG  = (255, 255, 255, 28)

# ── Load & resize background ──────────────────────────────────────────────────
bg = Image.open(io.BytesIO(bg_bytes)).convert('RGBA').resize((W, H), Image.LANCZOS)

# ── Dark overlay — ramps from top to bottom for readability ───────────────────
overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ov_draw = ImageDraw.Draw(overlay)
for y in range(CONTENT_H):
    alpha = int(110 + (y / CONTENT_H) * 80)   # 110–190 gradient
    ov_draw.line([(0, y), (W, y)], fill=(8, 12, 30, alpha))
# Footer area: fully opaque dark so branding strip composites cleanly
ov_draw.rectangle([0, CONTENT_H, W, H], fill=(8, 12, 30, 255))

bg = Image.alpha_composite(bg, overlay)
draw = ImageDraw.Draw(bg)

# ── Fonts ─────────────────────────────────────────────────────────────────────
f_head   = load_font(BOLD,    58)
f_stat   = load_font(BOLD,    21)
f_bullet = load_font(REGULAR, 19)
f_cta    = load_font(BOLD,    21)

# ── Helpers ───────────────────────────────────────────────────────────────────
def text_w(text, font):
    bb = font.getbbox(text)
    return bb[2] - bb[0]

def line_h(font):
    bb = font.getbbox('Ag')
    return bb[3] - bb[1]

def shadow_text(draw, pos, text, font, fill=WHITE, offset=2):
    x, y = pos
    draw.text((x + offset, y + offset), text, font=font, fill=(0, 0, 0, 160))
    draw.text((x, y), text, font=font, fill=fill)

def wrap_text(text, font, max_w):
    words = text.split()
    lines, line = [], ''
    for word in words:
        test = (line + ' ' + word).strip()
        if text_w(test, font) <= max_w:
            line = test
        else:
            if line:
                lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines

def draw_wrapped(draw, text, font, x, y, max_w, fill=WHITE, gap=8):
    lh = line_h(font)
    for line in wrap_text(text, font, max_w):
        shadow_text(draw, (x, y), line, font, fill)
        y += lh + gap
    return y

# ── Layout ────────────────────────────────────────────────────────────────────
y = 46

# Headline
y = draw_wrapped(draw, headline, f_head, PAD_L, y, TEXT_W, WHITE, gap=8)
y += 22

# Stat callout (red pill)
if stat:
    stat_clip  = stat if len(stat) <= 85 else stat[:82] + '…'
    sw         = min(TEXT_W, text_w(stat_clip, f_stat) + 44)
    sh         = line_h(f_stat) + 22
    draw.rounded_rectangle([PAD_L, y, PAD_L + sw, y + sh], radius=6, fill=RED_BOX)
    draw.text((PAD_L + 22, y + 11), stat_clip, font=f_stat, fill=WHITE)
    y += sh + 26

# Bullet points
if bullets:
    lh = line_h(f_bullet)
    row_pad = 8
    for b in bullets:
        b_text  = '▸  ' + b.lstrip('•·‣▸-* \t').strip()
        row_h   = lh + row_pad * 2
        draw.rounded_rectangle(
            [PAD_L - 10, y - row_pad, W - PAD_L + 10, y + lh + row_pad],
            radius=4, fill=ROW_BG
        )
        shadow_text(draw, (PAD_L, y), b_text, f_bullet, WHITE)
        y += row_h + 6
    y += 18

# CTA box
cta_w   = min(TEXT_W, text_w(cta, f_cta) + 64)
cta_h   = line_h(f_cta) + 28
# Don't overflow into footer
if y + cta_h > CONTENT_H - 16:
    y = CONTENT_H - cta_h - 16
draw.rounded_rectangle([PAD_L, y, PAD_L + cta_w, y + cta_h], radius=8, fill=BLUE)
draw.text((PAD_L + 32, y + 14), cta, font=f_cta, fill=WHITE)

# ── Output ────────────────────────────────────────────────────────────────────
out = io.BytesIO()
bg.convert('RGB').save(out, format='PNG', optimize=False)
sys.stdout.buffer.write(out.getvalue())
