/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Character model sheet generation — the "Phase 0 casting" step.
 *
 * Why this exists:
 * Generating a page directly from a user's uploaded photo asks the image model
 * to solve three hard problems at once — convert a photograph into the target
 * comic art style, re-pose the subject, and compose a scene around them. The
 * first of those is re-solved independently on every page, which is the dominant
 * source of face drift across an issue: each page is a fresh roll of the dice on
 * "what does this person look like as a comic character?"
 *
 * A model sheet solves style transfer exactly once. Every later page then does
 * the much easier job of posing an already-stylised, already-known character.
 * It also gives the model several angles and expressions, so profile shots and
 * emotional beats stop being improvised, and — unlike a phone photo — the sheet
 * is in-distribution for the model that will draw the pages.
 *
 * Secondary benefit: it fails fast and cheap. The user approves the character's
 * look for the price of one image, instead of discovering it after 24 pages.
 */

import { GoogleGenAI } from '@google/genai';
import {
  CharacterProfile,
  Persona,
  formatCanonicalCharacter,
} from '../types';
import { detectImageMimeType } from '../claudeHelpers';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useMetricsStore } from '../stores/useMetricsStore';

const MODEL_IMAGE_GEN_NAME = 'gemini-3-pro-image-preview';
const TIMEOUT_MS = 120_000;

export interface GenerateModelSheetConfig {
  getAI: () => GoogleGenAI;
  onAPIError: (e: unknown) => void;
}

export interface GenerateModelSheetParams {
  persona: Persona;
  /** Target art style — the sheet is only valid for the style it was drawn in. */
  artStyle: string;
  /** Analysed profile, used for the canonical descriptor. */
  profile?: CharacterProfile;
  /** Extra direction from the user, e.g. "make the jacket longer". */
  instruction?: string;
}

export interface ModelSheetResult {
  /** data: URL of the generated sheet, or '' on failure. */
  imageUrl: string;
  prompt: string;
  failureReason?: 'safety' | 'rate_limit' | 'quota' | 'content_policy' | 'timeout' | 'api_key' | 'unknown';
}

/**
 * True when a persona's stored model sheet is usable for the given art style.
 * Sheets are style-specific: a noir sheet is worse than useless for manga pages.
 */
export const hasValidModelSheet = (persona: Persona, artStyle: string): boolean =>
  Boolean(persona.modelSheet) && persona.modelSheetStyle === artStyle;

export const useGenerateModelSheet = (config: GenerateModelSheetConfig) => {
  const { getAI, onAPIError } = config;

  const generateModelSheet = async (
    params: GenerateModelSheetParams,
  ): Promise<ModelSheetResult> => {
    const { persona, artStyle, profile, instruction } = params;
    const startTime = Date.now();
    const { imageResolution = '1k' } = useSettingsStore.getState();
    // A 16:9 sheet carries three full-body views plus expression studies, so at
    // 1K each individual face lands on very few pixels — which then propagates
    // to every page that uses the sheet as its face reference. This is a
    // once-per-character cost, so never render it below 2K.
    const sheetResolution = imageResolution === '4k' ? '4K' : '2K';

    const name = persona.name || 'the character';
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    const pushImage = (b64: string) => {
      const data = b64.includes(',') ? b64.split(',')[1] : b64;
      contents.push({ inlineData: { mimeType: detectImageMimeType(data), data } });
    };

    // ---- Source material -----------------------------------------------------
    contents.push({
      text:
        `Reference photographs and artwork of ${name}. ` +
        `Use these for facial structure, hair, skin tone, and costume design. ` +
        `The output must be a redrawing of THIS person, not a generic character.`,
    });

    if (persona.base64) {
      contents.push({ text: `${name} — primary portrait:` });
      pushImage(persona.base64);
    }

    const refs = persona.referenceImages || (persona.referenceImage ? [persona.referenceImage] : []);
    // More references help here (unlike per-page generation) because this single
    // call is where costume detail gets locked in for the whole issue.
    refs.slice(0, 4).forEach((ref, i) => {
      contents.push({ text: `${name} — costume reference ${i + 1}:` });
      pushImage(ref);
    });

    if (persona.emblemImage) {
      const placement = persona.emblemPlacement === 'other'
        ? persona.emblemPlacementCustom || 'a visible location'
        : persona.emblemPlacement?.replace(/-/g, ' ') || 'a visible location';
      contents.push({
        text: `${name}'s emblem — reproduce its exact geometry and colors, placed on ${placement}:`,
      });
      pushImage(persona.emblemImage);
    }

    if (persona.weaponImage) {
      contents.push({
        text: `${name}'s ${persona.weaponDescriptionText || 'signature weapon'} — include it in the sheet:`,
      });
      pushImage(persona.weaponImage);
    }

    // ---- The brief -----------------------------------------------------------
    const descriptor = profile
      ? formatCanonicalCharacter(profile, persona.role || undefined)
      : `${name.toUpperCase()}${persona.desc ? ` — ${persona.desc}` : ''}`;

    const promptText = [
      `Draw a CHARACTER MODEL SHEET for ${name}, in ${artStyle} style.`,
      ``,
      descriptor,
      ``,
      `LAYOUT — one image containing, left to right:`,
      `1. Full body, front view, standing in a relaxed neutral pose, arms at sides.`,
      `2. Full body, three-quarter view.`,
      `3. Full body, side profile.`,
      `4. Three head-and-shoulders studies: neutral, determined, and surprised.`,
      ``,
      `REQUIREMENTS:`,
      `- All views are unmistakably the SAME person: identical face, hair, skin tone, costume, and proportions.`,
      `- Keep every figure at consistent scale, feet on a common baseline.`,
      `- Plain flat light-grey background. No scenery, no props beyond the character's own gear, no panel borders.`,
      `- Even, neutral lighting so colors read true. No dramatic shadow.`,
      `- Full costume detail — every emblem, seam, buckle, and accessory visible and consistent across views.`,
      `- Draw no text, labels, arrows, or captions anywhere in the image.`,
      instruction ? `- User direction, follow precisely: "${instruction}"` : '',
      ``,
      `This sheet is the definitive visual reference for every page of the comic. ` +
      `Accuracy to the reference photographs matters more than dramatic styling.`,
    ].filter(Boolean).join('\n');

    contents.push({ text: promptText });

    // ---- Generate ------------------------------------------------------------
    try {
      const ai = getAI();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('GENERATION_TIMEOUT')), TIMEOUT_MS),
      );

      const res = await Promise.race([
        ai.models.generateContent({
          model: MODEL_IMAGE_GEN_NAME,
          contents,
          config: {
            imageConfig: {
              // Model sheets are wide by nature — several figures side by side.
              aspectRatio: '16:9',
              imageSize: sheetResolution,
            },
          },
        }),
        timeout,
      ]);

      const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      const imageUrl = part?.inlineData?.data
        ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
        : '';

      if (!imageUrl) {
        const finish = res.candidates?.[0]?.finishReason;
        const failureReason =
          finish === 'SAFETY' || finish === 'BLOCKLIST' ? 'safety' :
          finish === 'PROHIBITED_CONTENT' ? 'content_policy' : 'unknown';
        console.warn(`[modelSheet] Empty response for ${name}:`, { finish });
        useMetricsStore.getState().recordGeneration('image', false, Date.now() - startTime, 'gemini');
        return { imageUrl: '', prompt: promptText, failureReason };
      }

      console.log(`[modelSheet] Generated for ${name} in ${Date.now() - startTime}ms`);
      useMetricsStore.getState().recordGeneration('image', true, Date.now() - startTime, 'gemini');
      return { imageUrl, prompt: promptText };
    } catch (e) {
      console.error(`[modelSheet] Failed for ${name}:`, e);
      onAPIError(e);
      const msg = String(e).toLowerCase();
      const failureReason: ModelSheetResult['failureReason'] =
        msg.includes('generation_timeout') ? 'timeout' :
        msg.includes('rate') || msg.includes('429') ? 'rate_limit' :
        msg.includes('quota') || msg.includes('resource exhausted') ? 'quota' :
        msg.includes('safety') || msg.includes('blocked') ? 'safety' :
        msg.includes('permission') || msg.includes('invalid') ? 'api_key' : 'unknown';
      useMetricsStore.getState().recordGeneration('image', false, Date.now() - startTime, 'gemini');
      return { imageUrl: '', prompt: promptText, failureReason };
    }
  };

  return { generateModelSheet };
};

export default useGenerateModelSheet;
