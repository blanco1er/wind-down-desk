"""
Builds the Places panoramas (v5) from the Astra concept images.

  source (equirectangular 2:1, ≈ 1774 × 887 native)
  → 2048 × 1024 (Lanczos)
  → Real-ESRGAN x4plus with 64 px wrapped borders (the AI upscaler sees across the
    left/right seam, so the seam stays continuous) → 8192 × 4096
  → light blend with a Lanczos upscale (tames the painted look of GAN detail)
  → seam: low-frequency colour match of the two edges (ramped over 128 px)
  → poles: horizontal blur that grows like 1/cos(latitude) above 62° (no pinch at
    the zenith/nadir, angular sampling becomes uniform)
  → reprojection to a cylindrical equal-area layout (v = 0.5 − 0.5·sin(latitude)),
    6144 × 2048: full resolution at the horizon (≈ 17 px/° across and up),
    less at the poles where the equirectangular wasted it; the shader samples it
    with v = 0.5 − 0.5·dir.y. Row 0 = zenith (KTX2 textures are not flipped).
  → optional: `cap` mode (see cap_equal_area) for AI ceilings that ring at the zenith
  → PNG for the KTX2 encoder (tools/encode-places.mjs), a 2048 × 1024 equirectangular
    preview and the 384 × 192 menu thumbnail.

Requires numpy + Pillow (a local venv) and realesrgan-ncnn-vulkan (path in $REALESRGAN,
models next to it). Usage: python tools/make-places.py <id> <source.png> <outdir> [blend] [horizon°]
(horizon° = where the source draws its horizon, e.g. 4.2 for 4.2° above the middle row; v8, 18 Oct 2026)
"""
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
W, H = 8192, 4096
PAD = 64  # px of wrap at 2048 width (→ 256 px after ×4)
# Equal-area output: 6144 × 2048 ≈ 17 px/degree both across and up at the horizon (isotropic),
# 6 MiB as ETC1S on the GPU, and exactly the 12.58 Mpix limit of the wasm Basis encoder.
EA_W = 6144


def to_f(img):
    return np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0


def to_img(a):
    return Image.fromarray(np.clip(a * 255.0 + 0.5, 0, 255).astype(np.uint8))


def esrgan(src2048, work):
    padded = np.concatenate([src2048[:, -PAD:], src2048, src2048[:, :PAD]], axis=1)
    inp = os.path.join(work, "in.png")
    out = os.path.join(work, "out.png")
    to_img(padded).save(inp)
    exe = os.environ.get("REALESRGAN", "realesrgan-ncnn-vulkan")
    models = os.path.join(os.path.dirname(exe), "models")
    subprocess.run([exe, "-i", inp, "-o", out, "-n", "realesrgan-x4plus", "-m", models, "-t", "256"], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    up = to_f(Image.open(out))
    return up[:, PAD * 4: PAD * 4 + W]


def box_blur_rows(a, radius):
    """Horizontal box blur with wrap-around, per row, radius in px (array per row)."""
    out = a.copy()
    for y in np.nonzero(radius > 0.5)[0]:
        r = int(min(radius[y], W // 4))
        row = a[y]
        ext = np.concatenate([row[-r - 1:], row, row[:r]], axis=0)
        c = np.cumsum(ext, axis=0)
        out[y] = (c[2 * r + 1:] - c[: -2 * r - 1][: W]) / (2 * r + 1)
    return out


def fix_seam(a, ramp=128):
    left = a[:, :3].mean(axis=1)
    right = a[:, -3:].mean(axis=1)
    d = left - right  # per row
    # smooth vertically so only the low-frequency step is corrected
    k = 31
    pad = np.pad(d, ((k, k), (0, 0)), mode="edge")
    c = np.cumsum(pad, axis=0)
    d = (c[2 * k:] - c[:-2 * k]) / (2 * k)
    d = d[: a.shape[0]]
    w = np.linspace(1.0, 0.0, ramp, dtype=np.float32) ** 2
    a[:, :ramp] -= 0.5 * d[:, None, :] * w[None, :, None]
    a[:, -ramp:] += 0.5 * d[:, None, :] * w[::-1][None, :, None]
    return a


def soften_poles(a, start_deg=62.0, cap_deg=74.0):
    lat = (0.5 - (np.arange(H) + 0.5) / H) * np.pi
    c = np.cos(lat)
    t = np.clip((np.abs(lat) - np.radians(start_deg)) / (np.pi / 2 - np.radians(start_deg)), 0, 1)
    radius = (1.0 / np.maximum(c, 1e-3) - 1.0) * 1.2 * t * t * 3.0
    a = box_blur_rows(a, radius)
    # Near the pole, rows of planks or beams become concentric rings: fade into a soft cap
    # (each row's mean colour, smoothed vertically) so looking straight up shows an even glow.
    mean = a.mean(axis=1)  # (H, 3)
    k = 48
    pad = np.pad(mean, ((k, k), (0, 0)), mode="edge")
    cs = np.cumsum(pad, axis=0)
    mean = ((cs[2 * k:] - cs[:-2 * k]) / (2 * k))[:H]
    x = np.clip((np.abs(lat) - np.radians(cap_deg)) / (np.radians(86.0) - np.radians(cap_deg)), 0, 1)
    f = (x * x * (3 - 2 * x))[:, None, None]
    return a * (1 - f) + mean[:, None, :] * f


def shift_horizon(a, h_deg):
    """Moves an AI panorama's horizon from +h_deg (above eye level) back to 0°.

    Generators often draw the horizon a few degrees off the middle row, which reads as a tilted
    world or a floor that is too close/far once seated. Smooth latitude remap with fixed poles:
    lat_src = lat_out + h·cos²(lat_out) (monotonic for |h| < 30°, no kink at the horizon).
    """
    if abs(h_deg) < 0.05:
        return a
    rows = a.shape[0]
    lat_out = (0.5 - (np.arange(rows) + 0.5) / rows) * np.pi
    lat_src = lat_out + np.radians(h_deg) * np.cos(lat_out) ** 2
    y = np.clip((0.5 - lat_src / np.pi) * rows - 0.5, 0, rows - 1)
    i = np.floor(y).astype(int)
    f = (y - i)[:, None, None].astype(np.float32)
    i1 = np.minimum(i + 1, rows - 1)
    return a[i] * (1 - f) + a[i1] * f


def to_equal_area(a, rows=2048):
    """Area-average source rows into the cylindrical equal-area layout."""
    src_h = a.shape[0]
    integ = np.concatenate([np.zeros((1, a.shape[1], 3), np.float32), np.cumsum(a, axis=0, dtype=np.float32)], axis=0)

    def at(y):  # integral at fractional row position y in [0, src_h]
        y = np.clip(y, 0, src_h)
        i = np.floor(y).astype(int)
        f = (y - i)[:, None, None]
        i1 = np.minimum(i + 1, src_h)
        return integ[i] * (1 - f) + integ[i1] * f

    j = np.arange(rows + 1)
    s = 1.0 - 2.0 * j / rows  # sin(lat) at row boundaries, top = +1
    lat = np.arcsin(np.clip(s, -1, 1))
    y = (0.5 - lat / np.pi) * src_h
    I = at(y)
    span = np.maximum(y[1:] - y[:-1], 1e-6)[:, None, None]
    return ((I[1:] - I[:-1]) / span).astype(np.float32)


def cap_equal_area(ea, start_deg, full_deg, dark, colour=None):
    """Replace the high cap of an equal-area panorama by a soft dome of its own mean colour.

    AI panoramas draw ceiling planks (or star rows) as straight lines up to the pole, which
    wrap into concentric rings when you look up. Above start_deg the image fades into each
    row's mean colour (smoothed, darkened towards the zenith), with a little grain against banding.
    """
    rows = ea.shape[0]
    lat = np.degrees(np.arcsin(1.0 - 2.0 * (np.arange(rows) + 0.5) / rows))
    mean = ea.mean(axis=1)
    k = 24
    pad = np.pad(mean, ((k, k), (0, 0)), mode="edge")
    cs = np.cumsum(pad, axis=0)
    mean = ((cs[2 * k:] - cs[:-2 * k]) / (2 * k))[:rows]
    x = np.clip((lat - start_deg) / (full_deg - start_deg), 0, 1)
    f = x * x * (3 - 2 * x)
    shade = 1.0 - (1.0 - dark) * np.clip((lat - start_deg) / (90.0 - start_deg), 0, 1)
    if colour is not None:
        # v8: a fixed dome colour (e.g. the terrace roof's dark wood) instead of each row's mean, which mixes
        # sky and beams into a muddy blob when the AI drew a sky hole between roof beams.
        mean = np.broadcast_to(np.asarray(colour, np.float32)[None, :], mean.shape)
    dome = mean * shade[:, None]
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 0.6 / 255.0, ea.shape).astype(np.float32)
    out = ea * (1 - f[:, None, None]) + (dome[:, None, :] + grain) * f[:, None, None]
    return out


def ea_to_equirect(ea, w, h):
    """Inverse of to_equal_area (row lookup by sin(latitude)), for previews that match the shipped KTX2 exactly."""
    rows = ea.shape[0]
    lat = np.pi * (0.5 - (np.arange(h) + 0.5) / h)
    y = (0.5 - 0.5 * np.sin(lat)) * rows - 0.5
    i = np.clip(np.floor(y).astype(int), 0, rows - 1)
    f = np.clip(y - i, 0, 1)[:, None, None].astype(np.float32)
    i1 = np.minimum(i + 1, rows - 1)
    out = ea[i] * (1 - f) + ea[i1] * f
    return to_img(out).resize((w, h), Image.LANCZOS)


def main():
    if sys.argv[1] == "previews":
        # python tools/make-places.py previews <final-ea.png> <outdir> <id>  (19 Oct 2026: thumb + 2k from the SAME
        # equal-area image as the KTX2, so the menu, the fallback and the SH light all match what is shown)
        ea = to_f(Image.open(sys.argv[2]))
        outdir, pid = sys.argv[3], sys.argv[4]
        big = ea_to_equirect(ea, ea.shape[1], ea.shape[1] // 2)
        big.resize((2048, 1024), Image.LANCZOS).save(os.path.join(outdir, f"{pid}-2k.jpg"), quality=90)
        big.resize((384, 192), Image.LANCZOS).save(os.path.join(outdir, f"{pid}-thumb.jpg"), quality=86)
        print(outdir, pid)
        return
    if sys.argv[1] == "cap":
        # python tools/make-places.py cap <in-ea.png> <out-ea.png> <start°> <full°> <darken at zenith> [r,g,b 0..1]
        ea = to_f(Image.open(sys.argv[2]))
        colour = [float(c) for c in sys.argv[7].split(",")] if len(sys.argv) > 7 else None
        to_img(cap_equal_area(ea, float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6]), colour)).save(sys.argv[3])
        print(sys.argv[3])
        return
    pid, source, outdir = sys.argv[1], sys.argv[2], sys.argv[3]
    blend = float(sys.argv[4]) if len(sys.argv) > 4 else 0.2
    horizon = float(sys.argv[5]) if len(sys.argv) > 5 else 0.0  # measured horizon elevation, degrees
    os.makedirs(outdir, exist_ok=True)
    src = Image.open(source).convert("RGB").resize((2048, 1024), Image.LANCZOS)
    a2048 = to_f(src)
    with tempfile.TemporaryDirectory() as work:
        up = esrgan(a2048, work)
    lz = to_f(src.resize((W, H), Image.LANCZOS))
    a = (1.0 - blend) * up + blend * lz
    a = fix_seam(a)
    a = shift_horizon(a, horizon)
    a = soften_poles(a)
    to_img(a).resize((2048, 1024), Image.LANCZOS).save(os.path.join(outdir, f"{pid}-equirect-2k.jpg"), quality=90)
    to_img(a).resize((384, 192), Image.LANCZOS).save(os.path.join(outdir, f"{pid}-thumb.jpg"), quality=86)
    ea = to_img(to_equal_area(a)).resize((EA_W, 2048), Image.LANCZOS)
    ea.save(os.path.join(outdir, f"{pid}-ea.png"))
    print(os.path.join(outdir, f"{pid}-ea.png"))


if __name__ == "__main__":
    main()
