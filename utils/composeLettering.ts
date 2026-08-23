/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Burn hand-placed lettering into a panel image.
 *
 * Speech bubbles and sound effects are stored as coordinates on the page and
 * drawn as an overlay in the reader. Export writes pixels, so those overlays
 * have to be composited in — otherwise a page looks right on screen and exports
 * without the corrections the user made, which is worse than not offering the
 * editors at all.
 *
 * Positions are percentages of the panel, so the same data composites correctly
 * at any output resolution.
 */

import type { PlacedSFX, SpeechBubble } from '../types';
import { renderBubbleToSVG } from './bubbleRenderer';
import { renderSFXToContext, type SFXElement } from './sfxRenderer';

/** Load a data URL into an Image the canvas can draw. */
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src;
  });

/**
 * Rasterise every bubble into one transparent layer the size of the panel.
 *
 * Each bubble renders to SVG individually; they are wrapped in a single root so
 * the browser decodes one image instead of one per bubble.
 */
async function renderBubbleLayer(
  bubbles: SpeechBubble[],
  width: number,
  height: number,
): Promise<HTMLImageElement | null> {
  if (bubbles.length === 0) return null;

  const ordered = [...bubbles].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
  const inner = ordered
    .map(b => renderBubbleToSVG(b, { panelWidth: width, panelHeight: height }))
    .join('');

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}">${inner}</svg>`;

  // encodeURIComponent rather than btoa: bubble text is user-supplied and may
  // contain characters outside Latin-1, which btoa cannot encode.
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    return await loadImage(url);
  } catch {
    console.warn('[lettering] bubble layer failed to rasterise; exporting without bubbles');
    return null;
  }
}

/** Convert a stored placement into the shape the SFX renderer expects. */
type SFXConverter = (placed: PlacedSFX) => SFXElement | null;

export interface ComposeOptions {
  /** Panel artwork as a data URL. */
  imageUrl: string;
  bubbles?: SpeechBubble[];
  sfx?: PlacedSFX[];
  /**
   * Converts a PlacedSFX to a renderable element. Injected because the mapping
   * lives with the editor, and this module stays free of UI imports.
   */
  toSFXElement: SFXConverter;
  /** Output format. Defaults to PNG to avoid recompressing artwork. */
  mimeType?: string;
  quality?: number;
}

/**
 * Return the panel with its lettering burned in.
 *
 * Never throws and never returns nothing: if compositing fails for any reason,
 * the original artwork comes back unchanged. Losing a speech bubble in an export
 * is a disappointment; losing the page is a broken export.
 */
export async function composeLettering(options: ComposeOptions): Promise<string> {
  const { imageUrl, bubbles = [], sfx = [], toSFXElement, mimeType = 'image/png', quality } = options;

  if (bubbles.length === 0 && sfx.length === 0) return imageUrl;

  try {
    const base = await loadImage(imageUrl);
    const canvas = document.createElement('canvas');
    canvas.width = base.naturalWidth;
    canvas.height = base.naturalHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return imageUrl;

    ctx.drawImage(base, 0, 0);

    // SFX underneath bubbles: lettering should stay readable over impact art.
    for (const placed of sfx) {
      const element = toSFXElement(placed);
      if (element) renderSFXToContext(ctx, element, canvas.width, canvas.height);
    }

    const bubbleLayer = await renderBubbleLayer(bubbles, canvas.width, canvas.height);
    if (bubbleLayer) ctx.drawImage(bubbleLayer, 0, 0);

    return canvas.toDataURL(mimeType, quality);
  } catch (e) {
    console.warn('[lettering] compositing failed; exporting the original artwork', e);
    return imageUrl;
  }
}

/** True when a page carries lettering that export needs to composite. */
export const hasLettering = (face: { bubbles?: SpeechBubble[]; sfx?: PlacedSFX[] }): boolean =>
  Boolean(face.bubbles?.length || face.sfx?.length);
