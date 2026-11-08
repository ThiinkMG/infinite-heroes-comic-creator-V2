/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Turns a Gemini API error into a sentence a user can act on.
 *
 * Single Image Mode used to show `String(error)`, which is the raw JSON body
 * ("ApiError: {"error":{"code":404,...}}"). Users can't do anything with that.
 */
export const describeImageError = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const code = Number(text.match(/"code"\s*:\s*(\d{3})/)?.[1] ?? text.match(/\b(4\d\d|5\d\d)\b/)?.[1]);

  if (/NOT_FOUND|not found for API version|not supported for predict/i.test(text) || code === 404) {
    return 'The image model could not be found for this API key. Check the key in Settings, or the model may have been renamed.';
  }
  if (/API key not valid|API_KEY_INVALID|PERMISSION_DENIED|UNAUTHENTICATED/i.test(text) || code === 401 || code === 403) {
    return 'Your Gemini API key was rejected. Check it in Settings.';
  }
  if (/RESOURCE_EXHAUSTED|quota/i.test(text) || code === 429) {
    return 'Rate limit or quota reached. Wait a minute and try again.';
  }
  if (/SAFETY|PROHIBITED|blocked/i.test(text)) {
    return 'The image was blocked by the safety filter. Try rewording the description.';
  }
  if (code >= 500 || /UNAVAILABLE|INTERNAL|overloaded/i.test(text)) {
    return 'Gemini is busy or had an error. Try again in a moment.';
  }
  return 'Image generation failed. Try again, or simplify the description.';
};
