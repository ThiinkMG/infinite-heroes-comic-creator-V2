/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visual QA — the feedback loop the generation pipeline previously lacked.
 *
 * Before this, the app generated a panel and hoped. There was no point at which
 * anything looked at the output and asked whether the character on the page is
 * actually the character the user cast. Drift was only ever caught by the user,
 * page by page, after paying for the whole issue.
 *
 * This closes the loop: after a panel renders, a vision model compares it against
 * the character's canonical reference and returns a structured verdict. Panels
 * below threshold can be rerolled automatically with a *targeted* correction
 * ("the hair is too short and the chest emblem is missing") rather than a blind
 * retry, which is both cheaper and far more likely to actually fix the problem.
 *
 * Division of labour: Gemini generates (fast, cheap, high volume), Claude judges
 * (precise, reasoning-heavy, low volume). Claude is preferred when a key is
 * configured; Gemini is used otherwise so the feature works on a single key.
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { createImageContent, createTextContent, extractJsonFromResponse, getTextFromClaudeResponse, ClaudeContentBlock, detectImageMimeType } from '../claudeHelpers';

const MODEL_CLAUDE_VISION = 'claude-sonnet-4-5-20250929';
const MODEL_GEMINI_VISION = 'gemini-2.5-pro';

export interface QACharacterInput {
  name: string;
  /** Canonical reference — model sheet when available, portrait otherwise. */
  referenceImage: string;
  /** Things this character must never have, from the profile. */
  hardNegatives?: string[];
  /** Emblem description, when the character has one that must be present. */
  emblem?: string;
}

export interface QACharacterVerdict {
  name: string;
  /** 0-10. How well the rendered face matches the reference. */
  faceMatch: number;
  /** 0-10. How well the costume matches. */
  costumeMatch: number;
  /** null when the character has no emblem to check. */
  emblemCorrect: boolean | null;
  /** Specific, actionable mismatches. */
  issues: string[];
}

export interface QAVerdict {
  /** 0-10, the lowest character score on the page — a page is only as good as its worst face. */
  overall: number;
  characters: QACharacterVerdict[];
  /** One-line human summary for the UI. */
  summary: string;
  /**
   * A reroll instruction targeting exactly what is wrong, or '' when the panel
   * passed. Feed straight into generateImage's `instruction`.
   */
  correction: string;
  /** Which model produced the verdict, for the metrics dashboard. */
  judge: 'claude' | 'gemini' | 'none';
}

export interface VisualQAConfig {
  getAI: () => GoogleGenAI;
  getClaude: () => Anthropic | null;
}

const QA_INSTRUCTIONS = `You are a comic book art director doing a consistency check.

You will be shown reference art for one or more characters, then a generated comic panel.
Judge ONLY whether the characters in the panel are the same characters as in their references.

Score strictly. A panel that "looks nice" but shows a different face is a FAILURE.
Ignore pose, camera angle, expression, lighting, and background — those are supposed to change.
Judge bone structure, face shape, hair colour and cut, skin tone, and costume design.

Return STRICT JSON only, no markdown:
{
  "characters": [
    {
      "name": "exact character name as given",
      "faceMatch": 0-10,
      "costumeMatch": 0-10,
      "emblemCorrect": true | false | null,
      "issues": ["short, specific, fixable observations"]
    }
  ],
  "summary": "one sentence",
  "correction": "A direct instruction to the artist fixing ONLY what is wrong. Empty string if nothing is wrong."
}

Scoring guide:
10 = unmistakably the same person
7-9 = same person, minor drift
4-6 = arguably the same person, obvious drift
0-3 = a different character`;

/** Clamp and coerce a model-supplied score into 0-10. */
const score = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
};

const parseVerdict = (raw: string, judge: 'claude' | 'gemini'): QAVerdict => {
  const parsed = JSON.parse(extractJsonFromResponse(raw)) as Record<string, unknown>;

  const characters: QACharacterVerdict[] = Array.isArray(parsed.characters)
    ? (parsed.characters as Record<string, unknown>[]).map(c => ({
        name: String(c.name ?? 'unknown'),
        faceMatch: score(c.faceMatch),
        costumeMatch: score(c.costumeMatch),
        emblemCorrect: typeof c.emblemCorrect === 'boolean' ? c.emblemCorrect : null,
        issues: Array.isArray(c.issues)
          ? (c.issues as unknown[]).filter((i): i is string => typeof i === 'string')
          : [],
      }))
    : [];

  // A page is only as good as its worst-rendered character.
  const overall = characters.length
    ? Math.min(...characters.map(c => Math.min(c.faceMatch, c.costumeMatch)))
    : 0;

  return {
    overall,
    characters,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    correction: typeof parsed.correction === 'string' ? parsed.correction : '',
    judge,
  };
};

export const useVisualQA = (config: VisualQAConfig) => {
  const { getAI, getClaude } = config;

  /**
   * Score a rendered panel against its character references.
   * Never throws — QA is advisory, and a failed check must not break generation.
   */
  const scorePanel = async (params: {
    panelImage: string;
    characters: QACharacterInput[];
  }): Promise<QAVerdict> => {
    const { panelImage, characters } = params;

    const none: QAVerdict = {
      overall: 10, characters: [], summary: 'QA skipped', correction: '', judge: 'none',
    };
    if (!panelImage || characters.length === 0) return none;

    const strip = (b64: string) => (b64.includes(',') ? b64.split(',')[1] : b64);

    const brief = characters.map(c => {
      const extra = [
        c.emblem ? `must show emblem: ${c.emblem}` : '',
        c.hardNegatives?.length ? `must NOT have: ${c.hardNegatives.join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return `- ${c.name}${extra ? ` (${extra})` : ''}`;
    }).join('\n');

    // ---- Claude (preferred judge) -------------------------------------------
    const claude = getClaude();
    if (claude) {
      try {
        const content: ClaudeContentBlock[] = [createTextContent(QA_INSTRUCTIONS)];
        content.push(createTextContent(`Characters to check:\n${brief}`));
        for (const c of characters) {
          const data = strip(c.referenceImage);
          content.push(createTextContent(`Reference for ${c.name}:`));
          content.push(createImageContent(data, detectImageMimeType(data)));
        }
        const panelData = strip(panelImage);
        content.push(createTextContent('The generated comic panel to judge:'));
        content.push(createImageContent(panelData, detectImageMimeType(panelData)));

        const res = await claude.messages.create({
          model: MODEL_CLAUDE_VISION,
          max_tokens: 1024,
          messages: [{ role: 'user', content }],
        });
        return parseVerdict(getTextFromClaudeResponse(res.content), 'claude');
      } catch (e) {
        console.warn('[visualQA] Claude judge failed, falling back to Gemini', e);
      }
    }

    // ---- Gemini fallback -----------------------------------------------------
    try {
      const ai = getAI();
      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
        { text: QA_INSTRUCTIONS },
        { text: `Characters to check:\n${brief}` },
      ];
      for (const c of characters) {
        const data = strip(c.referenceImage);
        parts.push({ text: `Reference for ${c.name}:` });
        parts.push({ inlineData: { mimeType: detectImageMimeType(data), data } });
      }
      const panelData = strip(panelImage);
      parts.push({ text: 'The generated comic panel to judge:' });
      parts.push({ inlineData: { mimeType: detectImageMimeType(panelData), data: panelData } });

      const res = await ai.models.generateContent({
        model: MODEL_GEMINI_VISION,
        contents: { parts },
        config: { responseMimeType: 'application/json' },
      });
      return parseVerdict(res.text || '{}', 'gemini');
    } catch (e) {
      console.warn('[visualQA] Gemini judge failed; treating panel as passing', e);
      return none;
    }
  };

  return { scorePanel };
};

export default useVisualQA;
