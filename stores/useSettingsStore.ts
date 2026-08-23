/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GENRES, PAGE_LENGTHS, LANGUAGES, ART_STYLES, getComicConfig } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export interface PublisherInfo {
  name: string;
  issueNumber: string;
}

export interface SettingsState {
  // Story settings
  selectedGenre: string;
  customPremise: string;
  selectedLanguage: string;
  selectedArtStyle: string;
  selectedPageLength: number;

  // Publisher settings
  publisherInfo: PublisherInfo;

  // Mode settings
  generateFromOutline: boolean;
  skipProfileAnalysis: boolean;

  // UI settings
  showApiCostEstimate: boolean;

  // === Consistency Settings (Feature E) ===
  /**
   * How strictly character reference data is weighted in generation prompts.
   * 0.3 = Minimal (allow creative drift), 0.5 = Moderate, 0.7 = Strong, 1.0 = Maximum (default).
   */
  consistencyStrength: number;
  /**
   * Re-inject full character reference every N pages to prevent long-run drift.
   * Default: 2 (every other page). Range: 1–5.
   */
  reAnchorEveryN: number;
  /**
   * Automatically run AI character analysis pass on portrait upload.
   * When false, generation proceeds without profile analysis (faster but less consistent).
   */
  autoCharacterAnalysis: boolean;
  /**
   * When true, uploaded reference images are weighted more heavily than text descriptions.
   * Portraits appear last in the content array (highest weight position).
   */
  referenceImagePriority: boolean;

  // === Prompt Engine (v2) ===
  /**
   * Which image-prompt assembler to use.
   * 'v2' states each character's identity exactly once, adjacent to their portrait.
   * 'legacy' is the original multi-block assembler, kept so the eval harness can A/B them.
   */
  promptMode: 'v2' | 'legacy';
  /**
   * Output resolution passed to the image model.
   * '1k' for drafts, '2k'/'4k' for print export (1k at 2:3 is only ~130 DPI at comic trim size).
   */
  imageResolution: '1k' | '2k' | '4k';
  /**
   * Generate a character model sheet (turnaround + expressions) in the target art style
   * and use it as the canonical reference instead of the raw user portrait.
   */
  useModelSheets: boolean;
  /**
   * After each page, score the render against the character reference with a vision model
   * and automatically reroll pages that fall below `qaThreshold`.
   */
  qaAutoReroll: boolean;
  /** Minimum acceptable QA score (0–10). Pages below this are rerolled when qaAutoReroll is on. */
  qaThreshold: number;
  /**
   * How many pages may generate concurrently.
   *
   * Defaults to 1 because each page uses the previous page's rendered image as a
   * background/lighting continuity reference — pages generated in parallel cannot
   * see each other, so raising this trades scene continuity for wall-clock speed.
   * Character consistency is unaffected (that comes from the model sheets).
   */
  maxConcurrentPages: number;
}

export interface ComicConfig {
  MAX_STORY_PAGES: number;
  BACK_COVER_PAGE: number;
  TOTAL_PAGES: number;
  INITIAL_PAGES: number;
  GATE_PAGE: number;
  BATCH_SIZE: number;
  DECISION_PAGES: number[];
}

export interface SettingsActions {
  // Setters for each setting
  setSelectedGenre: (genre: string) => void;
  setCustomPremise: (premise: string) => void;
  setSelectedLanguage: (language: string) => void;
  setSelectedArtStyle: (artStyle: string) => void;
  setSelectedPageLength: (pageLength: number) => void;
  setPublisherInfo: (info: Partial<PublisherInfo>) => void;
  setGenerateFromOutline: (value: boolean) => void;
  setSkipProfileAnalysis: (value: boolean) => void;
  setShowApiCostEstimate: (value: boolean) => void;
  setConsistencyStrength: (value: number) => void;
  setReAnchorEveryN: (value: number) => void;
  setAutoCharacterAnalysis: (value: boolean) => void;
  setReferenceImagePriority: (value: boolean) => void;
  setPromptMode: (value: 'v2' | 'legacy') => void;
  setImageResolution: (value: '1k' | '2k' | '4k') => void;
  setUseModelSheets: (value: boolean) => void;
  setQaAutoReroll: (value: boolean) => void;
  setQaThreshold: (value: number) => void;
  setMaxConcurrentPages: (value: number) => void;

  // Bulk operations
  resetSettings: () => void;
  loadFromLocalStorage: () => void;

  // Computed
  getComicConfig: (extraPages?: number) => ComicConfig;
}

export type SettingsStore = SettingsState & SettingsActions;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

const getDefaultSettings = (): SettingsState => ({
  selectedGenre: GENRES[0] || 'Superhero Action',
  customPremise: '',
  selectedLanguage: LANGUAGES[0]?.code || 'en-US',
  selectedArtStyle: ART_STYLES[0] || 'Modern American Comic',
  selectedPageLength: PAGE_LENGTHS[1]?.value || 6, // Short Story (6 Pages) as default
  publisherInfo: {
    name: '',
    issueNumber: '1',
  },
  generateFromOutline: true, // Outline Mode by default
  skipProfileAnalysis: false,
  showApiCostEstimate: true, // Show by default
  consistencyStrength: 1.0,  // Maximum consistency by default
  reAnchorEveryN: 2,         // Re-inject full reference every 2 pages
  autoCharacterAnalysis: true,
  referenceImagePriority: true,
  promptMode: 'v2',
  imageResolution: '1k',
  useModelSheets: true,
  qaAutoReroll: false,   // opt-in: costs one extra vision call per page
  qaThreshold: 7,
  maxConcurrentPages: 1,
});

// ============================================================================
// STORE
// ============================================================================

const STORAGE_KEY = 'infinite-heroes-settings';

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      ...getDefaultSettings(),

      // Setters
      setSelectedGenre: (genre) => set({ selectedGenre: genre }),

      setCustomPremise: (premise) => set({ customPremise: premise }),

      setSelectedLanguage: (language) => set({ selectedLanguage: language }),

      setSelectedArtStyle: (artStyle) => set({ selectedArtStyle: artStyle }),

      setSelectedPageLength: (pageLength) => set({ selectedPageLength: pageLength }),

      setPublisherInfo: (info) => set((state) => ({
        publisherInfo: { ...state.publisherInfo, ...info },
      })),

      setGenerateFromOutline: (value) => set({ generateFromOutline: value }),

      setSkipProfileAnalysis: (value) => set({ skipProfileAnalysis: value }),

      setShowApiCostEstimate: (value) => set({ showApiCostEstimate: value }),

      setConsistencyStrength: (value) => set({ consistencyStrength: Math.max(0.3, Math.min(1.0, value)) }),

      setReAnchorEveryN: (value) => set({ reAnchorEveryN: Math.max(1, Math.min(5, Math.round(value))) }),

      setAutoCharacterAnalysis: (value) => set({
        autoCharacterAnalysis: value,
        skipProfileAnalysis: !value, // Keep in sync with legacy field
      }),

      setReferenceImagePriority: (value) => set({ referenceImagePriority: value }),
      setPromptMode: (value) => set({ promptMode: value }),
      setImageResolution: (value) => set({ imageResolution: value }),
      setUseModelSheets: (value) => set({ useModelSheets: value }),
      setQaAutoReroll: (value) => set({ qaAutoReroll: value }),
      setQaThreshold: (value) => set({ qaThreshold: Math.max(0, Math.min(10, value)) }),
      setMaxConcurrentPages: (value) => set({ maxConcurrentPages: Math.max(1, Math.min(4, Math.round(value))) }),

      // Reset to defaults
      resetSettings: () => set(getDefaultSettings()),

      // Load from localStorage (useful for manual refresh scenarios)
      // Note: With persist middleware, this is typically automatic on store initialization
      loadFromLocalStorage: () => {
        try {
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.state) {
              // Merge stored state with defaults to handle any new fields
              set({
                ...getDefaultSettings(),
                ...parsed.state,
              });
            }
          }
        } catch (error) {
          console.warn('Failed to load settings from localStorage:', error);
        }
      },

      // Compute comic configuration based on current settings
      getComicConfig: (extraPages = 0) => {
        const state = get();
        const isNovelMode = !state.generateFromOutline;
        return getComicConfig(state.selectedPageLength, extraPages, isNovelMode);
      },
    }),
    {
      name: STORAGE_KEY,
      // Only persist specific fields (not actions)
      partialize: (state) => ({
        selectedGenre: state.selectedGenre,
        customPremise: state.customPremise,
        selectedLanguage: state.selectedLanguage,
        selectedArtStyle: state.selectedArtStyle,
        selectedPageLength: state.selectedPageLength,
        publisherInfo: state.publisherInfo,
        generateFromOutline: state.generateFromOutline,
        skipProfileAnalysis: state.skipProfileAnalysis,
        showApiCostEstimate: state.showApiCostEstimate,
        consistencyStrength: state.consistencyStrength,
        reAnchorEveryN: state.reAnchorEveryN,
        autoCharacterAnalysis: state.autoCharacterAnalysis,
        referenceImagePriority: state.referenceImagePriority,
        promptMode: state.promptMode,
        imageResolution: state.imageResolution,
        useModelSheets: state.useModelSheets,
        qaAutoReroll: state.qaAutoReroll,
        qaThreshold: state.qaThreshold,
        maxConcurrentPages: state.maxConcurrentPages,
      }),
    }
  )
);

// ============================================================================
// SELECTOR HOOKS (for optimized re-renders)
// ============================================================================

export const useSelectedGenre = () => useSettingsStore((state) => state.selectedGenre);
export const useCustomPremise = () => useSettingsStore((state) => state.customPremise);
export const useSelectedLanguage = () => useSettingsStore((state) => state.selectedLanguage);
export const useSelectedArtStyle = () => useSettingsStore((state) => state.selectedArtStyle);
export const useSelectedPageLength = () => useSettingsStore((state) => state.selectedPageLength);
export const usePublisherInfo = () => useSettingsStore((state) => state.publisherInfo);
export const useGenerateFromOutline = () => useSettingsStore((state) => state.generateFromOutline);
export const useSkipProfileAnalysis = () => useSettingsStore((state) => state.skipProfileAnalysis);

// Computed selector for novel mode (inverse of generateFromOutline)
export const useIsNovelMode = () => useSettingsStore((state) => !state.generateFromOutline);

// UI settings selectors
export const useShowApiCostEstimate = () => useSettingsStore((state) => state.showApiCostEstimate);

// Consistency settings selectors (Feature E)
export const useConsistencyStrength = () => useSettingsStore((state) => state.consistencyStrength);
export const useReAnchorEveryN = () => useSettingsStore((state) => state.reAnchorEveryN);
export const useAutoCharacterAnalysis = () => useSettingsStore((state) => state.autoCharacterAnalysis);
export const useReferenceImagePriority = () => useSettingsStore((state) => state.referenceImagePriority);
export const usePromptMode = () => useSettingsStore((state) => state.promptMode);
export const useImageResolution = () => useSettingsStore((state) => state.imageResolution);
export const useUseModelSheets = () => useSettingsStore((state) => state.useModelSheets);
export const useQaAutoReroll = () => useSettingsStore((state) => state.qaAutoReroll);
export const useMaxConcurrentPages = () => useSettingsStore((state) => state.maxConcurrentPages);
