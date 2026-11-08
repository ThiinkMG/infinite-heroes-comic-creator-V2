/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every AI model ID the app calls, in one place.
 *
 * These were hardcoded separately in five hooks plus App.tsx, so a model being
 * renamed or retired meant hunting down each copy. Change a model here and
 * nowhere else.
 */

/**
 * Image generation: pages, covers, model sheets, Single Image Mode.
 * Gemini 3 Pro Image ("Nano Banana Pro"), stable (GA) ID. The app previously used
 * the preview ID `gemini-3-pro-image-preview`. Preview IDs are retired after the
 * stable release, and Google's pricing page lists only the stable name.
 *
 * Gemini image models are called with `ai.models.generateContent`, never
 * `generateImages`. That method is Imagen's "predict" endpoint, which returns a
 * 404 for Gemini models.
 */
export const IMAGE_MODEL = 'gemini-3-pro-image';

/** Gemini text model: fallback writer when Claude is unavailable or errors. */
export const GEMINI_TEXT_MODEL = 'gemini-2.5-pro';

/** Gemini vision model for the visual QA fallback. */
export const GEMINI_VISION_MODEL = 'gemini-2.5-pro';

/** Claude: primary writer (beats, outlines, profiles) and QA vision scorer. */
export const CLAUDE_TEXT_MODEL = 'claude-sonnet-4-5-20250929';
