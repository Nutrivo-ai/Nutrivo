// Chromium flags that make text rendering the same on every host: no hinting, greyscale antialiasing and an sRGB
// colour profile, whatever the host's fontconfig says. The design baselines were captured with exactly these flags,
// so every screenshot test and every baseline capture launches with them (docs/20 §2, §4).
export const RENDER_ARGS = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"];
