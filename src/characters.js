/*
 * Character art (sprite mode)
 * ---------------------------
 * Drop transparent PNGs into public/characters/ named cyan.png and miku.png.
 * If a file exists it replaces the built-in placeholder puppet for that character.
 * If it is missing, the placeholder is used, so the project always runs.
 *
 *   height   how tall the character is on stage, in world units (stage is 1280x720)
 *   feet     where the feet sit inside the image, 0 = top edge, 1 = bottom edge
 *   offsetY  nudge the sprite down (+) or up (-) after anchoring
 *   flip     mirror the image horizontally
 */
export const ART = {
  cyan: { src: 'characters/cyan.png', height: 300, feet: 1, offsetY: 0, flip: false },
  miku: { src: 'characters/miku.png', height: 335, feet: 1, offsetY: 0, flip: false },
};
