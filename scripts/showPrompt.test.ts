/**
 * Not a test — a viewer. Run with:
 *   npx vitest run scripts/showPrompt.test.ts --reporter=basic
 * Prints the assembled v2 prompt for a representative two-character page so
 * prompt changes can be eyeballed without burning an API call.
 */
import { it } from 'vitest';
import { buildV2Prompt } from '../hooks/promptAssemblerV2';
import type { CharacterProfile, Persona } from '../types';

const p = (id: string, name: string, over: Partial<CharacterProfile> = {}): CharacterProfile => ({
  id, name,
  faceDescription: 'sharp jawline', bodyType: 'lean', clothing: 'navy tactical jacket, silver shoulder plates',
  colorPalette: 'navy/silver', distinguishingFeatures: 'scar over left brow',
  identityHeader: {
    face: 'sharp jawline, high cheekbones, small scar over left brow',
    eyes: 'pale grey', hair: 'black, shoulder-length, wavy', skin: 'light olive', build: 'lean athletic',
    signature: ['silver shoulder plates', 'scar over left brow'],
  },
  hardNegatives: ['cape', 'glasses'],
  emblemDescription: 'silver triangle outline with three vertical bars, apex up',
  emblemPlacement: 'left-chest',
  ...over,
});

const persona = (id: string, name: string): Persona => ({ id, name, base64: 'IMG', desc: '' });

it('prints the v2 prompt', () => {
  const { contents, promptText } = buildV2Prompt({
    beat: {
      scene: 'fallback prose', choices: [], focus_char: 'hero',
      caption: 'The rain had not stopped for three days.',
      dialogue: 'Then we finish it tonight.',
      art: {
        characters_present: ['hero', 'friend'],
        subject: 'Kara Vance',
        action: 'raises her blade overhead',
        environment: 'flooded cathedral ruins, ankle-deep water',
        camera: 'low angle, medium shot',
        lighting: 'hard rim light from a broken stained-glass window',
        mood: 'defiant',
        continuity: 'same storm and blue-grey palette as the previous page',
      },
    },
    type: 'story',
    storyContext: {
      title: 'First Light', descriptionText: '', descriptionFiles: [], publisherName: 'Infinite',
      seriesTitle: 'Aria of Twilight', issueNumber: '1', useOverlayLogo: false,
      artStyle: 'Modern American Comic', pageLength: 6,
    },
    genre: 'Superhero Action',
    characters: [
      {
        persona: persona('h', 'Kara Vance'), profile: p('h', 'Kara Vance'), roleLabel: 'hero',
        referenceImage: 'SHEET', isModelSheet: true, outfitRefs: ['OUTFIT'],
        emblem: { image: 'EMB', placement: 'left chest' },
        weapon: { image: 'WPN', description: 'curved silver blade' },
        isPreserved: false,
      },
      {
        persona: persona('d', 'Dane'),
        profile: p('d', 'Dane', { hardNegatives: ['beard'], emblemDescription: undefined }),
        roleLabel: 'co-star', referenceImage: 'SHEET2', isModelSheet: true, outfitRefs: [], isPreserved: false,
      },
    ],
    sceneContext: [{ base64: 'PREV', label: 'Previous page:' }],
    shotType: 'medium',
    consistencyStrength: 1.0,
    compact: false,
  }, () => 'image/png');

  console.log('\n' + '='.repeat(72));
  console.log(promptText);
  console.log('='.repeat(72));
  console.log(`text blocks: ${contents.filter(c => 'text' in c).length}`);
  console.log(`images:      ${contents.filter(c => 'inlineData' in c).length}`);
  console.log(`prompt text: ${promptText.length} chars`);
});
