# NintPlex covers (handoff 5A / 5B)

Rendered, not hand-drawn: `banner.html` and `poster.html` are the
sources, screenshotted with Chromium at the handoff's author sizes.
Re-render after editing either file:

    npx playwright screenshot --viewport-size=1600,900 \
      "file://$PWD/banner.html" ../../public/assets/images/nintplex-cover-banner.png
    npx playwright screenshot --viewport-size=600,900 \
      "file://$PWD/poster.html" ../../public/assets/images/nintplex-cover-poster.png

Both files lay the composition out at the handoff's *display* size
(800x450 / 400x600) and scale it up with a transform, so every number in
the CSS is the number the spec gives.

Anton and Battambang must be installed as system TTFs for this to render
correctly — Chromium will not use a woff2 as a system font, and without
Battambang the Khmer comes out unshaped.

## Known limit

The source art (`art.jpg`) is 394x778. The banner upscales it about 2x,
so the exports are soft if you look closely. A larger original is the
only fix; nothing in the CSS can recover detail that isn't there.

## Deviation from the spec

The spec softens the panel/art seam with two scrims, but its 90deg scrim
is already fully transparent before it reaches the art's left edge, so
the edge stayed visible as a hard vertical cut. The art is 470px wide
here (not 420) and carries a mask that dissolves its own left edge into
the panel.
