/**
 * Bundled typefaces (SIL OFL, see assets/fonts/LICENSE.txt). Canvas text uses
 * these once loaded; system fonts are the fallback, so nothing breaks offline.
 */
export const FONT_DISPLAY = '"Unbounded", "Arial Black", system-ui, sans-serif';
export const FONT_UI = '"Chakra Petch", "Segoe UI", system-ui, sans-serif';

/** Resolve when the fonts are ready (or after a short timeout). Never rejects. */
export function loadFonts(doc, timeoutMs = 1500) {
  if (!doc || !doc.fonts || !doc.fonts.load) return Promise.resolve(false);
  const wanted = [`800 32px "Unbounded"`, `italic 800 32px "Unbounded"`, `600 16px "Chakra Petch"`, `700 16px "Chakra Petch"`];
  const all = Promise.all(wanted.map((f) => doc.fonts.load(f))).then(() => true, () => false);
  const timeout = new Promise((r) => setTimeout(() => r(false), timeoutMs));
  return Promise.race([all, timeout]);
}
