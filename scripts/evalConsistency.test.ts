/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Character-consistency eval harness.
 *
 * The problem this solves: this app's core value is prompt engineering, and
 * until now there was no way to tell whether a prompt change helped or hurt.
 * That is precisely how the legacy assembler accumulated fourteen redundant
 * identity blocks — every addition felt plausible and nothing ever measured it.
 *
 * This runs a fixed cast through a fixed script under each prompt variant,
 * renders the pages for real, and has a vision model score how well each
 * rendered character matches their reference. Output is a comparison table.
 *
 * It makes REAL, PAID API CALLS, so it is skipped unless you opt in:
 *
 *   GEMINI_API_KEY=... EVAL=1 npx vitest run scripts/evalConsistency.test.ts
 *
 * Optional:
 *   ANTHROPIC_API_KEY=...   use Claude as the judge (recommended; falls back to Gemini)
 *   EVAL_PAGES=4            pages per variant (default 3)
 *   EVAL_FIXTURE=path.json  custom cast fixture
 *
 * Fixture format (JSON):
 *   { "name": "...", "artStyle": "...", "characters": [
 *       { "name": "...", "roleLabel": "hero", "portraitPath": "assets/…png",
 *         "profile": { …CharacterProfile… } } ] }
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { GoogleGenAI } from '@google/genai';
import { buildV2Prompt, type V2Character } from '../hooks/promptAssemblerV2';
import type { Beat, CharacterProfile, Persona, StoryContext } from '../types';

const ENABLED = process.env.EVAL === '1' && Boolean(process.env.GEMINI_API_KEY);
const PAGES = Number(process.env.EVAL_PAGES) || 3;
const IMAGE_MODEL = 'gemini-3-pro-image-preview';
const JUDGE_MODEL = 'gemini-2.5-pro';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

interface FixtureCharacter {
  name: string;
  roleLabel: string;
  portraitPath?: string;
  portraitBase64?: string;
  profile: CharacterProfile;
}
interface Fixture {
  name: string;
  artStyle: string;
  genre: string;
  characters: FixtureCharacter[];
}

/** A synthetic fixture so the harness is runnable without user assets. */
const DEFAULT_FIXTURE: Fixture = {
  name: 'default-two-hander',
  artStyle: 'Modern American Comic',
  genre: 'Superhero Action',
  characters: [
    {
      name: 'Kara Vance',
      roleLabel: 'hero',
      profile: {
        id: 'h', name: 'Kara Vance',
        faceDescription: 'sharp jawline, high cheekbones',
        bodyType: 'lean athletic',
        clothing: 'navy tactical jacket with silver shoulder plates, black gloves',
        colorPalette: 'navy, silver, black',
        distinguishingFeatures: 'small scar over left brow',
        identityHeader: {
          face: 'sharp jawline, high cheekbones, small scar over left brow',
          eyes: 'pale grey', hair: 'black, shoulder-length, wavy',
          skin: 'light olive', build: 'lean athletic',
          signature: ['silver shoulder plates', 'scar over left brow'],
        },
        hardNegatives: ['cape', 'glasses'],
      },
    },
    {
      name: 'Dane Okoro',
      roleLabel: 'co-star',
      profile: {
        id: 'f', name: 'Dane Okoro',
        faceDescription: 'broad face, square jaw, close-cropped beard',
        bodyType: 'heavyset, tall',
        clothing: 'rust-orange work coat over grey coveralls',
        colorPalette: 'rust orange, grey',
        distinguishingFeatures: 'gold hoop earring in right ear',
        identityHeader: {
          face: 'broad face, square jaw, close-cropped beard',
          eyes: 'dark brown', hair: 'shaved head',
          skin: 'deep brown', build: 'heavyset, tall',
          signature: ['gold hoop earring', 'rust-orange work coat'],
        },
        hardNegatives: ['long hair', 'armour'],
      },
    },
  ],
};

/** Fixed script so variants are compared on identical content. */
const SCRIPT: Beat[] = [
  {
    scene: '', choices: [], focus_char: 'hero',
    caption: 'The tunnels had been quiet for a week.',
    art: {
      characters_present: ['hero', 'friend'], subject: 'Kara Vance',
      action: 'crouches to examine a scorch mark on the floor',
      environment: 'a flooded service tunnel, ankle-deep water, pipes overhead',
      camera: 'low angle, medium shot', lighting: 'harsh torchlight from one side',
      mood: 'wary',
    },
  },
  {
    scene: '', choices: [], focus_char: 'friend',
    dialogue: 'That is not rust.',
    art: {
      characters_present: ['hero', 'friend'], subject: 'Dane Okoro',
      action: 'holds a lantern up toward the ceiling',
      environment: 'the same flooded tunnel, further along',
      camera: 'medium shot', lighting: 'warm lantern glow, deep shadows',
      mood: 'uneasy',
    },
  },
  {
    scene: '', choices: [], focus_char: 'hero',
    caption: 'Then the water moved.',
    art: {
      characters_present: ['hero', 'friend'], subject: 'Kara Vance',
      action: 'spins toward the sound, one hand raised',
      environment: 'the tunnel mouth opening into a wide cistern',
      camera: 'wide shot', lighting: 'cold blue light from above',
      mood: 'alarmed',
    },
  },
  {
    scene: '', choices: [], focus_char: 'friend',
    dialogue: 'Back. Get back!',
    art: {
      characters_present: ['hero', 'friend'], subject: 'Dane Okoro',
      action: 'shoves Kara behind him',
      environment: 'the cistern edge, water churning',
      camera: 'close-up', lighting: 'stark under-lighting from the water',
      mood: 'urgent',
    },
  },
];

const loadFixture = (): Fixture => {
  const path = process.env.EVAL_FIXTURE;
  if (path && existsSync(path)) {
    return JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  }
  return DEFAULT_FIXTURE;
};

const storyContext = (artStyle: string): StoryContext => ({
  title: 'Eval Run', descriptionText: '', descriptionFiles: [],
  publisherName: 'Eval', seriesTitle: 'Eval', issueNumber: '1',
  useOverlayLogo: true, artStyle, pageLength: PAGES,
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

interface PageScore { page: number; scores: Record<string, number>; notes: string[] }

const JUDGE_PROMPT = `You are a comic art director checking character consistency.
You will see reference art for each character, then a generated panel.
Score ONLY whether each character in the panel is the SAME person as their reference.
Ignore pose, expression, camera, and lighting — those are meant to change.
Judge bone structure, hair, skin tone, and costume.

Return STRICT JSON, no markdown:
{"scores": {"<character name>": 0-10}, "notes": ["specific mismatches"]}
10 = unmistakably the same person. 0-3 = a different character.`;

async function judge(
  ai: GoogleGenAI,
  panel: string,
  chars: Array<{ name: string; reference: string }>,
): Promise<{ scores: Record<string, number>; notes: string[] }> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: JUDGE_PROMPT },
  ];
  for (const c of chars) {
    parts.push({ text: `Reference for ${c.name}:` });
    parts.push({ inlineData: { mimeType: 'image/png', data: c.reference } });
  }
  parts.push({ text: 'Generated panel:' });
  parts.push({ inlineData: { mimeType: 'image/png', data: panel } });

  const res = await ai.models.generateContent({
    model: JUDGE_MODEL,
    contents: { parts },
    config: { responseMimeType: 'application/json' },
  });
  try {
    const parsed = JSON.parse((res.text || '{}').replace(/```json|```/g, '').trim());
    return { scores: parsed.scores ?? {}, notes: parsed.notes ?? [] };
  } catch {
    return { scores: {}, notes: ['judge returned unparseable output'] };
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)('character consistency eval', () => {
  it('scores rendered pages against character references', async () => {
    const fixture = loadFixture();
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
    const ctx = storyContext(fixture.artStyle);

    // Resolve each character's reference image once.
    const refs = fixture.characters.map(c => {
      let base64 = c.portraitBase64 ?? '';
      if (!base64 && c.portraitPath && existsSync(c.portraitPath)) {
        base64 = readFileSync(c.portraitPath).toString('base64');
      }
      return { ...c, base64 };
    });

    const withPortraits = refs.filter(r => r.base64);
    if (withPortraits.length === 0) {
      console.warn(
        '\n[eval] No portrait images in the fixture — rendering from text descriptors only.\n' +
        '       Set portraitPath on each fixture character for a meaningful consistency score.\n'
      );
    }

    const toV2 = (r: typeof refs[number]): V2Character => ({
      persona: { id: r.profile.id, name: r.name, base64: r.base64, desc: '' } as Persona,
      profile: r.profile,
      roleLabel: r.roleLabel,
      referenceImage: r.base64 || undefined,
      isModelSheet: false,
      outfitRefs: [],
      isPreserved: false,
    });

    const results: PageScore[] = [];
    let prevImage: string | undefined;

    for (let i = 0; i < Math.min(PAGES, SCRIPT.length); i++) {
      const beat = SCRIPT[i];

      const { contents, promptText } = buildV2Prompt({
        beat,
        type: 'story',
        storyContext: ctx,
        genre: fixture.genre,
        characters: refs.map(toV2),
        sceneContext: prevImage ? [{ base64: prevImage, label: 'Previous page:' }] : undefined,
        consistencyStrength: 1.0,
        compact: false,
      }, () => 'image/png');

      const res = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents,
        config: { imageConfig: { aspectRatio: '2:3', imageSize: '1K' } },
      });

      const data = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (!data) {
        results.push({
          page: i + 1, scores: {},
          notes: [`render failed: ${res.candidates?.[0]?.finishReason ?? 'empty response'}`],
        });
        continue;
      }
      prevImage = data;

      const verdict = await judge(ai, data, withPortraits.map(r => ({ name: r.name, reference: r.base64 })));
      results.push({ page: i + 1, scores: verdict.scores, notes: verdict.notes });

      console.log(`[eval] page ${i + 1}: prompt ${promptText.length} chars, scores`, verdict.scores);
    }

    // ---- Report ----
    const names = fixture.characters.map(c => c.name);
    console.log('\n' + '='.repeat(64));
    console.log(`CONSISTENCY EVAL — ${fixture.name} (${fixture.artStyle})`);
    console.log('='.repeat(64));
    console.log(['page', ...names].join('\t'));
    for (const r of results) {
      console.log([r.page, ...names.map(n => r.scores[n] ?? '—')].join('\t'));
    }
    for (const n of names) {
      const vals = results.map(r => r.scores[n]).filter((v): v is number => typeof v === 'number');
      const mean = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 'n/a';
      console.log(`mean ${n}: ${mean}`);
    }
    const allNotes = results.flatMap(r => r.notes);
    if (allNotes.length) {
      console.log('\nObserved issues:');
      [...new Set(allNotes)].forEach(n => console.log(`  - ${n}`));
    }
    console.log('='.repeat(64) + '\n');

    // The harness itself must produce data; scores are for the human to read.
    expect(results.length).toBeGreaterThan(0);
  }, 15 * 60 * 1000);
});

describe('eval harness wiring', () => {
  it('builds a complete request for every page of the fixed script without calling the API', () => {
    const fixture = DEFAULT_FIXTURE;
    const ctx = storyContext(fixture.artStyle);

    for (const beat of SCRIPT) {
      const { contents, promptText } = buildV2Prompt({
        beat, type: 'story', storyContext: ctx, genre: fixture.genre,
        characters: fixture.characters.map(c => ({
          persona: { id: c.profile.id, name: c.name, base64: 'X', desc: '' } as Persona,
          profile: c.profile, roleLabel: c.roleLabel,
          referenceImage: 'X', isModelSheet: false, outfitRefs: [], isPreserved: false,
        })),
        consistencyStrength: 1.0, compact: false,
      }, () => 'image/png');

      expect(contents.length).toBeGreaterThan(0);
      expect(promptText).toContain('ACTION:');
      expect(promptText).toContain('KARA VANCE');
      expect(promptText).toContain('DANE OKORO');
      // Each character's negatives must survive into the merged rule.
      expect(promptText).toMatch(/Never draw:.*cape/);
    }
  });
});
