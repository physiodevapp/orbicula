"""Vídeos sintéticos para probar la app en Chromium con una cámara simulada (ver docs/desarrollo.md).

Descarga la foto de ejemplo de MediaPipe (no se guarda en el repo) y genera en OUTDIR:
  portrait.y4m  la foto entera (cara pequeña), 4 s
  crop.y4m      la cara ampliada (720×720, ojo de ~72 px), 4 s
  blink.y4m     la cara ampliada con guiños sintéticos (16 s, se repite en bucle):
                ojo de la IZQUIERDA de la imagen (= derecho del paciente, frames sin espejo)
                a los 3, 6 y 9 s, y el otro ojo a los 12 s.

Uso:  python3 -I scripts/dev/make-face-videos.py /ruta/de/salida
Necesita: Pillow y ffmpeg.
"""
import os
import subprocess
import sys
import urllib.request

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
    print(f"Vídeos en {out}: portrait.y4m, crop.y4m, blink.y4m")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
