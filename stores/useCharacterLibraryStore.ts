/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Zustand store for character library management
 * Allows users to save characters (with their profiles) separately from the current comic
 * for reuse across projects. Persisted to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Persona, CharacterProfile } from '../types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * A saved character in the library, combining persona and optional profile
 */
export interface LibraryCharacter {
  /** Unique identifier for this saved character */
  id: string;
  /** The character's persona data (portrait, description, role, etc.) */
  persona: Persona;
  /** AI-generated character profile for consistency (optional) */
  profile?: CharacterProfile;
  /** Timestamp when the character was saved to the library */
  savedAt: number;
  /** Optional tags for categorization and search */
  tags?: string[];
}

export interface CharacterLibraryState {
  /** All saved characters in the library */
  savedCharacters: LibraryCharacter[];
}

export interface CharacterLibraryActions {
  /**
   * Save a character to the library
   * @param persona - The character's persona data
   * @param profile - Optional AI-generated profile for consistency
   * @param tags - Optional tags for categorization
   * @returns The generated unique ID for the saved character
   */
  saveCharacter: (
    persona: Persona,
    profile?: CharacterProfile,
    tags?: string[]
  ) => string;

  /**
   * Update an existing saved character
   * @param id - The character's library ID
   * @param updates - Partial updates to apply
   */
  updateCharacter: (id: string, updates: Partial<LibraryCharacter>) => void;

  /**
   * Delete a character from the library
   * @param id - The character's library ID
   */
  deleteCharacter: (id: string) => void;

  /**
   * Get a character by their library ID
   * @param id - The character's library ID
   * @returns The character or undefined if not found
   */
  getCharacterById: (id: string) => LibraryCharacter | undefined;

  /**
   * Search characters by name or tags
   * @param query - Search query string
   * @returns Array of matching characters
   */
  searchCharacters: (query: string) => LibraryCharacter[];

  /**
   * Get all characters with a specific tag
   * @param tag - The tag to filter by
   * @returns Array of characters with that tag
   */
  getCharactersByTag: (tag: string) => LibraryCharacter[];

  /**
   * Get all unique tags in the library
   * @returns Array of unique tag strings
   */
  getAllTags: () => string[];

  /**
   * Clear all characters from the library
   */
  clearLibrary: () => void;
}

export type CharacterLibraryStore = CharacterLibraryState & CharacterLibraryActions;

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Generate a unique ID for a library character
 */
function generateLibraryId(): string {
  return `lib_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Normalize a string for search comparison
 */
function normalizeForSearch(str: string): string {
  return str.toLowerCase().trim();
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: CharacterLibraryState = {
  savedCharacters: [],
};

// ============================================================================
// STORAGE KEY
// ============================================================================

const STORAGE_KEY = 'infinite-heroes-character-library';

// ============================================================================
// STORE
// ============================================================================

export const useCharacterLibraryStore = create<CharacterLibraryStore>()(
  persist(
    (set, get) => ({
      // Initial state
      ...initialState,

      // -------------------------------------------------------------------------
      // ACTIONS
      // -------------------------------------------------------------------------

      saveCharacter: (
        persona: Persona,
        profile?: CharacterProfile,
        tags?: string[]
      ): string => {
        const id = generateLibraryId();
        const newCharacter: LibraryCharacter = {
          id,
          persona,
          profile,
          savedAt: Date.now(),
          tags: tags || [],
        };

        set((state) => ({
          savedCharacters: [...state.savedCharacters, newCharacter],
        }));

        return id;
      },

      updateCharacter: (id: string, updates: Partial<LibraryCharacter>) => {
        set((state) => ({
          savedCharacters: state.savedCharacters.map((char) =>
            char.id === id ? { ...char, ...updates } : char
          ),
        }));
      },

      deleteCharacter: (id: string) => {
        set((state) => ({
          savedCharacters: state.savedCharacters.filter((char) => char.id !== id),
        }));
      },

      getCharacterById: (id: string): LibraryCharacter | undefined => {
        const { savedCharacters } = get();
        return savedCharacters.find((char) => char.id === id);
      },

      searchCharacters: (query: string): LibraryCharacter[] => {
        const { savedCharacters } = get();
        const normalizedQuery = normalizeForSearch(query);

        if (!normalizedQuery) {
          return savedCharacters;
        }

        return savedCharacters.filter((char) => {
          // Search by persona name
          const nameMatch = normalizeForSearch(char.persona.name).includes(
            normalizedQuery
          );

          // Search by tags
          const tagMatch = char.tags?.some((tag) =>
            normalizeForSearch(tag).includes(normalizedQuery)
          );

          // Search by description
          const descMatch = char.persona.backstoryText
            ? normalizeForSearch(char.persona.backstoryText).includes(normalizedQuery)
            : false;

          // Search by role
          const roleMatch = char.persona.role
            ? normalizeForSearch(char.persona.role).includes(normalizedQuery)
            : false;

          return nameMatch || tagMatch || descMatch || roleMatch;
        });
      },

      getCharactersByTag: (tag: string): LibraryCharacter[] => {
        const { savedCharacters } = get();
        const normalizedTag = normalizeForSearch(tag);

        return savedCharacters.filter((char) =>
          char.tags?.some((t) => normalizeForSearch(t) === normalizedTag)
        );
      },

      getAllTags: (): string[] => {
        const { savedCharacters } = get();
        const tagSet = new Set<string>();

        savedCharacters.forEach((char) => {
          char.tags?.forEach((tag) => tagSet.add(tag));
        });

        return Array.from(tagSet).sort();
      },

      clearLibrary: () => {
        set({ savedCharacters: [] });
      },
    }),
    {
      name: STORAGE_KEY,
      // Only persist the savedCharacters array
      partialize: (state) => ({
        savedCharacters: state.savedCharacters,
      }),
    }
  )
);

// ============================================================================
// SELECTOR HOOKS (for optimized re-renders)
// ============================================================================

/** Select all saved characters */
export const useSavedCharacters = () =>
  useCharacterLibraryStore((state) => state.savedCharacters);

/** Select saved characters count */
export const useSavedCharactersCount = () =>
  useCharacterLibraryStore((state) => state.savedCharacters.length);

/** Select a specific saved character by ID */
export const useSavedCharacterById = (id: string) =>
  useCharacterLibraryStore((state) =>
    state.savedCharacters.find((char) => char.id === id)
  );

/** Select all unique tags */
export const useAllTags = () =>
  useCharacterLibraryStore((state) => {
    const tagSet = new Set<string>();
    state.savedCharacters.forEach((char) => {
      char.tags?.forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  });

// ============================================================================
// ACTION HOOKS (for components that only need actions)
// ============================================================================

export const useCharacterLibraryActions = () =>
  useCharacterLibraryStore((state) => ({
    saveCharacter: state.saveCharacter,
    updateCharacter: state.updateCharacter,
    deleteCharacter: state.deleteCharacter,
    getCharacterById: state.getCharacterById,
    searchCharacters: state.searchCharacters,
    getCharactersByTag: state.getCharactersByTag,
    getAllTags: state.getAllTags,
    clearLibrary: state.clearLibrary,
  }));

export default useCharacterLibraryStore;
