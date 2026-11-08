/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The story inputs that both writers (the outline planner and the per-page beat
 * writer) need, assembled in one place.
 *
 * Before this module each writer built its own brief, and they drifted: the
 * outline never saw the custom premise, the tone, or uploaded story files, so in
 * Outline Mode the plan and the pages were written from different stories. The
 * arc was also hardcoded to page numbers (climax only after page 8), so a 3-page
 * story never reached one. Anything both writers must agree on belongs here.
 */

import { TONES } from '../types';

// ---------------------------------------------------------------------------
// Tone
// ---------------------------------------------------------------------------

/** Stored on StoryContext when the user lets the genre choose the tone. */
export const TONE_AUTO = 'auto';

/**
 * The tone each genre gets under "Auto".
 *
 * Deterministic on purpose. The tone used to be picked at random at launch, so
 * the outline (planned earlier) and the pages could be written in different
 * voices, and two runs of the same setup read differently for no visible reason.
 */
const GENRE_TONE: Record<string, string> = {
  'Classic Horror': TONES[1],              // INNER-MONOLOGUE
  'Superhero Action': TONES[0],            // ACTION-HEAVY
  'Dark Sci-Fi': TONES[1],                 // INNER-MONOLOGUE
  'High Fantasy': TONES[3],                // OPERATIC
  'Neon Noir Detective': TONES[1],         // INNER-MONOLOGUE
  'Wasteland Apocalypse': TONES[0],        // ACTION-HEAVY
  'Lighthearted Comedy': TONES[2],         // QUIPPY
  'Teen Drama / Slice of Life': TONES[4],  // CASUAL
};

/** The tone the writers should use, resolving "Auto" from the genre. */
export const resolveTone = (genre: string, tone?: string): string => {
  if (tone && tone !== TONE_AUTO && TONES.includes(tone)) return tone;
  return GENRE_TONE[genre] ?? TONES[0];
};

/** Short label for a tone, e.g. "Quippy", for the setup dropdown. */
export const toneLabel = (tone: string): string => {
  const name = tone.split(' (')[0].toLowerCase().replace(/-/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
};

/**
 * The genre or premise line plus the tone. Custom stories keep their tone too:
 * previously the custom-premise branch dropped it.
 */
export const formatStoryDriver = (genre: string, customPremise: string, tone: string): string => {
  if (genre === 'Custom') {
    const premise = customPremise.trim() || 'A totally unique, unpredictable adventure';
    return `STORY PREMISE: ${premise}. (Follow this premise strictly over standard genre tropes). TONE: ${tone}.`;
  }
  return `GENRE: ${genre}. TONE: ${tone}.`;
};

// ---------------------------------------------------------------------------
// Story arc, scaled to the issue length
// ---------------------------------------------------------------------------

export type ArcPhase = 'inciting' | 'rising' | 'complication' | 'climax' | 'finale';

/**
 * Which part of the arc a story page belongs to, for an issue of `totalPages`.
 *
 * Page 1 is always the inciting incident, the last page is the finale, and the
 * page before it is the climax. The pages between split into rising action and
 * complication. So 3 pages are inciting, climax, finale; 6 pages add rising and
 * complication; 9 pages give each a longer run.
 */
export const getArcPhase = (pageNum: number, totalPages: number): ArcPhase => {
  const total = Math.max(1, totalPages);
  if (pageNum >= total) return 'finale';
  if (pageNum <= 1) return 'inciting';
  if (total >= 3 && pageNum === total - 1) return 'climax';
  const progress = (pageNum - 1) / (total - 1);
  return progress <= 0.5 ? 'rising' : 'complication';
};

const PHASE_GUIDANCE: Record<Exclude<ArcPhase, 'finale'>, string> = {
  inciting: "INCITING INCIDENT. An event disrupts the status quo. Establish the genre's intended mood. (If Slice of Life: A social snag/surprise. If Adventure: A call to action).",
  rising: 'RISING ACTION. The heroes engage with the new situation. Focus on dialogue, character dynamics, and initial challenges.',
  complication: 'COMPLICATION. A twist occurs! A secret is revealed, a misunderstanding deepens, or the path is blocked. (Keep intensity appropriate to Genre - e.g. Social awkwardness for Comedy, Danger for Horror).',
  climax: 'CLIMAX. The confrontation with the main conflict. The truth comes out, the contest ends, or the battle is fought.',
};

/** Beat-writer guidance for a non-final page. */
export const getArcGuidance = (pageNum: number, totalPages: number): string => {
  const phase = getArcPhase(pageNum, totalPages);
  return phase === 'finale' ? '' : PHASE_GUIDANCE[phase];
};

/**
 * Final-page instruction. It references the reader's actual choices when there
 * were any. The old text always pointed at "the User's choice from PAGE 3",
 * which named the wrong page in Novel Mode and a choice that never happened in
 * Outline Mode.
 */
export const getFinalePageInstruction = (resolvedChoices: string[]): string => {
  const choiceLine = resolvedChoices.length > 0
    ? ` Explicitly reference the reader's earlier choices (${resolvedChoices.map(c => `"${c}"`).join(', ')}) and show how they led to this conclusion.`
    : ' Resolve the main conflict set up on page 1.';
  return ` FINAL PAGE. KARMIC CLIFFHANGER REQUIRED.${choiceLine} Text must end with 'TO BE CONTINUED...' (or localized equivalent).`;
};

const PHASE_PACING: Record<ArcPhase, string> = {
  inciting: 'SLOW (establishing, setting the scene)',
  rising: 'MEDIUM (rising action, character dynamics)',
  complication: 'FAST (complication, tension building)',
  climax: 'FAST (climax)',
  finale: 'SLOW (resolution/cliffhanger)',
};

/** Page-by-page pacing plan for the outline, using the same phases as the beats. */
export const formatPacingPlan = (totalPages: number): string => {
  const lines: string[] = [];
  for (let p = 1; p <= Math.max(1, totalPages); p++) {
    lines.push(`- Page ${p}: ${PHASE_PACING[getArcPhase(p, totalPages)]}`);
  }
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Attached files
// ---------------------------------------------------------------------------

export interface AttachedFile {
  base64: string;
  mimeType: string;
  name: string;
}

export const isTextFile = (f: AttachedFile): boolean =>
  f.mimeType.startsWith('text/') || /\.(txt|md)$/i.test(f.name);

export const isImageFile = (f: AttachedFile): boolean => f.mimeType.startsWith('image/');

/** Per-file and total caps keep a pasted novel from swamping every prompt. */
const MAX_CHARS_PER_FILE = 15_000;
const MAX_CHARS_TOTAL = 40_000;

const decodeBase64Text = (base64: string): string => {
  const payload = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  const binary = atob(payload);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

/**
 * Uploaded .txt/.md files as plain prompt text.
 *
 * Inlined as text so both models read them. The Claude path (the primary
 * writer) used to forward only images, so an uploaded script reached the writer
 * only when Claude failed and Gemini took over.
 */
export const formatAttachedText = (files: AttachedFile[] | undefined, label: string): string => {
  if (!files || files.length === 0) return '';
  let remaining = MAX_CHARS_TOTAL;
  const blocks: string[] = [];
  for (const f of files.filter(isTextFile)) {
    if (remaining <= 0) break;
    let text: string;
    try {
      text = decodeBase64Text(f.base64).trim();
    } catch {
      continue;
    }
    if (!text) continue;
    const limit = Math.min(MAX_CHARS_PER_FILE, remaining);
    const clipped = text.length > limit ? `${text.slice(0, limit)}\n[…truncated]` : text;
    remaining -= clipped.length;
    blocks.push(`--- ${label}: ${f.name} ---\n${clipped}`);
  }
  return blocks.length > 0 ? `\n${blocks.join('\n\n')}\n` : '';
};
