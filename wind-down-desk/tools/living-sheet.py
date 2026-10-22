"""Contact sheet of living-places captures (tools/living-places.mjs), one labelled tile per image.

  python tools/living-sheet.py <out.jpg> <title> <tile width> <columns> <img1>[=label] <img2>[=label] ...
Needs Pillow. Labels are drawn with the system font if available (Helvetica on macOS), else the default.
"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, title, tw, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
items = []
for a in sys.argv[5:]:
    path, _, label = a.partition('=')
    items.append((path, label or path.rsplit('/', 1)[-1].rsplit('.', 1)[0]))


def font(size):
    for f in ('/System/Library/Fonts/Helvetica.ttc', '/System/Library/Fonts/SFNS.ttf'):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


tiles = []
for path, label in items:
    im = Image.open(path).convert('RGB')
    th = round(im.height * tw / im.width)
    tiles.append((im.resize((tw, th), Image.LANCZOS), label))
rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
pad, lab, head = 12, 30, 56
H = head + sum(max(t[0].height for t in r) + lab + pad for r in rows) + pad
W = pad + cols * (tw + pad)
sheet = Image.new('RGB', (W, H), (18, 19, 22))
d = ImageDraw.Draw(sheet)
d.text((pad, 14), title, fill=(236, 236, 240), font=font(26))
y = head
for r in rows:
    x = pad
    for im, label in r:
        sheet.paste(im, (x, y + lab))
        d.text((x + 2, y + 5), label, fill=(200, 200, 208), font=font(18))
        x += tw + pad
    y += max(t[0].height for t in r) + lab + pad
sheet.save(out, quality=88)
print(out, sheet.size)
