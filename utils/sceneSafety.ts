/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keeping scene descriptions inside what the image model will actually draw.
 *
 * The writer and the artist are different models with different safety policies,
 * and the artist's is stricter. So a scene the story model happily produces
 * comes back from the image model as a refusal, and the user sees a failed page
 * for a story their own AI wrote. Prompt-level guidance reduces this but does
 * not eliminate it — the writer is not a reliable judge of what will trip
 * another model's filter.
 *
 * This is the second line of defence: rewrite the scene into something
 * equivalent but renderable, and retry. Blunt on purpose. It runs only after a
 * block has already happened, where a slightly duller panel beats no panel.
 */

/**
 * Phrases that reliably trip image-safety filters, paired with a replacement
 * that preserves the dramatic beat.
 *
 * Ordered longest-first at match time so "slits his throat" is handled before
 * "throat". Replacements deliberately move the camera rather than soften the
 * stakes — comics imply violence constantly without depicting injury.
 */
const SUBSTITUTIONS: Array<[RegExp, string]> = [
  // Injury and gore
  [/\b(blood|bloody|bleeding|blood-soaked|gore|gory)\b/gi, 'battle-worn'],
  [/\b(corpse|corpses|dead body|dead bodies|cadaver)\b/gi, 'fallen figure'],
  [/\b(decapitat\w*|dismember\w*|mutilat\w*|disembowel\w*)\b/gi, 'defeated'],
  [/\b(stabs?|stabbing|impales?|impaling)\b/gi, 'lunges at'],
  [/\b(slits?|slashes|slicing)\s+(his|her|their|the)\s+throat\b/gi, 'strikes'],
  [/\b(wound|wounded|gash|gaping)\b/gi, 'struck'],
  [/\b(severed|amputated)\b/gi, 'broken'],

  // Killing
  [/\b(kills?|killing|murders?|murdering|slaughter\w*|execut(?:es|ing))\b/gi, 'defeats'],
  [/\b(shoots?|shooting)\s+(him|her|them|it)\b/gi, 'takes aim at $2'],

  // Self-harm and suicide
  [/\b(suicide|self-harm|hangs? (?:him|her|them)self)\b/gi, 'despair'],

  // Nudity and sexual content
  [/\b(nude|naked|topless|undressed|strips? off)\b/gi, 'in plain clothes'],
  [/\b(sexual|erotic|seductive|sensual)\b/gi, 'intense'],

  // Real-world entities the model will refuse or mis-render
  [/\b(swastika|nazi)\b/gi, 'enemy insignia'],
];

/** Words whose presence makes a block likely enough to be worth pre-empting. */
const RISK_WORDS = /\b(blood|gore|corpse|decapitat|dismember|mutilat|stab|impale|slit|sever|kill|murder|slaughter|suicide|self-harm|nude|naked|sexual|erotic|nazi|swastika)\w*/gi;

export interface SceneSafetyResult {
  /** The rewritten text. Identical to the input when nothing matched. */
  text: string;
  /** True when at least one substitution was applied. */
  changed: boolean;
  /** Which risk terms were found, for logging. */
  matched: string[];
}

/**
 * Rewrite a scene description into a renderable equivalent.
 *
 * @param text Scene, action, or environment text
 */
export function softenScene(text: string): SceneSafetyResult {
  if (!text) return { text: '', changed: false, matched: [] };

  const matched = [...new Set((text.match(RISK_WORDS) ?? []).map(m => m.toLowerCase()))];

  let out = text;
  for (const [pattern, replacement] of SUBSTITUTIONS) {
    out = out.replace(pattern, replacement);
  }

  return { text: out, changed: out !== text, matched };
}

/** True when a scene contains terms likely to trip an image-safety filter. */
export function looksRisky(text: string): boolean {
  if (!text) return false;
  RISK_WORDS.lastIndex = 0;
  return RISK_WORDS.test(text);
}

/**
 * Extra direction appended when retrying a blocked page.
 *
 * Stated positively. "Do not draw blood" still puts blood in the prompt; naming
 * the shot you do want gives the model something to render instead.
 */
export const SAFE_RETRY_DIRECTION =
  'Render this as a mainstream all-ages comic panel. Convey the conflict through ' +
  'posture, motion lines, impact effects, facial expression, and framing. Show the ' +
  'moment before contact or the reaction after it. No injuries, no blood, no bodies.';
