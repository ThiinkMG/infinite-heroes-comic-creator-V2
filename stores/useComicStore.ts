/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ComicFace, PageCharacterPlan, VisualDriftWarning } from '../types';
import type { QAVerdict } from '../hooks/useVisualQA';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Story outline state with generation status
 */
export interface StoryOutlineState {
  /** Full outline text content */
  text: string;
  /** Parsed page-by-page character/scene plans */
  pageBreakdown: PageCharacterPlan[];
  /** Whether outline generation is complete and ready */
  isReady: boolean;
  /** Whether outline is currently being generated */
  isGenerating: boolean;
  /** Whether the outline has been enhanced with comic fundamentals */
  isEnhanced: boolean;
  /** Timestamp of last edit */
  lastEditedAt?: number;
  /** Version number for conflict detection */
  version: number;
}

/**
 * Generation progress state
 */
export interface GenerationState {
  /** Whether currently generating content */
  isGenerating: boolean;
  /** Current page being generated (0-indexed, undefined if not generating) */
  currentPageIndex?: number;
  /** Total pages to generate in current batch */
  totalPages?: number;
  /** Progress message for UI display */
  progressMessage?: string;
  /** Generation type (cover, story, back_cover) */
  generationType?: 'cover' | 'story' | 'back_cover' | 'outline';
}

/**
 * Comic store state
 */
export interface ComicState {
  // === Data ===
  /** Array of comic pages (cover, story pages, back cover) */
  comicFaces: ComicFace[];
  /** Story outline with parsed plans */
  storyOutline: StoryOutlineState;
  /** Current page index being viewed (0-indexed) */
  currentPageIndex: number;
  /** Generation progress state */
  generationState: GenerationState;
  /**
   * Visual drift warnings (Feature G).
   * Non-blocking — surfaced as toast when character appearance deviates from reference.
   * Session-only, cleared on reset.
   */
  visualDriftWarnings: VisualDriftWarning[];
  /**
   * Latest visual-QA verdict per page index.
   * Lets the reader flag pages whose characters drifted, so the user can spot
   * a bad face without scrubbing the whole issue. Session-only.
   */
  pageQA: Record<number, QAVerdict>;

  // === Actions ===
  /** Replace all comic faces */
  setComicFaces: (faces: ComicFace[]) => void;
  /** Update a single comic face at index */
  updateComicFace: (index: number, face: Partial<ComicFace>) => void;
  /** Add a new comic face at the end */
  addComicFace: (face: ComicFace) => void;
  /** Insert a comic face at specific index */
  insertComicFace: (index: number, face: ComicFace) => void;
  /** Remove a comic face at index */
  removeComicFace: (index: number) => void;

  /** Replace entire story outline */
  setStoryOutline: (outline: Partial<StoryOutlineState>) => void;
  /** Update only the outline text */
  updateOutlineText: (text: string) => void;
  /** Update page breakdown plans */
  updatePageBreakdown: (breakdown: PageCharacterPlan[]) => void;
  /** Mark outline as ready/not ready */
  setOutlineReady: (isReady: boolean) => void;

  /** Set current page index for viewing */
  setCurrentPageIndex: (index: number) => void;
  /** Navigate to next page */
  nextPage: () => void;
  /** Navigate to previous page */
  previousPage: () => void;

  /** Update generation state */
  setGenerating: (isGenerating: boolean, pageIndex?: number) => void;
  /** Update full generation state */
  updateGenerationState: (state: Partial<GenerationState>) => void;

  /** Add a visual drift warning for a page/character (Feature G) */
  addDriftWarning: (warning: VisualDriftWarning) => void;
  /** Dismiss a specific drift warning */
  dismissDriftWarning: (pageIndex: number, characterId: string) => void;
  /** Clear all drift warnings */
  clearDriftWarnings: () => void;

  /** Record the visual-QA verdict for a page */
  setPageQA: (pageIndex: number, verdict: QAVerdict) => void;
  /** Clear all stored QA verdicts */
  clearPageQA: () => void;

  /** Reset all comic state to initial values */
  resetComic: () => void;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialStoryOutline: StoryOutlineState = {
  text: '',
  pageBreakdown: [],
  isReady: false,
  isGenerating: false,
  isEnhanced: false,
  version: 0,
};

const initialGenerationState: GenerationState = {
  isGenerating: false,
  currentPageIndex: undefined,
  totalPages: undefined,
  progressMessage: undefined,
  generationType: undefined,
};

const initialState = {
  comicFaces: [] as ComicFace[],
  storyOutline: initialStoryOutline,
  currentPageIndex: 0,
  generationState: initialGenerationState,
  visualDriftWarnings: [] as VisualDriftWarning[],
  pageQA: {} as Record<number, QAVerdict>,
};

// ============================================================================
// STORE
// ============================================================================

export const useComicStore = create<ComicState>()(
  immer((set, get) => ({
    // === Initial State ===
    ...initialState,

    // === Comic Faces Actions ===
    setComicFaces: (faces) =>
      set((state) => {
        state.comicFaces = faces;
      }),

    updateComicFace: (index, face) =>
      set((state) => {
        if (index >= 0 && index < state.comicFaces.length) {
          state.comicFaces[index] = { ...state.comicFaces[index], ...face };
        }
      }),

    addComicFace: (face) =>
      set((state) => {
        state.comicFaces.push(face);
      }),

    insertComicFace: (index, face) =>
      set((state) => {
        state.comicFaces.splice(index, 0, face);
      }),

    removeComicFace: (index) =>
      set((state) => {
        if (index >= 0 && index < state.comicFaces.length) {
          state.comicFaces.splice(index, 1);
        }
      }),

    // === Story Outline Actions ===
    setStoryOutline: (outline) =>
      set((state) => {
        state.storyOutline = {
          ...state.storyOutline,
          ...outline,
          lastEditedAt: Date.now(),
          version: state.storyOutline.version + 1,
        };
      }),

    updateOutlineText: (text) =>
      set((state) => {
        state.storyOutline.text = text;
        state.storyOutline.lastEditedAt = Date.now();
        state.storyOutline.version += 1;
      }),

    updatePageBreakdown: (breakdown) =>
      set((state) => {
        state.storyOutline.pageBreakdown = breakdown;
        state.storyOutline.lastEditedAt = Date.now();
      }),

    setOutlineReady: (isReady) =>
      set((state) => {
        state.storyOutline.isReady = isReady;
      }),

    // === Navigation Actions ===
    setCurrentPageIndex: (index) =>
      set((state) => {
        const maxIndex = Math.max(0, state.comicFaces.length - 1);
        state.currentPageIndex = Math.max(0, Math.min(index, maxIndex));
      }),

    nextPage: () =>
      set((state) => {
        const maxIndex = Math.max(0, state.comicFaces.length - 1);
        if (state.currentPageIndex < maxIndex) {
          state.currentPageIndex += 1;
        }
      }),

    previousPage: () =>
      set((state) => {
        if (state.currentPageIndex > 0) {
          state.currentPageIndex -= 1;
        }
      }),

    // === Generation State Actions ===
    setGenerating: (isGenerating, pageIndex) =>
      set((state) => {
        state.generationState.isGenerating = isGenerating;
        state.generationState.currentPageIndex = pageIndex;
        if (!isGenerating) {
          // Clear progress when generation stops
          state.generationState.progressMessage = undefined;
          state.generationState.generationType = undefined;
        }
      }),

    updateGenerationState: (newState) =>
      set((state) => {
        state.generationState = { ...state.generationState, ...newState };
      }),

    // === Visual QA Actions ===
    setPageQA: (pageIndex, verdict) =>
      set((state) => {
        state.pageQA[pageIndex] = verdict;
      }),

    clearPageQA: () =>
      set((state) => {
        state.pageQA = {};
      }),

    // === Visual Drift Warning Actions (Feature G) ===
    addDriftWarning: (warning) =>
      set((state) => {
        // Avoid duplicate warnings for same page+character
        const exists = state.visualDriftWarnings.some(
          w => w.pageIndex === warning.pageIndex && w.characterId === warning.characterId
        );
        if (!exists) {
          state.visualDriftWarnings.push(warning);
        }
      }),

    dismissDriftWarning: (pageIndex, characterId) =>
      set((state) => {
        const idx = state.visualDriftWarnings.findIndex(
          w => w.pageIndex === pageIndex && w.characterId === characterId
        );
        if (idx !== -1) {
          state.visualDriftWarnings[idx].dismissedAt = Date.now();
        }
      }),

    clearDriftWarnings: () =>
      set((state) => {
        state.visualDriftWarnings = [];
      }),

    // === Reset Action ===
    resetComic: () =>
      set((state) => {
        state.comicFaces = [];
        state.storyOutline = { ...initialStoryOutline };
        state.currentPageIndex = 0;
        state.generationState = { ...initialGenerationState };
        state.visualDriftWarnings = [];
      }),
  }))
);

// ============================================================================
// SELECTORS (for optimized re-renders)
// ============================================================================

/** Select current comic face being viewed */
export const selectCurrentFace = (state: ComicState): ComicFace | undefined =>
  state.comicFaces[state.currentPageIndex];

/** Select whether there are any pages */
export const selectHasPages = (state: ComicState): boolean =>
  state.comicFaces.length > 0;

/** Select total page count */
export const selectPageCount = (state: ComicState): number =>
  state.comicFaces.length;

/** Select whether generation is in progress */
export const selectIsGenerating = (state: ComicState): boolean =>
  state.generationState.isGenerating;

/** Select whether outline is ready */
export const selectOutlineReady = (state: ComicState): boolean =>
  state.storyOutline.isReady;

/** Select pages by type */
export const selectCover = (state: ComicState): ComicFace | undefined =>
  state.comicFaces.find((f) => f.type === 'cover');

export const selectStoryPages = (state: ComicState): ComicFace[] =>
  state.comicFaces.filter((f) => f.type === 'story');

export const selectBackCover = (state: ComicState): ComicFace | undefined =>
  state.comicFaces.find((f) => f.type === 'back_cover');

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type { ComicFace, PageCharacterPlan };
