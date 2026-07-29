/**
 * Card cover art.
 *
 * The mockup gives every course a studio-drawn cover. Nothing in this product
 * has one, and generating an image would be a claim about content it cannot
 * support — so a material gets a gradient derived from its id instead. It is
 * stable (the same material always looks the same), decorative, and carries no
 * information, which is why every element using it is `aria-hidden`.
 */

/** Hues chosen to sit beside the lime accent without competing with it. */
const HUES = [86, 152, 199, 238, 268, 22];

export function coverFor(materialId: string): string {
  const hue = HUES[hash(materialId) % HUES.length] ?? HUES[0];

  return `linear-gradient(135deg, hsl(${hue} 46% 32%), hsl(${(hue as number) + 18} 52% 22%))`;
}

/** FNV-1a, so the mapping is stable across reloads and machines. */
function hash(value: string): number {
  let result = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }

  return Math.abs(result);
}
