/**
 * Zustand store for character state management
 * Manages hero, friend (co-star), and additional characters along with their AI-generated profiles
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Persona, CharacterProfile, CharacterLockState, CharacterReferenceObject } from '../types';
import { buildCharacterReference } from '../utils/buildCharacterReference';

// ============================================================================
// TYPES
// ============================================================================

export interface CharacterState {
  /** Main character (hero) */
  hero: Persona | null;
  /** Co-star character (optional) */
  friend: Persona | null;
  /** Additional cast members */
  additionalCharacters: Persona[];
  /** AI-analyzed character profiles, keyed by character ID */
  characterProfiles: Map<string, CharacterProfile>;
  /**
   * Per-character attribute lock state (session-only, NOT persisted).
   * Locked attributes are prepended as hard constraints in every generation prompt.
   */
  characterLocks: Map<string, CharacterLockState>;
  /**
   * Compiled character reference objects (session-only, NOT persisted).
   * Built once at session start from Persona + CharacterProfile.
   */
  characterReferences: Map<string, CharacterReferenceObject>;
}

export interface CharacterActions {
  // Hero actions
  setHero: (persona: Persona | null) => void;
  updateHero: (partial: Partial<Persona>) => void;

  // Friend (co-star) actions
  setFriend: (persona: Persona) => void;
  updateFriend: (partial: Partial<Persona>) => void;
  clearFriend: () => void;

  // Additional characters actions
  addCharacter: (persona: Persona) => void;
  updateCharacter: (id: string, partial: Partial<Persona>) => void;
  removeCharacter: (id: string) => void;

  /** Remove all additional characters (and their profiles) */
  clearAdditionalCharacters: () => void;

  // Character profile actions
  setCharacterProfile: (id: string, profile: CharacterProfile) => void;
  updateCharacterProfile: (id: string, partial: Partial<CharacterProfile>) => void;
  clearCharacterProfile: (id: string) => void;
  /** Bulk set all profiles from an array (clears existing and sets new) */
  setAllProfiles: (profiles: CharacterProfile[]) => void;

  // Character lock actions (Feature D)
  setCharacterLock: (id: string, lock: CharacterLockState) => void;
  updateCharacterLock: (id: string, partial: Partial<Omit<CharacterLockState, 'characterId'>>) => void;
  getCharacterLock: (id: string) => CharacterLockState;
  clearCharacterLocks: () => void;


  // Character reference actions (Feature A)
  setCharacterReference: (id: string, ref: CharacterReferenceObject) => void;
  setAllReferences: (refs: CharacterReferenceObject[]) => void;
  getReferencesArray: () => CharacterReferenceObject[];
  clearCharacterReferences: () => void;

  // Utility actions
  resetCharacters: () => void;
}

export interface CharacterSelectors {
  /** Get all characters as an array: [hero, friend, ...additionalCharacters] */
  getAllCharacters: () => Persona[];
  /** Find a character by their ID */
  getCharacterById: (id: string) => Persona | null;
  /** Get profile for a specific character */
  getProfileById: (id: string) => CharacterProfile | undefined;
  /** Get all profiles as an array (for compatibility with existing code) */
  getProfilesArray: () => CharacterProfile[];
  /** Check if all main characters have profiles generated */
  hasAllProfiles: () => boolean;
  /** Get all locked characters as a map (for prompt injection) */
  getLockedCharacters: () => Map<string, CharacterLockState>;
}

export type CharacterStore = CharacterState & CharacterActions & CharacterSelectors;

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialState: CharacterState = {
  hero: null,
  friend: null,
  additionalCharacters: [],
  characterProfiles: new Map(),
  characterLocks: new Map(),
  characterReferences: new Map(),
};

// ============================================================================
// STORE
// ============================================================================

export const useCharacterStore = create<CharacterStore>()(
  persist(
    (set, get) => ({
  // Initial state
  ...initialState,

  // -------------------------------------------------------------------------
  // HERO ACTIONS
  // -------------------------------------------------------------------------

  setHero: (persona: Persona | null) => {
    set({ hero: persona });
  },

  updateHero: (partial: Partial<Persona>) => {
    const { hero } = get();
    if (hero) {
      set({ hero: { ...hero, ...partial } });
    }
  },

  // -------------------------------------------------------------------------
  // FRIEND (CO-STAR) ACTIONS
  // -------------------------------------------------------------------------

  setFriend: (persona: Persona) => {
    set({ friend: persona });
  },

  updateFriend: (partial: Partial<Persona>) => {
    const { friend } = get();
    if (friend) {
      set({ friend: { ...friend, ...partial } });
    }
  },

  clearFriend: () => {
    const { characterProfiles, friend } = get();
    if (friend) {
      // Also remove the friend's profile if it exists
      const newProfiles = new Map(characterProfiles);
      newProfiles.delete(friend.id);
      set({ friend: null, characterProfiles: newProfiles });
    } else {
      set({ friend: null });
    }
  },

  // -------------------------------------------------------------------------
  // ADDITIONAL CHARACTERS ACTIONS
  // -------------------------------------------------------------------------

  addCharacter: (persona: Persona) => {
    set((state) => ({
      additionalCharacters: [...state.additionalCharacters, persona],
    }));
  },

  updateCharacter: (id: string, partial: Partial<Persona>) => {
    set((state) => ({
      additionalCharacters: state.additionalCharacters.map((char) =>
        char.id === id ? { ...char, ...partial } : char
      ),
    }));
  },

  removeCharacter: (id: string) => {
    set((state) => {
      // Also remove the character's profile if it exists
      const newProfiles = new Map(state.characterProfiles);
      newProfiles.delete(id);
      return {
        additionalCharacters: state.additionalCharacters.filter(
          (char) => char.id !== id
        ),
        characterProfiles: newProfiles,
      };
    });
  },

  clearAdditionalCharacters: () => {
    set((state) => {
      const newProfiles = new Map(state.characterProfiles);
      state.additionalCharacters.forEach(c => newProfiles.delete(c.id));
      return { additionalCharacters: [], characterProfiles: newProfiles };
    });
  },

  // -------------------------------------------------------------------------
  // CHARACTER PROFILE ACTIONS
  // -------------------------------------------------------------------------

  setCharacterProfile: (id: string, profile: CharacterProfile) => {
    set((state) => {
      const newProfiles = new Map(state.characterProfiles);
      newProfiles.set(id, profile);
      return { characterProfiles: newProfiles };
    });
  },

  updateCharacterProfile: (id: string, partial: Partial<CharacterProfile>) => {
    set((state) => {
      const existing = state.characterProfiles.get(id);
      if (!existing) return state;

      const updatedProfile = { ...existing, ...partial };
      const newProfiles = new Map(state.characterProfiles);
      newProfiles.set(id, updatedProfile);

      // GAP-6 FIX: Rebuild compiled reference whenever a profile is edited so
      // the descriptor injected into generation prompts stays in sync.
      const newRefs = new Map(state.characterReferences);
      const persona = state.hero?.id === id
        ? state.hero
        : state.friend?.id === id
          ? state.friend
          : state.additionalCharacters.find(c => c.id === id);
      if (persona) {
        newRefs.set(id, buildCharacterReference(persona, updatedProfile));
      }

      return { characterProfiles: newProfiles, characterReferences: newRefs };
    });
  },

  clearCharacterProfile: (id: string) => {
    set((state) => {
      const newProfiles = new Map(state.characterProfiles);
      newProfiles.delete(id);
      return { characterProfiles: newProfiles };
    });
  },

  setAllProfiles: (profiles: CharacterProfile[]) => {
    set(() => {
      const newProfiles = new Map<string, CharacterProfile>();
      profiles.forEach((p) => {
        newProfiles.set(p.id, p);
      });
      return { characterProfiles: newProfiles };
    });
  },

  // -------------------------------------------------------------------------
  // CHARACTER LOCK ACTIONS (Feature D)
  // -------------------------------------------------------------------------

  setCharacterLock: (id: string, lock: CharacterLockState) => {
    set((state) => {
      const newLocks = new Map(state.characterLocks);
      newLocks.set(id, lock);
      return { characterLocks: newLocks };
    });
  },

  updateCharacterLock: (id: string, partial: Partial<Omit<CharacterLockState, 'characterId'>>) => {
    set((state) => {
      const existing = state.characterLocks.get(id) ?? {
        characterId: id,
        lockFace: false,
        lockOutfit: false,
        lockWeapon: false,
        lockEmblem: false,
      };
      const newLocks = new Map(state.characterLocks);
      newLocks.set(id, { ...existing, ...partial });
      return { characterLocks: newLocks };
    });
  },

  getCharacterLock: (id: string) => {
    const lock = get().characterLocks.get(id);
    return lock ?? { characterId: id, lockFace: false, lockOutfit: false, lockWeapon: false, lockEmblem: false };
  },

  clearCharacterLocks: () => {
    set({ characterLocks: new Map() });
  },

  // -------------------------------------------------------------------------
  // CHARACTER REFERENCE ACTIONS (Feature A)
  // -------------------------------------------------------------------------

  setCharacterReference: (id: string, ref: CharacterReferenceObject) => {
    set((state) => {
      const newRefs = new Map(state.characterReferences);
      newRefs.set(id, ref);
      return { characterReferences: newRefs };
    });
  },

  setAllReferences: (refs: CharacterReferenceObject[]) => {
    set(() => {
      const newRefs = new Map<string, CharacterReferenceObject>();
      refs.forEach((r) => newRefs.set(r.characterId, r));
      return { characterReferences: newRefs };
    });
  },

  getReferencesArray: () => {
    return Array.from(get().characterReferences.values());
  },

  clearCharacterReferences: () => {
    set({ characterReferences: new Map() });
  },

  // -------------------------------------------------------------------------
  // UTILITY ACTIONS
  // -------------------------------------------------------------------------

  resetCharacters: () => {
    set({
      hero: null,
      friend: null,
      additionalCharacters: [],
      characterProfiles: new Map(),
      characterLocks: new Map(),
      characterReferences: new Map(),
    });
  },

  // -------------------------------------------------------------------------
  // SELECTORS
  // -------------------------------------------------------------------------

  getAllCharacters: () => {
    const { hero, friend, additionalCharacters } = get();
    const characters: Persona[] = [];

    if (hero) {
      characters.push(hero);
    }
    if (friend) {
      characters.push(friend);
    }
    characters.push(...additionalCharacters);

    return characters;
  },

  getCharacterById: (id: string) => {
    const { hero, friend, additionalCharacters } = get();

    // Check hero
    if (hero && hero.id === id) {
      return hero;
    }

    // Check friend
    if (friend && friend.id === id) {
      return friend;
    }

    // Check additional characters
    const found = additionalCharacters.find((char) => char.id === id);
    return found || null;
  },

  getProfileById: (id: string) => {
    const { characterProfiles } = get();
    return characterProfiles.get(id);
  },

  getProfilesArray: () => {
    const { characterProfiles } = get();
    return Array.from(characterProfiles.values());
  },

  getLockedCharacters: () => {
    return get().characterLocks;
  },

  hasAllProfiles: () => {
    const { hero, friend, additionalCharacters, characterProfiles } = get();

    // Check hero has profile
    if (hero && !characterProfiles.has(hero.id)) {
      return false;
    }

    // Check friend has profile (if exists)
    if (friend && !characterProfiles.has(friend.id)) {
      return false;
    }

    // Check all additional characters have profiles
    for (const char of additionalCharacters) {
      if (!characterProfiles.has(char.id)) {
        return false;
      }
    }

    return true;
  },
    }),
    {
      name: 'infinite-heroes-character-locks',
      partialize: (state) => {
        // Serialize characterProfiles with size guard (~1.5MB limit).
        // Profiles can grow large if colorPalette/extractedColors contain verbose text.
        const profileEntries = Array.from(state.characterProfiles.entries());
        const serializedProfiles = JSON.stringify(profileEntries);
        const profilesTooLarge = serializedProfiles.length > 1_500_000;
        if (profilesTooLarge) {
          console.warn(
            `[CharacterStore] Profiles too large to persist (~${Math.round(serializedProfiles.length / 1024)}KB). Skipping profile persistence.`
          );
        }
        return {
          characterLocks: Array.from(state.characterLocks.entries()),
          characterProfiles: profilesTooLarge ? [] : profileEntries,
        };
      },
      merge: (persistedState: unknown, currentState) => {
        const ps = persistedState as {
          characterLocks?: Array<[string, CharacterLockState]>;
          characterProfiles?: Array<[string, CharacterProfile]>;
        };
        return {
          ...currentState,
          characterLocks: ps?.characterLocks
            ? new Map(ps.characterLocks)
            : new Map(),
          characterProfiles: ps?.characterProfiles && ps.characterProfiles.length > 0
            ? new Map(ps.characterProfiles)
            : new Map(),
        };
      },
    }
  )
);

// ============================================================================
// SELECTOR HOOKS (for optimized re-renders)
// ============================================================================

/** Select just the hero */
export const useHero = () => useCharacterStore((state) => state.hero);

/** Select just the friend/co-star */
export const useFriend = () => useCharacterStore((state) => state.friend);

/** Select additional characters array */
export const useAdditionalCharacters = () =>
  useCharacterStore((state) => state.additionalCharacters);

/** Select character profiles map */
export const useCharacterProfiles = () =>
  useCharacterStore((state) => state.characterProfiles);

/** Select a specific character by ID */
export const useCharacterById = (id: string) =>
  useCharacterStore((state) => state.getCharacterById(id));

/** Select a specific profile by character ID */
export const useProfileById = (id: string) =>
  useCharacterStore((state) => state.characterProfiles.get(id));

// ============================================================================
// ACTION HOOKS (for components that only need actions)
// ============================================================================

export const useCharacterActions = () =>
  useCharacterStore((state) => ({
    setHero: state.setHero,
    updateHero: state.updateHero,
    setFriend: state.setFriend,
    updateFriend: state.updateFriend,
    clearFriend: state.clearFriend,
    addCharacter: state.addCharacter,
    updateCharacter: state.updateCharacter,
    removeCharacter: state.removeCharacter,
    setCharacterProfile: state.setCharacterProfile,
    updateCharacterProfile: state.updateCharacterProfile,
    clearCharacterProfile: state.clearCharacterProfile,
    setAllProfiles: state.setAllProfiles,
    setCharacterLock: state.setCharacterLock,
    updateCharacterLock: state.updateCharacterLock,
    clearCharacterLocks: state.clearCharacterLocks,
    setCharacterReference: state.setCharacterReference,
    setAllReferences: state.setAllReferences,
    clearCharacterReferences: state.clearCharacterReferences,
    resetCharacters: state.resetCharacters,
  }));

/** Select character locks map */
export const useCharacterLocks = () =>
  useCharacterStore((state) => state.characterLocks);

/** Select lock state for a specific character */
export const useCharacterLock = (id: string) =>
  useCharacterStore((state) => state.characterLocks.get(id) ?? {
    characterId: id,
    lockFace: false,
    lockOutfit: false,
    lockWeapon: false,
    lockEmblem: false,
  });

export default useCharacterStore;
