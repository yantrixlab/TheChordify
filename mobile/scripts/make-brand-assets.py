"""Makes every logo and icon of Chord Suno from one picture: mobile/store/brand/pick-512.png (the guitar pick with a chord diagram, on a
transparent background). Run it from anywhere (needs Pillow):

    python mobile/scripts/make-brand-assets.py

It writes:
  Android   the adaptive launcher icon (foreground, themed/monochrome, legacy square and round), the splash icon
  Play      mobile/store/play-icon-512.png and play-feature-graphic-1024x500.png
  Website   favicon.ico, favicon-48.png, icon-192.png, icon-512.png, apple-touch-icon.png, logo-mark.png and og-image.png

The picture is only 512 px, so nothing here is drawn larger than about 420 px tall; a bigger or vector original would be crisper.
"""

import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "mobile", "store", "brand", "pick-512.png")
RES = os.path.join(ROOT, "mobile", "android", "app", "src", "main", "res")
WEB = os.path.join(ROOT, "absolute-ablation", "public")
STORE = os.path.join(ROOT, "mobile", "store")

INK = (28, 24, 20)  # warm charcoal, the app's top bar and the icon's background
AMBER = (180, 83, 9)
MUTE = (106, 97, 88)
FONTS = "C:/Windows/Fonts/"


def font(name, size):
    for candidate in (FONTS + name, FONTS + "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.load_default()


source = Image.open(SRC).convert("RGBA")
box = source.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
pick = source.crop(box)  # the pick, tight


def scaled(image, height):
    return image.resize((max(1, round(image.width * height / image.height)), height), Image.LANCZOS)


def canvas(size, fraction, background=None, image=None, dy=0.0):
    """A square `size` picture with the pick `fraction` of its height, centred (and `dy` of the size lower), on `background` or transparent."""
    out = Image.new("RGBA", (size, size), background + (255,) if background else (0, 0, 0, 0))
    art = scaled(image or pick, round(size * fraction))
    out.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2 + round(size * dy)))
    return out


def mono(image):
    """The pick as one shape for themed icons: the wood stays, the guitar drawn on it (the dark parts) is cut out."""
    r, g, b, a = image.split()
    light = Image.merge("RGB", (r, g, b)).convert("L").point(lambda v: max(0, min(255, round((v - 60) * 255 / 50))))
    alpha = Image.eval(a, lambda v: v)
    from PIL import ImageChops

    out = Image.new("RGBA", image.size, (255, 255, 255, 0))
    out.putalpha(ImageChops.multiply(alpha, light))
    return out


def save(image, *path):
    full = os.path.join(*path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    image.save(full, optimize=True)
    print("wrote", os.path.relpath(full, ROOT), image.size)


# ---------------------------------------------------------------------------------------------------------------- Android
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
pick_mono = mono(pick)
for name, k in DENSITIES.items():
    folder = os.path.join(RES, f"mipmap-{name}")
    # adaptive icon layers: 108 dp, and only the middle 66 dp is sure to be seen, so the pick stays inside that
    save(canvas(round(108 * k), 0.52), folder, "ic_launcher_foreground.png")
    save(canvas(round(108 * k), 0.52, image=pick_mono), folder, "ic_launcher_monochrome.png")
    # the old square and round icons (Android 7)
    size = round(48 * k)
    square = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    ImageDraw.Draw(square).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * 0.2), fill=INK + (255,))
    square.alpha_composite(canvas(size * 4, 0.66))
    save(square.resize((size, size), Image.LANCZOS), folder, "ic_launcher.png")
    disc = Image.new("RGBA", (size * 4, size * 4), (0, 0, 0, 0))
    ImageDraw.Draw(disc).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=INK + (255,))
    disc.alpha_composite(canvas(size * 4, 0.58))
    save(disc.resize((size, size), Image.LANCZOS), folder, "ic_launcher_round.png")

# the system splash screen shows the icon inside a circle two thirds as wide as the picture
save(canvas(720, 0.5), RES, "drawable-nodpi", "splash_icon.png")

# ------------------------------------------------------------------------------------------------------------------- Play
save(canvas(512, 0.68, background=INK), STORE, "play-icon-512.png")


def backdrop(width, height, glow_at):
    """Warm paper with a soft amber glow behind where the pick sits."""
    base = Image.new("RGBA", (width, height), (248, 243, 234, 255))
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    gx, gy, gr = glow_at
    ImageDraw.Draw(glow).ellipse((gx - gr, gy - gr, gx + gr, gy + gr), fill=(255, 208, 140, 85))
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(gr * 0.5)))
    return base


def lockup(image, centre_x, top, mark_height, text_size):
    """The pick and "Chord Suno" side by side, centred on centre_x, the mark `top` px from the top. Returns the bottom."""
    art = scaled(pick, mark_height)
    f = font("segoeuib.ttf", text_size)
    draw = ImageDraw.Draw(image)
    chord, suno, gap = "Chord", "Suno", round(text_size * 0.22)
    w_chord, w_suno = draw.textlength(chord, font=f), draw.textlength(suno, font=f)
    total = art.width + round(text_size * 0.3) + w_chord + gap + w_suno
    x = centre_x - total / 2
    image.alpha_composite(art, (round(x), top))
    x += art.width + round(text_size * 0.3)
    cap = f.getbbox("Chord")[3]
    y = top + (mark_height - cap) / 2 - f.getbbox("C")[1] * 0.35
    draw.text((x, y), chord, font=f, fill=INK + (255,))
    draw.text((x + w_chord + gap, y), suno, font=f, fill=AMBER + (255,))
    return top + mark_height


def card(width, height, mark_top, mark_height, text_size, tag_y, tag_size, sub_y, sub_size, sub):
    image = backdrop(width, height, (width // 2 - round(mark_height * 1.5), mark_top + mark_height // 2, round(mark_height * 0.9)))
    lockup(image, width // 2, mark_top, mark_height, text_size)
    draw = ImageDraw.Draw(image)
    for text, y, size, name, fill in (("Hear every chord. Play every song.", tag_y, tag_size, "segoeuib.ttf", INK), (sub, sub_y, sub_size, "segoeui.ttf", MUTE)):
        f = font(name, size)
        draw.text(((width - draw.textlength(text, font=f)) / 2, y), text, font=f, fill=fill + (255,))
    return image.convert("RGB")


save(card(1024, 500, 62, 190, 96, 288, 42, 352, 25, "Chords for any song, for guitar and ukulele"), STORE, "play-feature-graphic-1024x500.png")

# -------------------------------------------------------------------------------------------------------------------- Web
save(card(1200, 630, 96, 236, 118, 380, 52, 456, 29, "Chords for any song, for guitar, piano, ukulele and mandolin"), WEB, "og-image.png")
for size in (48, 192, 512):
    save(canvas(size, 0.92), WEB, "favicon-48.png" if size == 48 else f"icon-{size}.png")
save(canvas(180, 0.66, background=INK), WEB, "apple-touch-icon.png")
save(scaled(pick, 192), WEB, "logo-mark.png")
ico = [canvas(s, 0.94) for s in (64, 48, 32, 16)]
ico[0].save(os.path.join(WEB, "favicon.ico"), sizes=[(64, 64), (48, 48), (32, 32), (16, 16)], append_images=ico[1:])
print("wrote", os.path.relpath(os.path.join(WEB, "favicon.ico"), ROOT))
