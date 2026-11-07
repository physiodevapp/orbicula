"""Vídeos sintéticos para probar la app en Chromium con una cámara simulada (ver docs/desarrollo.md).

Descarga la foto de ejemplo de MediaPipe (no se guarda en el repo) y genera en OUTDIR:
  portrait.y4m  la foto entera (cara pequeña), 4 s
  crop.y4m      la cara ampliada (720×720, ojo de ~72 px), 4 s
  blink.y4m     la cara ampliada con guiños sintéticos (16 s, se repite en bucle):
                ojo de la IZQUIERDA de la imagen (= derecho del paciente, frames sin espejo)
                a los 3, 6 y 9 s, y el otro ojo a los 12 s.
  nod.y4m       cabeceo sin contracción (16 s): toda la cara sube y baja hasta 6 px (periodo 3 s)
                de 4 a 12 s; quieta el resto. Con la compensación, el flujo de los párpados no
                debería subir (criterio 4).
  lid.y4m       movimiento fino del párpado superior (16 s): baja 1,5 px durante 1,5 s, a los 3 s
                en el ojo de la izquierda de la imagen (derecho del paciente), a los 7 s en el otro
                y a los 11 s en los dos. El EAR apenas lo nota; el flujo debería verlo (criterio 3).

Uso:  python3 -I scripts/dev/make-face-videos.py /ruta/de/salida
Necesita: Pillow, numpy y ffmpeg.
"""
import os
import subprocess
import sys
import urllib.request

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PORTRAIT_URL = "https://storage.googleapis.com/mediapipe-assets/portrait.jpg"
FPS = 30
# Centros de los ojos en la cara ampliada de 720×720 (medidos sobre las ROI dibujadas).
EYES = {"image_left": (236, 313), "image_right": (438, 313)}
HALF_W, HALF_H = 50, 21
# (ojo, inicio en s, frames de bajada, frames cerrado, frames de subida)
BLINKS = [("image_left", 3.0, 4, 6, 4), ("image_left", 6.0, 4, 6, 4), ("image_left", 9.0, 4, 6, 4), ("image_right", 12.0, 4, 6, 4)]


def y4m(frames_pattern, out, seconds=None, loop_image=None):
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if loop_image:
        cmd += ["-loop", "1", "-i", loop_image, "-t", str(seconds), "-r", str(FPS)]
    else:
        cmd += ["-framerate", str(FPS), "-i", frames_pattern]
    cmd += ["-pix_fmt", "yuv420p", out]
    subprocess.run(cmd, check=True)


def closure(eye, f):
    k = 0.0
    for e, t0, down, hold, up in BLINKS:
        if e != eye:
            continue
        s = round(t0 * FPS)
        if s <= f < s + down:
            k = max(k, (f - s + 1) / down)
        elif s + down <= f < s + down + hold:
            k = 1.0
        elif s + down + hold <= f < s + down + hold + up:
            k = max(k, 1 - (f - (s + down + hold) + 1) / up)
    return k


def paint(img, src, eye, k):
    """Cierra el ojo pegando piel de la mejilla de arriba abajo y una línea de pestañas."""
    if k <= 0:
        return
    cx, cy = EYES[eye]
    box = (cx - HALF_W, cy - HALF_H - 4, cx + HALF_W, cy + HALF_H + 4)
    patch = src.crop((box[0], box[1] + 62, box[2], box[3] + 62))
    h = patch.size[1]
    mask = Image.new("L", patch.size, 0)
    ImageDraw.Draw(mask).ellipse((2, 0, patch.size[0] - 2, h), fill=255)
    cover = Image.new("L", patch.size, 0)
    ImageDraw.Draw(cover).rectangle((0, 0, patch.size[0], int(h * k)), fill=255)
    mask = Image.composite(mask, Image.new("L", patch.size, 0), cover).filter(ImageFilter.GaussianBlur(2))
    img.paste(patch, box[:2], mask)
    y = box[1] + int(h * k) - 2
    ImageDraw.Draw(img).line((cx - 40, y, cx + 40, y), fill=(40, 28, 24), width=3)


def face_at(portrait_img, dy):
    """La cara ampliada (como crop.jpg) desplazada dy px hacia abajo, con interpolación subpíxel."""
    # Píxel de salida (x, y) ← píxel de origen (240 + x/2, 10 + (y − dy)/2): el recorte de crop.jpg.
    return portrait_img.transform((720, 720), Image.AFFINE, (0.5, 0, 240, 0, 0.5, 10 - dy * 0.5), resample=Image.BICUBIC)


def nod_offset(t):
    return 6 * math.sin(2 * math.pi * (t - 4) / 3) if 4 <= t < 12 else 0.0


# (ojos, inicio en s): el párpado superior baja LID_PX durante LID_HOLD s, con rampas de 4 frames.
LIDS = [(("image_left",), 3.0), (("image_right",), 7.0), (("image_left", "image_right"), 11.0)]
LID_PX = 1.5
LID_HOLD = 1.5


def lid_amount(eye, t):
    k = 0.0
    ramp = 4 / FPS
    for eyes, t0 in LIDS:
        if eye not in eyes:
            continue
        if t0 <= t < t0 + ramp:
            k = max(k, (t - t0) / ramp)
        elif t0 + ramp <= t < t0 + ramp + LID_HOLD:
            k = 1.0
        elif t0 + ramp + LID_HOLD <= t < t0 + 2 * ramp + LID_HOLD:
            k = max(k, 1 - (t - t0 - ramp - LID_HOLD) / ramp)
    return k


def move_lid(arr, eye, d):
    """Desplaza hacia abajo d px el párpado superior (franja sobre el centro del ojo), con bordes suaves."""
    if d <= 0:
        return
    cx, cy = EYES[eye]
    x0, x1, y0, y1 = cx - 60, cx + 60, cy - 40, cy + 6
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    # Ventana suave: 1 en el centro del párpado y 0 en los bordes de la franja.
    wx = 0.5 - 0.5 * np.cos(2 * np.pi * (xs - x0) / (x1 - x0))
    wy = 0.5 - 0.5 * np.cos(2 * np.pi * (ys - y0) / (y1 - y0))
    src_y = ys - d * wx * wy
    lo = np.floor(src_y).astype(int)
    f = (src_y - lo)[..., None]
    patch = arr[lo, xs.astype(int)] * (1 - f) + arr[lo + 1, xs.astype(int)] * f
    arr[y0:y1, x0:x1] = patch


def main(out):
    os.makedirs(out, exist_ok=True)
    portrait = os.path.join(out, "portrait.jpg")
    if not os.path.exists(portrait):
        urllib.request.urlretrieve(PORTRAIT_URL, portrait)
    y4m(None, os.path.join(out, "portrait.y4m"), seconds=4, loop_image=portrait)

    crop = Image.open(portrait).convert("RGB").crop((240, 10, 600, 370)).resize((720, 720))
    crop_path = os.path.join(out, "crop.jpg")
    crop.save(crop_path)
    y4m(None, os.path.join(out, "crop.y4m"), seconds=4, loop_image=crop_path)

    frames = os.path.join(out, "frames")
    os.makedirs(frames, exist_ok=True)
    for f in range(FPS * 16):
        img = crop.copy()
        for eye in EYES:
            paint(img, crop, eye, closure(eye, f))
        img.save(os.path.join(frames, f"f{f:04d}.png"))
    y4m(os.path.join(frames, "f%04d.png"), os.path.join(out, "blink.y4m"))

    src = Image.open(portrait).convert("RGB")
    for name, make in (
        ("nod", lambda t: face_at(src, nod_offset(t))),
        ("lid", lambda t: lid_frame(crop, t)),
    ):
        for f in range(FPS * 16):
            make(f / FPS).save(os.path.join(frames, f"f{f:04d}.png"))
        y4m(os.path.join(frames, "f%04d.png"), os.path.join(out, f"{name}.y4m"))
    print(f"Vídeos en {out}: portrait.y4m, crop.y4m, blink.y4m, nod.y4m, lid.y4m")


def lid_frame(crop, t):
    arr = np.asarray(crop, dtype=np.float32).copy()
    base = arr.copy()
    for eye in EYES:
        d = LID_PX * lid_amount(eye, t)
        if d > 0:
            part = base.copy()
            move_lid(part, eye, d)
            cx, cy = EYES[eye]
            arr[cy - 40:cy + 6, cx - 60:cx + 60] = part[cy - 40:cy + 6, cx - 60:cx + 60]
    return Image.fromarray(np.clip(arr + 0.5, 0, 255).astype(np.uint8))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
