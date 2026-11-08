/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Custom hook for export/import functionality (draft save/load).
 * Extracted from App.tsx as part of Batch 2.2 decomposition.
 */

import { useComicStore } from '../stores/useComicStore';
import { useCharacterStore } from '../stores/useCharacterStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import type { ComicFace, Persona, StoryContext, StoryOutline } from '../types';
import { DEFAULT_PAGE_LENGTH } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Draft file format - the complete state saved to JSON
 * This structure mirrors what was saved in App.tsx exportDraft
 */
export interface DraftData {
  /** Comic pages (cover, story, back cover) */
  comicFaces: ComicFace[];
  /** History of comic faces (for generation continuity) */
  history: ComicFace[];
  /** Main hero character */
  hero: Persona | null;
  /** Co-star character */
  friend: Persona | null;
  /** Additional cast members */
  additionalCharacters: Persona[];
  /** Story context (title, description, publisher info, etc.) */
  storyContext: StoryContext;
  /** Number of extra pages added */
  extraPages: number;
  /** Story outline data */
  storyOutline: StoryOutline;
  /** Whether using Outline Mode (true) or Novel Mode (false) */
  generateFromOutline: boolean;
  /** Whether rich/novel mode is enabled */
  richMode: boolean;
  /** Selected genre */
  selectedGenre: string;
  /** Selected language code */
  selectedLanguage: string;
  /** Custom premise text (for Custom genre) */
  customPremise: string;
}

/**
 * Result from importing a draft
 */
export interface ImportResult {
  success: boolean;
  error?: string;
  data?: DraftData;
  /** Whether the draft contains generated pages (ready to view) */
  hasPages: boolean;
}

/**
 * Configuration for the useExportImport hook
 */
export interface ExportImportConfig {
  /**
   * Callback to get the current history ref value
   * Required because historyRef is managed in App.tsx
   */
  getHistory: () => ComicFace[];
  /**
   * Callback to set the history ref value on import
   */
  setHistory: (history: ComicFace[]) => void;
  /**
   * Callback to update App.tsx state after successful import
   */
  onImportSuccess: (data: DraftData, hasPages: boolean) => void;
  /**
   * Optional callback for import errors
   */
  onImportError?: (error: string) => void;
}

/**
 * Return type for the useExportImport hook
 */
export interface UseExportImportReturn {
  /**
   * Export current state to a JSON draft file
   * Downloads a file named "{title}_Draft.json"
   */
  exportDraft: (
    storyContext: StoryContext,
    extraPages: number,
    storyOutline: StoryOutline,
    generateFromOutline: boolean,
    richMode: boolean
  ) => void;

  /**
   * Import a draft from a JSON file
   * @param file - The JSON file to import
   * @returns Promise resolving to import result
   */
  importDraft: (file: File) => Promise<ImportResult>;

  /**
   * Validate a draft file without importing
   * @param file - The JSON file to validate
   * @returns Promise resolving to validation result
   */
  validateDraft: (file: File) => Promise<{ valid: boolean; error?: string }>;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sanitize filename for safe download
 */
const sanitizeFilename = (name: string): string => {
  return name
    .replace(/[<>:"/\\|?*]/g, '_') // Replace invalid characters
    .replace(/\s+/g, '_') // Replace whitespace with underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
    .trim() || 'Untitled';
};

/**
 * Read a File as text
 */
const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      resolve(text);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsText(file);
  });
};

/**
 * Validate that the parsed object has required draft fields
 */
const validateDraftStructure = (parsed: unknown): parsed is Partial<DraftData> => {
  if (!parsed || typeof parsed !== 'object') {
    return false;
  }

  const obj = parsed as Record<string, unknown>;

  // At minimum, we need either comicFaces or hero to be a valid draft
  const hasComicFaces = Array.isArray(obj.comicFaces);
  const hasHero = obj.hero !== undefined;
  const hasStoryContext = obj.storyContext !== undefined;

  return hasComicFaces || hasHero || hasStoryContext;
};

// ============================================================================
// HOOK
// ============================================================================

/**
 * Hook that provides export/import functionality for comic drafts.
 * Reads from Zustand stores and manages file download/upload operations.
 */
export const useExportImport = (config: ExportImportConfig): UseExportImportReturn => {
  const { getHistory, setHistory, onImportSuccess, onImportError } = config;

  /**
   * Export the current comic state to a downloadable JSON file
   */
  const exportDraft = (
    storyContext: StoryContext,
    extraPages: number,
    storyOutline: StoryOutline,
    generateFromOutline: boolean,
    richMode: boolean
  ): void => {
    // Read current state from stores
    const { hero, friend, additionalCharacters } = useCharacterStore.getState();
    const { comicFaces } = useComicStore.getState();
    const { selectedGenre, selectedLanguage, customPremise } = useSettingsStore.getState();

    // Build the draft data object
    const draftData: DraftData = {
      comicFaces,
      history: getHistory(),
      hero,
      friend,
      additionalCharacters,
      storyContext,
      extraPages,
      storyOutline,
      generateFromOutline,
      richMode,
      selectedGenre,
      selectedLanguage,
      customPremise,
    };

    // Serialize to JSON
    const jsonString = JSON.stringify(draftData, null, 2);

    // Create blob and download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Create download link and trigger
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${sanitizeFilename(storyContext.title || 'Infinite_Heroes')}_Draft.json`;
    anchor.click();

    // Clean up
    URL.revokeObjectURL(url);

    console.log('[exportDraft] Draft exported successfully:', {
      title: storyContext.title,
      pages: comicFaces.length,
      hasOutline: storyOutline.isReady,
    });
  };

  /**
   * Validate a draft file without fully importing it
   */
  const validateDraft = async (file: File): Promise<{ valid: boolean; error?: string }> => {
    // Check file extension and type
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      return { valid: false, error: 'Please select a valid .json draft file.' };
    }

    try {
      const text = await readFileAsText(file);

      // Check for valid JSON start
      if (!text || !text.trim().startsWith('{')) {
        return { valid: false, error: 'Invalid draft file format. File must contain valid JSON.' };
      }

      const parsed = JSON.parse(text);

      if (!validateDraftStructure(parsed)) {
        return { valid: false, error: 'Invalid draft structure. Missing required fields.' };
      }

      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { valid: false, error: `Failed to parse draft file: ${message}` };
    }
  };

  /**
   * Import a draft from a JSON file
   */
  const importDraft = async (file: File): Promise<ImportResult> => {
    console.log('[importDraft] Called with file:', file.name, file.size, 'bytes');

    // Validate first
    const validation = await validateDraft(file);
    if (!validation.valid) {
      const error = validation.error || 'Invalid draft file';
      console.warn('[importDraft]', error);
      onImportError?.(error);
      return { success: false, error, hasPages: false };
    }

    try {
      const text = await readFileAsText(file);
      const parsed = JSON.parse(text) as Partial<DraftData>;

      console.log('[importDraft] Parsed keys:', Object.keys(parsed));

      // Build complete draft data with defaults for missing fields
      const draftData: DraftData = {
        comicFaces: parsed.comicFaces || [],
        history: parsed.history || [],
        hero: parsed.hero || null,
        friend: parsed.friend || null,
        additionalCharacters: parsed.additionalCharacters || [],
        storyContext: parsed.storyContext || {
          title: '',
          descriptionText: '',
          descriptionFiles: [],
          publisherName: 'Marvel',
          seriesTitle: 'Infinite Heroes',
          issueNumber: '1',
          useOverlayLogo: true,
          artStyle: 'Modern American Comic',
          pageLength: DEFAULT_PAGE_LENGTH,
        },
        extraPages: parsed.extraPages || 0,
        storyOutline: parsed.storyOutline || {
          content: '',
          isReady: false,
          isGenerating: false,
        },
        generateFromOutline: parsed.generateFromOutline ?? false,
        richMode: parsed.richMode ?? true,
        selectedGenre: parsed.selectedGenre || 'Superhero Action',
        selectedLanguage: parsed.selectedLanguage || 'en-US',
        customPremise: parsed.customPremise ?? '',
      };

      // Update Zustand stores
      const { setComicFaces } = useComicStore.getState();
      const { setHero, setFriend, addCharacter, resetCharacters } = useCharacterStore.getState();
      const {
        setSelectedGenre,
        setSelectedLanguage,
        setCustomPremise,
        setGenerateFromOutline,
      } = useSettingsStore.getState();

      // Reset characters and add imported ones
      resetCharacters();
      if (draftData.hero) {
        setHero(draftData.hero);
      }
      if (draftData.friend) {
        setFriend(draftData.friend);
      }
      draftData.additionalCharacters.forEach((char) => {
        addCharacter(char);
      });

      // Update comic state
      setComicFaces(draftData.comicFaces);
      setHistory(draftData.history);

      // Update settings
      setSelectedGenre(draftData.selectedGenre);
      setSelectedLanguage(draftData.selectedLanguage);
      setCustomPremise(draftData.customPremise);
      setGenerateFromOutline(draftData.generateFromOutline);

      const hasPages = draftData.comicFaces.length > 0;

      // Call success callback with full data for App.tsx to handle remaining state
      onImportSuccess(draftData, hasPages);

      console.log('[importDraft] Import successful:', {
        pages: draftData.comicFaces.length,
        hasHero: !!draftData.hero,
        hasFriend: !!draftData.friend,
        additionalChars: draftData.additionalCharacters.length,
      });

      return {
        success: true,
        data: draftData,
        hasPages,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      const error = `Draft import error: ${message}`;
      console.error('[importDraft]', error, err);
      onImportError?.(error);
      return { success: false, error, hasPages: false };
    }
  };

  return {
    exportDraft,
    importDraft,
    validateDraft,
  };
};

export default useExportImport;
