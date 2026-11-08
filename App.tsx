
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import jsPDF from 'jspdf';
import { getComicConfig, DEFAULT_PAGE_LENGTH, isCastMember, ART_STYLES, GENRES, TONES, LANGUAGES, ComicFace, Beat, Persona, StoryContext, StoryOutline, CharacterProfile, NOVEL_MODE_BATCH_SIZE, generateHardNegatives, formatIdentityHeader, formatReinforcedScene, formatConsistencyInstruction, IdentityHeader, RegenerationMode, PageCharacterPlan, TransitionType, ShotType, PanelLayout, EmotionalBeat, PacingIntent, BalloonShape, RerollOptions, getLayoutInstructions, getShotInstructions, getTransitionContext, getFlashbackInstructions, NovelModeState, DraftKind } from './types';
import { COMIC_PRESETS, ComicPreset } from './data/comicPresets';
import { Setup } from './Setup';
import { Book } from './Book';

import { OutlineDialog } from './OutlineDialog';

import { useApiKey } from './useApiKey';
import { ApiKeyDialog } from './ApiKeyDialog';
import { ExportDialog, ExportOptions, PAGE_SIZES, RESOLUTION_OPTIONS } from './ExportDialog';
import { ProfilesDialog } from './ProfilesDialog';

import { OutlineStepDialog } from './OutlineStepDialog';
import { ModeSelectionScreen } from './ModeSelectionScreen';
import { CoverVariantSelector } from './components';
import { createImageContent, createTextContent, extractJsonFromResponse, getTextFromClaudeResponse, ClaudeContentBlock, detectImageMimeType } from './claudeHelpers';

// --- Zustand Stores ---
import { useCharacterStore, useHero, useFriend, useAdditionalCharacters } from './stores/useCharacterStore';
import { useComicStore } from './stores/useComicStore';
import { useSettingsStore } from './stores/useSettingsStore';
import { useSessionHistoryStore } from './stores/useSessionHistoryStore';

// --- Feature imports ---

import { SingleImageMode, SingleImageGenerateParams } from './SingleImageMode';
import { galleryAdd, GalleryImage } from './hooks/useGalleryDB';
import { TutorialModal } from './components/TutorialModal';


// --- Generation Hooks ---
import { useGenerateBeat } from './hooks/useGenerateBeat';
import { useGenerateImage, ComicOverrides } from './hooks/useGenerateImage';
import { useGenerateProfile } from './hooks/useGenerateProfile';
import { useGenerateOutline } from './hooks/useGenerateOutline';
import { useGenerateModelSheet, hasValidModelSheet } from './hooks/useGenerateModelSheet';
import { useVisualQA, type QACharacterInput } from './hooks/useVisualQA';
import { retryWithBackoff } from './utils/retryWithBackoff';
import { convertToCmykSafe, analyzeGamut } from './utils/cmykExport';
import { downloadAsZip } from './utils/zipDownload';
import { composeLettering } from './utils/composeLettering';
import { placedSFXToElement } from './components/SFXEditor';
import { softenScene, SAFE_RETRY_DIRECTION } from './utils/sceneSafety';
import { saveSnapshot, loadSnapshot, deleteSnapshot, pruneSnapshots, CAST_SNAPSHOT_KEY } from './utils/sessionSnapshots';
import { generationAnnouncement } from './utils/comicAccessibility';
import { GenerationConfirmDialog, type GenerationPlan } from './components/GenerationConfirmDialog';
import type { ModelSheetState } from './components/ModelSheetStrip';
import { ScriptReader } from './components/ScriptReader';
import { useConfirm } from './components/ConfirmDialog';
import { useToast } from './contexts/ToastContext';



import type { SpeechBubble, PlacedSFX } from './types';
import { createImageQueue } from './utils/requestQueue';
import { useExportImport } from './hooks/useExportImport';
import { buildAllCharacterReferences } from './utils/buildCharacterReference';

// --- Feature G: Visual Drift Detection ---
import { checkVisualDrift } from './utils/visualDriftDetector';
import { DriftWarningToast } from './components/DriftWarningToast';

/*
 * Modals are loaded on demand.
 *
 * Each is only reachable behind a visibility flag, but all of them were bundled
 * into the initial chunk — so first paint paid for a speech-bubble editor, an SFX
 * placement tool, and two galleries that most sessions never open.
 *
 * React.lazy needs a default export; these components are named exports, so each
 * import is mapped to one.
 */
const RerollModal = React.lazy(() => import('./RerollModal').then(m => ({ default: m.RerollModal })));
const GalleryModal = React.lazy(() => import('./GalleryModal').then(m => ({ default: m.GalleryModal })));
const SettingsDialog = React.lazy(() => import('./SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const GlobalGalleryModal = React.lazy(() => import('./components/GlobalGalleryModal').then(m => ({ default: m.GlobalGalleryModal })));
const TutorialPage = React.lazy(() => import('./components/TutorialPage').then(m => ({ default: m.TutorialPage })));
const BubbleEditor = React.lazy(() => import('./components/BubbleEditor').then(m => ({ default: m.BubbleEditor })));
const SFXEditor = React.lazy(() => import('./components/SFXEditor').then(m => ({ default: m.SFXEditor })));
const CharacterLibraryModal = React.lazy(() => import('./components/CharacterLibraryModal').then(m => ({ default: m.CharacterLibraryModal })));

/** Shown while a lazily-loaded modal arrives. */
const ModalFallback: React.FC = () => (
  <div className="fixed inset-0 z-[800] flex items-center justify-center bg-black/60">
    <p className="font-comic text-white text-lg uppercase tracking-widest">Loading…</p>
  </div>
);

// --- Constants ---
const MODEL_IMAGE_GEN_NAME = "gemini-3-pro-image-preview";
const MODEL_TEXT_NAME = "gemini-2.5-pro"; // Gemini fallback
const MODEL_TEXT_NAME_CLAUDE = "claude-sonnet-4-5-20250929";

/**
 * How many sessions keep a restorable snapshot.
 *
 * The session list holds 50 entries, but a snapshot runs to roughly 10MB, so
 * snapshotting all of them would mean hundreds of megabytes of IndexedDB.
 * Older sessions keep their metadata row and can still be recovered from an
 * exported draft file.
 */
const MAX_SESSION_SNAPSHOTS = 10;

// --- Storage Constants ---
const STORAGE_LIMIT = 5 * 1024 * 1024; // 5MB typical localStorage limit
const STORAGE_SAFE_LIMIT = 4 * 1024 * 1024; // 4MB safe limit for cast data
const STORAGE_WARNING_THRESHOLD = 3 * 1024 * 1024; // 3MB - warn user

// --- Storage Usage Helper ---
interface StorageUsageInfo {
  currentBytes: number;
  percentUsed: number;
  imagesStripped: boolean;
  isApproachingLimit: boolean;
  isOverLimit: boolean;
}

const checkStorageUsage = (payload: string, wasStripped: boolean = false): StorageUsageInfo => {
  const currentBytes = new Blob([payload]).size;
  const percentUsed = Math.round((currentBytes / STORAGE_SAFE_LIMIT) * 100);

  return {
    currentBytes,
    percentUsed: Math.min(percentUsed, 100),
    imagesStripped: wasStripped,
    isApproachingLimit: currentBytes > STORAGE_WARNING_THRESHOLD,
    isOverLimit: currentBytes > STORAGE_SAFE_LIMIT
  };
};

const App: React.FC = () => {
  // --- API Key Hook ---
  const { validateApiKey, setShowApiKeyDialog, showApiKeyDialog, handleApiKeyDialogContinue } = useApiKey();

  const isCastLoadedRef = useRef(false);
  /**
   * True while the cast is being read back from IndexedDB.
   *
   * The read is async and a cast with portraits and model sheets runs to several
   * megabytes, so there is a visible gap before the fields populate. Without an
   * indicator the setup screen looks empty and users reasonably conclude their
   * characters are gone.
   */
  const [isCastLoading, setIsCastLoading] = useState(true);

  useEffect(() => {
    /*
     * Load the cast from IndexedDB, falling back to the legacy localStorage
     * copy. The fallback still matters: it holds whatever a previous version of
     * the app saved, and it is the only option where IndexedDB is unavailable.
     * Being async, this runs a tick later than the old synchronous read —
     * isCastLoadedRef guards the save effect from firing on the empty state in
     * between and wiping the stored cast.
     */
    let cancelled = false;

    const applyCast = (parsed: { hero?: Persona; friend?: Persona; additionalCharacters?: Persona[] } | null) => {
      if (cancelled || !parsed) return false;
      try {
        const store = useCharacterStore.getState();
        if (parsed.hero) store.setHero(parsed.hero);
        if (parsed.friend) store.setFriend(parsed.friend);
        if (parsed.additionalCharacters) {
          parsed.additionalCharacters.forEach((char: Persona) => store.addCharacter(char));
        }

        // Phase 1.2 — Rebuild characterReferences from persisted profiles.
        // Profiles are already in the store (Zustand persist hydrates before this useEffect runs).
        // References are derived data and must be rebuilt on each session start.
        const storeState = useCharacterStore.getState();
        const persistedProfiles = storeState.getProfilesArray();
        if (persistedProfiles.length > 0) {
          const personas: Persona[] = [
            parsed.hero,
            parsed.friend,
            ...(parsed.additionalCharacters ?? []),
          ].filter(Boolean) as Persona[];
          if (personas.length > 0) {
            const refs = buildAllCharacterReferences(personas, persistedProfiles);
            storeState.setAllReferences(refs);
            console.log(`[CharacterStore] Rebuilt ${refs.length} character reference(s) from persisted profiles.`);
          }
        }
        return true;
      } catch (e) {
        console.error('Failed to load cast', e);
        return false;
      }
    };

    (async () => {
      const fromDb = await loadSnapshot(CAST_SNAPSHOT_KEY).catch(() => null);
      let applied = false;
      if (fromDb?.success && fromDb.data) {
        applied = applyCast(fromDb.data as { hero?: Persona; friend?: Persona; additionalCharacters?: Persona[] });
      }
      if (!applied) {
        const legacy = localStorage.getItem('infinite_heroes_cast');
        if (legacy) {
          try {
            applied = applyCast(JSON.parse(legacy));
            if (applied) console.log('[cast] loaded from legacy localStorage; will migrate to IndexedDB on next change');
          } catch (e) {
            console.error('Failed to parse legacy cast', e);
          }
        }
      }
      if (!cancelled) {
        isCastLoadedRef.current = true;
        setIsCastLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Zustand selector hooks — single source of truth for character data
  const hero = useHero();
  const friend = useFriend();
  const additionalCharacters = useAdditionalCharacters();
  const [storyContext, setStoryContext] = useState<StoryContext>({
    title: "",
    descriptionText: "",
    descriptionFiles: [],
    publisherName: "Marvel",
    seriesTitle: "Infinite Heroes",
    issueNumber: "1",
    useOverlayLogo: true,
    artStyle: ART_STYLES[0],
    pageLength: DEFAULT_PAGE_LENGTH
  });

  const [generateFromOutline, setGenerateFromOutline] = useState(false);
  const [storyOutline, setStoryOutline] = useState<StoryOutline>({
    content: "",
    isReady: false,
    isGenerating: false
  });
  const [outlineNotes, setOutlineNotes] = useState("");
  const [showOutlineStep, setShowOutlineStep] = useState(false);

  // --- Sync storyOutline to Zustand comic store ---
  useEffect(() => {
    useComicStore.getState().setStoryOutline({
      text: storyOutline.content,
      isReady: storyOutline.isReady,
      isGenerating: storyOutline.isGenerating,
    });
  }, [storyOutline]);

  const [selectedGenre, setSelectedGenre] = useState(GENRES[0]);
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0].code);
  const [customPremise, setCustomPremise] = useState("");
  const [storyTone, setStoryTone] = useState(TONES[0]);
  const [richMode, setRichMode] = useState(true);

  // --- Sync settings to Zustand store ---
  useEffect(() => {
    useSettingsStore.getState().setSelectedGenre(selectedGenre);
  }, [selectedGenre]);

  useEffect(() => {
    useSettingsStore.getState().setSelectedLanguage(selectedLanguage);
  }, [selectedLanguage]);

  useEffect(() => {
    useSettingsStore.getState().setCustomPremise(customPremise);
  }, [customPremise]);

  useEffect(() => {
    useSettingsStore.getState().setGenerateFromOutline(generateFromOutline);
  }, [generateFromOutline]);

  // --- Store Getters (replace refs with Zustand store reads) ---
  // These are convenience functions that read from the Zustand store
  // They replace the previous ref pattern for accessing character data in async callbacks
  const getHero = () => useCharacterStore.getState().hero;
  const getFriend = () => useCharacterStore.getState().friend;
  const getAdditionalChars = () => useCharacterStore.getState().additionalCharacters.filter(isCastMember);
  const getProfilesArray = () => useCharacterStore.getState().getProfilesArray();

  /** Debounce handle for cast persistence. */
  const castSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isCastLoadedRef.current) return;

    /*
     * The cast lives in IndexedDB, not localStorage.
     *
     * localStorage caps around 5MB. A cast carries portraits, reference images,
     * emblems, weapons, and a multi-megabyte model sheet per character, so the
     * old code hit the ceiling and responded by deleting the images to keep the
     * text. A returning user then had characters with no reference art, and
     * generation quietly fell back to text-only descriptions — which is exactly
     * the condition that produces drift.
     *
     * A text-only copy still goes to localStorage as a fallback for browsers
     * where IndexedDB is unavailable or blocked (private mode in some browsers).
     */
    if (castSaveTimerRef.current) clearTimeout(castSaveTimerRef.current);
    castSaveTimerRef.current = setTimeout(() => {
      saveSnapshot(CAST_SNAPSHOT_KEY, { hero, friend, additionalCharacters })
        .then(r => {
          if (r.success) {
            setStorageWarning(null);
            return;
          }
          console.warn('[cast] IndexedDB save failed, falling back to text-only localStorage:', r.error);
          const stripStr = (p: Persona | null) => p ? {
            ...p, base64: '', referenceImage: '', referenceImages: [], backstoryFiles: [],
            emblemImage: undefined, weaponImage: undefined, modelSheet: undefined,
          } : null;
          const strippedPayload = JSON.stringify({
            hero: stripStr(hero),
            friend: stripStr(friend),
            additionalCharacters: additionalCharacters.map(c => stripStr(c)).filter(Boolean) as Persona[],
          });
          try {
            localStorage.setItem('infinite_heroes_cast', strippedPayload);
            setStorageWarning(checkStorageUsage(JSON.stringify({ hero, friend, additionalCharacters }), true));
            setDismissedStorageWarning(false);
          } catch (err) {
            console.error('[cast] even text metadata failed to save:', err);
          }
        })
        .catch(e => console.warn('[cast] save threw:', e));
    }, 1500);

    return () => {
      if (castSaveTimerRef.current) clearTimeout(castSaveTimerRef.current);
    };
  }, [hero, friend, additionalCharacters]);

  // --- Character State Setters (Zustand is the single source of truth) ---
  const setHero = (p: Persona | null) => {
    useCharacterStore.getState().setHero(p);
  };
  const setFriend = (p: Persona | null) => {
    if (p) useCharacterStore.getState().setFriend(p);
    else useCharacterStore.getState().clearFriend();
  };

  const handleAddCharacter = () => {
    const newChar: Persona = {
      id: crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 11),
      name: `Character ${additionalCharacters.length + 3}`,
      base64: "",
      desc: "Additional Character",
      backstoryFiles: []
    };
    useCharacterStore.getState().addCharacter(newChar);
  };

  /**
   * Apply a partial update to any character by id.
   * The store splits hero/friend from additionalCharacters, so this routes to
   * the right setter instead of silently dropping updates to the leads.
   */
  const updateAnyCharacter = (id: string, updates: Partial<Persona>) => {
      const store = useCharacterStore.getState();
      if (store.hero?.id === id) store.updateHero(updates);
      else if (store.friend?.id === id) store.updateFriend(updates);
      else store.updateCharacter(id, updates);
  };

  /** Generate (or reroll) one character's model sheet. */
  const handleGenerateModelSheet = async (personaId: string) => {
      const store = useCharacterStore.getState();
      const persona = [store.hero, store.friend, ...store.additionalCharacters]
          .find(p => p?.id === personaId);
      if (!persona) return;

      setModelSheetStates(prev => ({ ...prev, [personaId]: { isGenerating: true } }));
      try {
          const result = await generateModelSheet({
              persona,
              artStyle: storyContext.artStyle,
              profile: store.characterProfiles.get(personaId),
          });
          if (result.imageUrl) {
              updateAnyCharacter(personaId, {
                  modelSheet: result.imageUrl,
                  modelSheetStyle: storyContext.artStyle,
                  modelSheetAt: Date.now(),
                  modelSheetSource: 'generated',
              });
              setModelSheetStates(prev => ({ ...prev, [personaId]: { isGenerating: false } }));
          } else {
              setModelSheetStates(prev => ({
                  ...prev,
                  [personaId]: { isGenerating: false, error: result.failureReason ?? 'failed' },
              }));
          }
      } catch (e) {
          console.error('[modelSheet] generation failed', e);
          setModelSheetStates(prev => ({
              ...prev, [personaId]: { isGenerating: false, error: 'failed' },
          }));
      }
  };

  /**
   * Use an image the user already has as the canonical model sheet.
   *
   * Plenty of people arrive with existing character art — a commissioned
   * turnaround, a reference sheet built elsewhere — which is a better source of
   * truth than anything generated from a photo. Tagged with the current art
   * style, since uploading is the user asserting it matches.
   */
  const handleUploadModelSheet = async (personaId: string, file: File) => {
      if (!file.type.startsWith('image/')) {
          setModelSheetStates(prev => ({
              ...prev, [personaId]: { isGenerating: false, error: 'not an image file' },
          }));
          return;
      }
      setModelSheetStates(prev => ({ ...prev, [personaId]: { isGenerating: true } }));
      try {
          // Full data URL, not bare base64: the sheet is rendered via <img src>
          // and downloaded via an anchor href, both of which need the prefix.
          const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(file);
          });
          updateAnyCharacter(personaId, {
              modelSheet: dataUrl,
              modelSheetStyle: storyContext.artStyle,
              modelSheetAt: Date.now(),
              modelSheetSource: 'uploaded',
          });
          setModelSheetStates(prev => ({ ...prev, [personaId]: { isGenerating: false } }));
      } catch (e) {
          console.error('[modelSheet] upload failed', e);
          setModelSheetStates(prev => ({
              ...prev, [personaId]: { isGenerating: false, error: 'could not read that file' },
          }));
      }
  };

  /** Drop a model sheet so pages fall back to the raw portrait. */
  const handleClearModelSheet = (personaId: string) => {
      updateAnyCharacter(personaId, {
          modelSheet: undefined, modelSheetStyle: undefined,
          modelSheetAt: undefined, modelSheetSource: undefined,
      });
      setModelSheetStates(prev => ({ ...prev, [personaId]: { isGenerating: false } }));
  };

  /**
   * Generate sheets for every character still missing a current one.
   * Sequential on purpose — this is the casting step, and a burst of image calls
   * is exactly the pattern that trips rate limits.
   */
  const handleGenerateAllModelSheets = async () => {
      const store = useCharacterStore.getState();
      const cast = [store.hero, store.friend, ...store.additionalCharacters].filter(Boolean) as Persona[];
      for (const p of cast) {
          if (p.modelSheet && p.modelSheetStyle === storyContext.artStyle) continue;
          await handleGenerateModelSheet(p.id);
      }
  };

  const handleUpdateCharacter = (id: string, updates: Partial<Persona>) => {
    // Phase 5.2 — Mark profile stale when portrait changes for additional characters
    if (updates.base64) {
      const existing = useCharacterStore.getState().getCharacterById(id);
      if (existing && updates.base64 !== existing.base64) {
        useCharacterStore.getState().markProfileStale(id);
      }
    }
    useCharacterStore.getState().updateCharacter(id, updates);
  };

  const handleDeleteCharacter = (id: string) => {
    useCharacterStore.getState().removeCharacter(id);
  };

  const processFiles = async (files: FileList) => {
    const results: { base64: string; mimeType: string; name: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const base64 = await fileToBase64(file);
      results.push({ base64, mimeType: file.type, name: file.name });
    }
    return results;
  };
  
  const [comicFaces, setComicFaces] = useState<ComicFace[]>([]);
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const [isStarted, setIsStarted] = useState(false);

  // Phase 4.2 — Outline Mode generation progress (null = not generating)
  const [generationProgress, setGenerationProgress] = useState<{ current: number; total: number } | null>(null);
  /** Pending run awaiting the user's cost/time confirmation. */
  const [pendingPlan, setPendingPlan] = useState<GenerationPlan | null>(null);
  /** Per-character model sheet generation state, keyed by persona id. */
  const [modelSheetStates, setModelSheetStates] = useState<Record<string, ModelSheetState>>({});
  /** Reading mode: the comic rendered as text. */
  const [showScriptReader, setShowScriptReader] = useState(false);
  // Replaces window.confirm, which returns false when the browser suppresses it
  // and so made confirmed actions look like dead buttons.
  const { confirm, confirmDialog } = useConfirm();
  // The app's only way to tell the user something went wrong. Messages that used
  // to go to console.warn were invisible, which made failed validation look like
  // a dead button.
  const { showToast } = useToast();

  /**
   * Page currently open in a lettering editor, or null.
   *
   * AI lettering is unreliable on this project — pages have returned with no
   * dialogue, and an emblem once rendered as the word "SOLARI". Correcting a
   * page by hand is cheaper and far more predictable than rerolling it.
   */
  const [letteringTarget, setLetteringTarget] = useState<{ faceId: string; tool: 'bubbles' | 'sfx' } | null>(null);
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  /**
   * Pages already rendered in a just-restored draft. Drives the "open the comic"
   * affordance on the setup screen; zero means there is nothing to resume.
   */
  const [resumablePageCount, setResumablePageCount] = useState(0);
  /**
   * Page-generation progress, reported by the reader.
   *
   * Rendered by the shell rather than inside the book: the book is centred and
   * transformed, so an indicator positioned relative to it slid underneath the
   * top navigation on ordinary viewports and became invisible.
   */
  const [readerProgress, setReaderProgress] = useState<{ isGenerating: boolean; done: number; total: number } | null>(null);
  /** Spread/single page toggle, surfaced by the reader. */
  const [viewToggle, setViewToggle] = useState<{ canToggle: boolean; mode: 'spread' | 'single'; toggle: () => void } | null>(null);
  /** Casting-step props, shared by the setup screen and the profiles dialog. */
  const modelSheetProps = {
      characters: [getHero(), getFriend(), ...getAdditionalChars()].filter(Boolean) as Persona[],
      artStyle: storyContext.artStyle,
      states: modelSheetStates,
      onGenerate: handleGenerateModelSheet,
      onClear: handleClearModelSheet,
      onGenerateAll: handleGenerateAllModelSheets,
      onUpload: handleUploadModelSheet,
      onConfirm: confirm,
  };

  // --- Sync comicFaces to Zustand store ---
  useEffect(() => {
    useComicStore.getState().setComicFaces(comicFaces);
  }, [comicFaces]);

  // --- Auto-save generated images to Global Gallery ---
  const savedGalleryIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    comicFaces.forEach(face => {
      if (!face.imageUrl || !face.id || savedGalleryIdsRef.current.has(face.id)) return;
      if (face.isLoading) return;
      savedGalleryIdsRef.current.add(face.id);
      const mode = generateFromOutlineRef.current ? 'outline' : 'novel';
      saveToGlobalGallery(face.imageUrl, face.type as GalleryImage['type'], storyContext.title || 'Untitled', mode, face.narrative?.scene);
    });
  }, [comicFaces]);

  /**
   * Debounce handle for snapshot writes.
   *
   * The metadata effect fires on every comicFaces change, and a snapshot runs to
   * tens of megabytes, so writing one per change would thrash IndexedDB during
   * generation.
   */
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Auto-save session metadata when comic generation progresses ---
  useEffect(() => {
    if (!isStarted || comicFaces.length === 0) return;
    const readyFaces = comicFaces.filter(f => f.imageUrl && !f.isLoading);
    if (readyFaces.length === 0) return;
    const thumbnail = readyFaces[0]?.imageUrl;
    const mode = generateFromOutlineRef.current ? 'outline' : 'novel';
    upsertSession({
      id: sessionIdRef.current,
      title: storyContext.title || 'Untitled',
      mode,
      genre: selectedGenre !== 'Custom' ? selectedGenre : undefined,
      artStyle: storyContext.artStyle,
      pageCount: readyFaces.length,
      thumbnail: thumbnail ? thumbnail.slice(0, 200) + '...' : undefined, // tiny ref, not full data
      createdAt: parseInt(sessionIdRef.current, 36),
      updatedAt: Date.now()
    });

    // Metadata alone cannot be restored from, so persist the full state too.
    // Debounced, and deliberately fire-and-forget: a failed snapshot must never
    // interrupt generation.
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    const sessionId = sessionIdRef.current;
    snapshotTimerRef.current = setTimeout(() => {
      saveSnapshot(sessionId, buildDraftSnapshot('comic'))
        .then(r => {
          if (!r.success) {
            console.warn('[session] snapshot failed:', r.error);
            return;
          }
          console.log(`[session] snapshot saved (${Math.round((r.data?.size ?? 0) / 1024)}KB)`);
          // Keep only the most recent snapshots so storage stays bounded.
          const recent = useSessionHistoryStore.getState().sessions
            .slice(0, MAX_SESSION_SNAPSHOTS)
            .map(x => x.id);
          return pruneSnapshots(recent).then(p => {
            if (p.success && p.data) console.log(`[session] pruned ${p.data} old snapshot(s)`);
          });
        })
        .catch(e => console.warn('[session] snapshot threw:', e));
    }, 3000);

    return () => {
      if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    };
  }, [comicFaces, isStarted]);

  // --- Drop snapshots whose session row no longer exists ---
  useEffect(() => {
    const ids = useSessionHistoryStore.getState().sessions
      .slice(0, MAX_SESSION_SNAPSHOTS)
      .map(x => x.id);
    pruneSnapshots(ids)
      .then(r => { if (r.success && r.data) console.log(`[session] pruned ${r.data} orphaned snapshot(s)`); })
      .catch(() => { /* pruning is housekeeping; failure is not user-facing */ });
    // Runs once on mount: sessions can be deleted while the tab is closed.
  }, []);

  // --- Sync currentSheetIndex to Zustand store ---
  useEffect(() => {
    // Convert sheet index to page index (sheet 0 = cover, sheet 1 = pages 1-2, etc.)
    const pageIndex = currentSheetIndex === 0 ? 0 : (currentSheetIndex - 1) * 2 + 1;
    useComicStore.getState().setCurrentPageIndex(pageIndex);
  }, [currentSheetIndex]);

  // --- Transition States ---
  const [showSetup, setShowSetup] = useState(true);
  const [showModeSelection, setShowModeSelection] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isGeneratingProfiles, setIsGeneratingProfiles] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [showOutlineDialog, setShowOutlineDialog] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showFullTutorial, setShowFullTutorial] = useState(false);
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('is_admin') === 'true');
  const [userApiKey, setUserApiKey] = useState(localStorage.getItem('user_api_key') || '');
  const [userAnthropicKey, setUserAnthropicKey] = useState(localStorage.getItem('user_anthropic_api_key') || '');
  const [dismissedKeyAlert, setDismissedKeyAlert] = useState(false);
  const [storageWarning, setStorageWarning] = useState<StorageUsageInfo | null>(null);
  const [dismissedStorageWarning, setDismissedStorageWarning] = useState(false);
  const [showProfilesStep, setShowProfilesStep] = useState(false);
  const [tempProfiles, setTempProfiles] = useState<CharacterProfile[]>([]);
  const [skipProfileAnalysis, setSkipProfileAnalysis] = useState(false);
  const [useSavedProfiles, setUseSavedProfiles] = useState(true); // Use saved profiles if available
  const [hasStaleSavedProfiles, setHasStaleSavedProfiles] = useState(false); // True if any saved profile is >24h old
  const [extraPages, setExtraPages] = useState(0);

  // Novel Mode page-by-page interactive state
  const [novelModeState, setNovelModeState] = useState<NovelModeState>({
    isWrappingUp: false,
    originalTargetPages: 6, // Will be set on story start
    hasExceededTarget: false,
    customActionHistory: [],
    outlineDriftDetected: false
  });
  const cachedChoicesRef = useRef<Map<number, string[]>>(new Map());

  // Cover variant generation state
  const [coverVariants, setCoverVariants] = useState<{ imageUrl: string; prompt: string }[]>([]);
  const [showCoverSelector, setShowCoverSelector] = useState(false);
  const [isGeneratingVariants, setIsGeneratingVariants] = useState(false);
  const [selectedCoverIndex, setSelectedCoverIndex] = useState<number | null>(null);

  const [showGlobalReroll, setShowGlobalReroll] = useState(false);
  const [globalRerollPageInput, setGlobalRerollPageInput] = useState<string>('1');
  const [showPageNav, setShowPageNav] = useState(true);
  const [pageNavInput, setPageNavInput] = useState<string>('Cover');

  // --- Feature C: Global Gallery ---
  const [showGlobalGallery, setShowGlobalGallery] = useState(false);

  // --- Feature D: Single Image Mode ---
  const [showSingleImageMode, setShowSingleImageMode] = useState(false);

  // --- Feature A: AI Surprise Me ---
  const [isSurprisingMe, setIsSurprisingMe] = useState(false);

  // --- Feature E: Session tracking ---
  const sessionIdRef = useRef<string>(Date.now().toString(36));
  const upsertSession = useSessionHistoryStore(s => s.upsert);

  useEffect(() => {
     if (currentSheetIndex === 0) {
         setPageNavInput('Cover');
     } else {
         setPageNavInput(`${currentSheetIndex * 2 - 1}-${currentSheetIndex * 2}`);
     }
  }, [currentSheetIndex]);

  const generatingPages = useRef(new Set<number>());
  const historyRef = useRef<ComicFace[]>([]);
  const isStoppedRef = useRef(false);
  // Mirrors generateFromOutline so async closures always read the current value.
  // React batches state updates — closures capture stale values without this ref.
  const generateFromOutlineRef = useRef(false);

  const [zoom, setZoom] = useState(1);
  const zoomIn = () => setZoom(z => Math.min(z + 0.5, 3));
  const zoomOut = () => setZoom(z => Math.max(z - 0.5, 0.5));
  const resetZoom = () => setZoom(1);

  const [rerollTarget, setRerollTarget] = useState<number | null>(null);
  // Persisted profile selection for RerollModal (so it doesn't reset when modal closes)
  const [rerollProfileSelection, setRerollProfileSelection] = useState<string[]>([]);

  // --- AI Helpers ---
  // Key priority: admin (server key) → user key (localStorage) → env fallback
  const getActiveApiKey = (): string => {
    if (isAdmin && process.env.API_KEY) return process.env.API_KEY;
    if (userApiKey) return userApiKey;
    return process.env.API_KEY || '';
  };

  const getAI = () => {
    const key = getActiveApiKey();
    if (!key) {
      setShowSettings(true);
      throw new Error('No API key configured. Please add one in Settings.');
    }
    return new GoogleGenAI({ apiKey: key });
  };

  // --- Claude/Anthropic API Helpers ---
  const getAnthropicApiKey = (): string => {
    if (isAdmin && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (userAnthropicKey) return userAnthropicKey;
    return process.env.ANTHROPIC_API_KEY || '';
  };

  const getClaude = (): Anthropic | null => {
    const key = getAnthropicApiKey();
    if (!key) return null; // Claude not available, will fallback to Gemini
    return new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true // Required for browser usage
    });
  };

  const hasClaudeAccess = (): boolean => !!getAnthropicApiKey();

  /**
   * AI Text Improvement Function
   * Uses Claude if available, otherwise falls back to Gemini
   * @param text - The original text to improve
   * @param context - Optional character descriptions or context to use
   * @param purpose - What the text is for (e.g., 'story description', 'regeneration instruction')
   */
  const improveTextWithAI = async (
    text: string,
    context?: string,
    purpose: 'story_description' | 'regeneration_instruction' | 'backstory' = 'story_description'
  ): Promise<string> => {
    const claude = getClaude();

    const purposeInstructions = {
      story_description: `You are a creative writing assistant helping craft compelling comic book story descriptions.
        Enhance this story premise/description to be more engaging, dramatic, and visually interesting while maintaining the original intent.
        Make it suitable for AI image generation - include vivid visual details, action beats, and dramatic moments.
        Keep it concise but impactful (2-4 paragraphs max).`,
      regeneration_instruction: `You are helping improve a regeneration instruction for an AI comic panel generator.
        Make this instruction clearer, more specific, and more effective for guiding image generation.
        Include visual details, composition suggestions, and emotional tone.
        Keep it focused and actionable (1-2 paragraphs max).`,
      backstory: `You are helping enhance a character backstory for a comic book.
        Make it more compelling and interesting while keeping the core character traits.
        Add depth, motivations, and visual details that will help AI image generation.
        Keep it concise but rich (2-3 paragraphs max).`
    };

    const systemPrompt = purposeInstructions[purpose];
    const contextSection = context ? `\n\nRELEVANT CHARACTER/STORY CONTEXT:\n${context}` : '';
    const userPrompt = `${contextSection}\n\nORIGINAL TEXT TO IMPROVE:\n${text}\n\nPlease provide an improved version. Return ONLY the improved text, no explanations or markdown.`;

    try {
      if (claude) {
        try {
          // Use Claude
          const response = await claude.messages.create({
            model: MODEL_TEXT_NAME_CLAUDE,
            max_tokens: 1024,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
          });
          return getTextFromClaudeResponse(response.content).trim();
        } catch (claudeError) {
          console.warn('Claude text improvement failed, falling back to Gemini:', claudeError);
          handleAnthropicError(claudeError);
          // Fall through to Gemini fallback below
        }
      }

      // Fallback to Gemini
      const ai = getAI();
      const model = ai.models.generateContent({
        model: MODEL_TEXT_NAME,
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
      });
      const result = await model;
      return result.text?.trim() || text;
    } catch (e) {
      console.error('AI text improvement failed (Gemini fallback also failed):', e);
      handleAPIError(e);
      throw new Error('Failed to improve text with AI. Please try again.');
    }
  };

  const handleSettingsKeyChange = (geminiKey: string | null, anthropicKey: string | null, admin: boolean) => {
    setIsAdmin(admin);
    setUserApiKey(geminiKey || '');
    setUserAnthropicKey(anthropicKey || '');
    // Reset alert dismissal when admin logs in (they now have server keys)
    if (admin) setDismissedKeyAlert(false);
  };

  const handleAPIError = (e: any) => {
    const msg = String(e);
    console.error("API Error:", msg);
    if (
      msg.includes('Requested entity was not found') ||
      msg.includes('API_KEY_INVALID') ||
      msg.toLowerCase().includes('permission denied')
    ) {
      setShowSettings(true);
    }
  };

  const handleAnthropicError = (e: any) => {
    const msg = String(e);
    console.error("Anthropic API Error:", msg);
    if (
      msg.includes('invalid_api_key') ||
      msg.includes('authentication_error') ||
      msg.toLowerCase().includes('permission_denied')
    ) {
      setShowSettings(true);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // =========================================================================
  // GENERATION HOOKS (replace inline implementations)
  // =========================================================================

  const hookConfig = {
    getAI,
    getClaude,
    onAPIError: handleAPIError,
    onAnthropicError: handleAnthropicError,
  };

  const { generateBeat: hookGenerateBeat } = useGenerateBeat(hookConfig);
  const { generateImage: hookGenerateImage } = useGenerateImage(hookConfig);
  const { generateCharacterProfile: hookGenerateProfile } = useGenerateProfile(hookConfig);
  const { generateOutline: hookGenerateOutline } = useGenerateOutline(hookConfig);
  const { generateModelSheet } = useGenerateModelSheet(hookConfig);
  const { scorePanel } = useVisualQA(hookConfig);

  /**
   * Shared queue for page generation.
   *
   * Page generation previously ran as a bare sequential `for...await` loop with
   * no retry and no rate limiting, while a fully-built queue and backoff helper
   * sat unimported in utils/. This wires them up: concurrency comes from
   * settings, and the queue's per-minute cap keeps bursts from tripping 429s.
   */
  const pageQueueRef = useRef(createImageQueue());

  // =========================================================================
  // ADAPTER FUNCTIONS (maintain existing call signatures)
  // =========================================================================

  const generateBeat = async (
    history: ComicFace[],
    isRightPage: boolean,
    pageNum: number,
    isDecisionPage: boolean,
    instruction?: string,
    previousChoices?: string[]
  ): Promise<Beat> => {
    return hookGenerateBeat({
      history,
      isRightPage,
      pageNum,
      isDecisionPage,
      instruction,
      previousChoices,
      storyContext,
      storyOutline,
      storyTone,
      richMode,
      extraPages,
    });
  };

  const generateImage = async (
    beat: Beat,
    type: ComicFace['type'],
    instruction?: string,
    extraRefImages?: string[],
    prevImage?: string,
    prevBeat?: Beat,
    pageIndex?: number,
    comicOverrides?: { shotTypeOverride?: ShotType; balloonShapeOverride?: BalloonShape; applyFlashbackStyle?: boolean },
    useOnlySelectedRefs?: boolean,
    currentImageToPreserve?: string,
    adjacentPageImages?: Array<{ base64: string; label: string }>,
    consistencyMode?: boolean,
    profileOverrides?: CharacterProfile[],
    preserveCharacterIds?: string[]
  ): Promise<{ imageUrl: string; originalPrompt: string; failureReason?: string }> => {
    return hookGenerateImage({
      beat,
      type,
      instruction,
      extraRefImages,
      prevImage,
      prevBeat,
      pageIndex,
      comicOverrides,
      useOnlySelectedRefs,
      currentImageToPreserve,
      adjacentPageImages,
      consistencyMode,
      profileOverrides,
      preserveCharacterIds,
      // The cover doubles as a style anchor when useCoverAsStyleReference is on.
      coverImage: comicFaces.find(cf => cf.type === 'cover')?.imageUrl,
      storyContext,
      storyOutline,
    });
  };

  const generateCharacterProfile = async (persona: Persona, forceAnalysis = false): Promise<CharacterProfile> => {
    return hookGenerateProfile(persona, forceAnalysis);
  };

  const generateOutline = async (userNotes?: string) => {
    setStoryOutline(prev => ({ ...prev, isGenerating: true }));
    const result = await hookGenerateOutline({
      userNotes,
      storyContext,
      extraPages,
    });
    setStoryOutline({
      content: result.content,
      isReady: true,
      isGenerating: false,
      pageBreakdown: result.pageBreakdown,
      isEnhanced: result.isEnhanced,
      lastEditedAt: Date.now(),
      version: 1,
    });
  };

  // =========================================================================
  // REMOVED: Old inline implementations (now in hooks/)
  // - generateBeat: hooks/useGenerateBeat.ts
  // - generateImage: hooks/useGenerateImage.ts
  // - generateCharacterProfile: hooks/useGenerateProfile.ts
  // - generateOutline: hooks/useGenerateOutline.ts
  // =========================================================================


  const generatePersona = async (desc: string): Promise<Persona> => {
      const style = selectedGenre === 'Custom' ? "Modern American comic book art" : `${selectedGenre} comic`;
      try {
          const ai = getAI();
          const res = await ai.models.generateContent({
              model: MODEL_IMAGE_GEN_NAME,
              contents: { text: `STYLE: Masterpiece ${style} character sheet, detailed ink, neutral background. FULL BODY. Character: ${desc}` },
              config: { imageConfig: { aspectRatio: '1:1' } }
          });
          const part = res.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
          if (part?.inlineData?.data) return { id: crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 11), name: desc, base64: part.inlineData.data, desc, backstoryText: '', backstoryFiles: [] };
          throw new Error("Failed");
      } catch (e) { 
        handleAPIError(e);
        throw e; 
      }
  };



  const generateAllProfiles = async () => {
      const personas: Persona[] = [];
      if (getHero()) personas.push(getHero());
      if (getFriend()) personas.push(getFriend());
      personas.push(...getAdditionalChars()); // already limited to real cast members
      
      const profiles: CharacterProfile[] = [];
      for (const p of personas) {
          profiles.push(await generateCharacterProfile(p));
      }
      
      // Sync all profiles to Zustand store
      useCharacterStore.getState().setAllProfiles(profiles);
      console.log('[Character Profiles Generated]', profiles);
      return profiles;
  };

  // Generate blank profiles for manual entry (when skipProfileAnalysis is enabled)
  const generateBlankProfiles = (): CharacterProfile[] => {
      const personas: Persona[] = [];
      if (getHero()) personas.push(getHero());
      if (getFriend()) personas.push(getFriend());
      personas.push(...getAdditionalChars().filter(c => c.base64 || c.backstoryText));

      return personas.map(p => ({
          id: p.id,
          name: p.name || 'Unknown Character',
          faceDescription: '',
          bodyType: '',
          clothing: '',
          colorPalette: '',
          distinguishingFeatures: '',
          emblemDescription: '',
          emblemPlacement: p.emblemPlacement === 'other'
              ? p.emblemPlacementCustom || ''
              : p.emblemPlacement?.replace(/-/g, ' ') || '',
          maskDescription: '',
          weaponDescription: '',
      }));
  };

  const handleAnalyzeProfile = async (index: number) => {
      const personas: Persona[] = [];
      if (getHero()) personas.push(getHero());
      if (getFriend()) personas.push(getFriend());
      personas.push(...getAdditionalChars()); // already limited to real cast members

      const persona = personas[index];
      if (!persona) return;

      try {
          const newProfile = await generateCharacterProfile(persona, true); // force analysis on manual click
          setTempProfiles(prev => {
              const arr = [...prev];
              arr[index] = newProfile;
              return arr;
          });
      } catch (e) {
          console.error("Manual reanalyze failed:", e);
      }
  };

  const updateFaceState = (id: string, updates: Partial<ComicFace>) => {
      setComicFaces(prev => prev.map(f => f.id === id ? { ...f, ...updates } : f));
      const idx = historyRef.current.findIndex(f => f.id === id);
      if (idx !== -1) historyRef.current[idx] = { ...historyRef.current[idx], ...updates };
  };

  /**
   * Open a lettering editor, starting on the page currently being viewed.
   *
   * The editor itself carries a page picker, so the reader's position is only a
   * starting point — you can letter any rendered page without closing and
   * re-opening on a different spread.
   */
  const openLetteringEditor = (tool: 'bubbles' | 'sfx') => {
      const pageIndex = currentSheetIndex === 0 ? 0 : (currentSheetIndex - 1) * 2 + 1;
      const face = comicFaces.find(fc => fc.pageIndex === pageIndex && fc.imageUrl)
          ?? comicFaces.find(fc => fc.imageUrl);
      if (!face) {
          showToast({ type: 'warning', message: 'Generate a page before adding lettering to it.' });
          return;
      }
      setLetteringTarget({ faceId: face.id, tool });
  };

  /** Pages that have art, for the editors' page picker. */
  const letterablePages = comicFaces
      .filter(fc => fc.imageUrl)
      .sort((a, b) => (a.pageIndex ?? 0) - (b.pageIndex ?? 0))
      .map(fc => ({
          id: fc.id,
          label: fc.type === 'cover' ? 'Cover'
              : fc.type === 'back_cover' ? 'Back Cover'
              : `Page ${fc.pageIndex}`,
          hasLettering: Boolean(fc.bubbles?.length || fc.sfx?.length),
      }));

  const handleBubblesChange = (faceId: string, bubbles: SpeechBubble[]) => {
      updateFaceState(faceId, { bubbles });
  };

  const handleSFXChange = (faceId: string, sfx: PlacedSFX[]) => {
      updateFaceState(faceId, { sfx });
  };

  /** Add a saved character from the library to the current cast. */
  const handleLibrarySelect = (persona: Persona, profile?: CharacterProfile) => {
      const store = useCharacterStore.getState();
      if (!store.hero) store.setHero(persona);
      else if (!store.friend) store.setFriend(persona);
      else store.addCharacter(persona);
      if (profile) store.setCharacterProfile(persona.id, profile);
      setShowCharacterLibrary(false);
      showToast({ type: 'success', message: `${persona.name || 'Character'} added to your cast.` });
  };


  /**
   * Score a rendered panel against its cast's canonical references.
   * Returns null when QA cannot run (no cast, no references) — never throws,
   * because a QA failure must not take down page generation.
   */
  const runPanelQA = async (imageUrl: string, pageNum: number) => {
      try {
          const artStyle = storyContext.artStyle;
          const profiles = useCharacterStore.getState().getProfilesArray();
          const roster = [getHero(), getFriend(), ...getAdditionalChars()].filter(Boolean) as Persona[];

          const qaChars: QACharacterInput[] = roster.flatMap(p => {
              // Judge against the same reference the artist was given.
              const reference = hasValidModelSheet(p, artStyle) ? p.modelSheet! : p.base64;
              if (!reference) return [];
              const profile = profiles.find(pr => pr.id === p.id || pr.name === p.name);
              return [{
                  name: p.name || 'Character',
                  referenceImage: reference,
                  hardNegatives: profile?.hardNegatives,
                  emblem: profile?.emblemDescription,
              }];
          });

          if (qaChars.length === 0) return null;
          const verdict = await scorePanel({ panelImage: imageUrl, characters: qaChars });
          useComicStore.getState().setPageQA(pageNum, verdict);
          return verdict;
      } catch (e) {
          console.warn('[QA] scoring failed; treating page as passing', e);
          return null;
      }
  };

  /** Everything one page render needs. */
  interface GeneratePageOptions {
      faceId: string;
      pageNum: number;
      type: ComicFace['type'];
      instruction?: string;
      extraRefImages?: string[];
      previousChoices?: string[];
      comicOverrides?: ComicOverrides;
      /** Suppress the cast's own images in favour of `extraRefImages`. */
      useOnlySelectedRefs?: boolean;
      currentImageToPreserve?: string;
      adjacentPageImages?: Array<{ base64: string; label: string }>;
      consistencyMode?: boolean;
      profileOverrides?: CharacterProfile[];
      preserveCharacterIds?: string[];
      /**
       * Who the instruction is for. 'both' (default) sends it to the writer and
       * the artist, which is right for reroll directions like "make it rain
       * harder". 'writer' keeps it out of the image prompt — narrative guidance
       * such as "bring the thread to a satisfying conclusion" is not something an
       * image model can act on, and it gets rendered as literal text on the page.
       */
      instructionScope?: 'both' | 'writer';
      /**
       * Reuse this beat instead of writing a new one. Supplied by rerolls so
       * redrawing a page does not rewrite its dialogue.
       */
      existingBeat?: Beat;
  }

  /**
   * Render one page.
   *
   * Takes an options object rather than positional arguments: this had grown to
   * fifteen parameters across ten call sites, most of them `undefined`
   * placeholders, which made every call unreadable and the next addition a
   * likely source of silent mis-ordering.
   */
  const generateSinglePage = async (opts: GeneratePageOptions) => {
      const {
          faceId, pageNum, type, instruction, extraRefImages, previousChoices,
          comicOverrides, useOnlySelectedRefs, currentImageToPreserve,
          adjacentPageImages, consistencyMode, profileOverrides,
          preserveCharacterIds, instructionScope = 'both', existingBeat,
      } = opts;
      // Use ref (not state) — this async function can be called from generateBatch or handleChoice
      // where the React state closure may be stale from the render that created the caller.
      const isNovelMode = !generateFromOutlineRef.current;
      const config = getComicConfig(storyContext.pageLength, extraPages, isNovelMode);
      const isDecision = config.DECISION_PAGES.includes(pageNum);
      let beat: Beat = { scene: "", choices: [], focus_char: 'other' };

      if (type === 'cover') {
           // GAP-14 + Phase 3.1: Build a character-anchored scene description for the cover.
           // Inject visual profile context (hair, outfit) when available so the image generator
           // has concrete visual anchors even in the beat text.
           const coverHero = getHero();
           const heroName = coverHero?.name || 'the hero';
           const heroProfile = coverHero ? useCharacterStore.getState().characterProfiles.get(coverHero.id) : undefined;
           const heroVisual = heroProfile?.identityHeader
             ? ` (${heroProfile.identityHeader.hair}${heroProfile.clothing ? `, ${heroProfile.clothing.slice(0, 60)}` : ''})`
             : '';
           const friendName = getFriend()?.name;
           const coverScene = `Comic book cover for "${storyContext.title || 'Untitled'}" featuring ${heroName}${heroVisual}${friendName ? ` and ${friendName}` : ''}.${storyContext.descriptionText ? ` ${storyContext.descriptionText.slice(0, 120)}` : ''}`;
           beat = { scene: coverScene, choices: [], focus_char: 'hero' };
      } else if (type === 'back_cover') {
           const backCoverHeroName = getHero()?.name || 'the hero';
           beat = { scene: `Teaser panel: ${backCoverHeroName} faces what comes next. End of issue. Dramatic closing image.`, choices: [], focus_char: 'hero' };
      } else {
           // Reuse the page's existing words when the caller supplied them. A
           // reroll of the artwork should not rewrite the story, and a beat
           // regenerated for a redraw sometimes came back with no dialogue,
           // leaving the page with no speech bubbles.
           beat = existingBeat
             ? existingBeat
             : await generateBeat(historyRef.current, pageNum % 2 === 0, pageNum, isDecision, instruction, previousChoices);
      }

      // Ensure decision pages always have choices — AI occasionally returns an empty array
      if (isDecision && type === 'story' && (!beat.choices || beat.choices.length < 2)) {
          beat = {
              ...beat,
              choices: [
                  'Press forward — the mission cannot wait',
                  'Take a different approach — adapt to the situation'
              ]
          };
      }

      if (beat.focus_char === 'friend' && !getFriend() && type === 'story') {
          try {
              const newSidekick = await generatePersona(selectedGenre === 'Custom' ? "A fitting sidekick for this story" : `Sidekick for ${selectedGenre} story.`);
              setFriend(newSidekick);
          } catch (e) { beat.focus_char = 'other'; }
      }

      updateFaceState(faceId, { narrative: beat, choices: beat.choices, isDecisionPage: isDecision });

      // Retrieve previous context - use historyRef for synchronous access (important for Novel Mode page-by-page flow)
      let prevImage: string | undefined;
      let prevBeat: Beat | undefined;
      if (pageNum > 0) {
          // Use historyRef.current instead of comicFaces (React state) to avoid stale closure data
          const prevFace = historyRef.current.find(f => f.pageIndex === pageNum - 1);
          if (prevFace?.imageUrl) {
              prevImage = prevFace.imageUrl;
              prevBeat = prevFace.narrative;
          }
      }

      const artInstruction = instructionScope === 'writer' ? undefined : instruction;
      let result = await generateImage(beat, type, artInstruction, extraRefImages, prevImage, prevBeat, pageNum, comicOverrides, useOnlySelectedRefs, currentImageToPreserve, adjacentPageImages, consistencyMode, profileOverrides, preserveCharacterIds);
      if (isStoppedRef.current) return;

      /*
       * Automatic recovery from a safety block.
       *
       * The writer and the artist are different models with different policies,
       * and the artist's is stricter — so a page fails for a story the user's own
       * AI wrote. Retrying the identical prompt fails identically, which is why
       * Quick Retry so often did nothing.
       *
       * The beat is preserved, so the page keeps its caption and dialogue; only
       * the scene wording is softened, and the direction added tells the model
       * what to draw instead rather than only what to avoid. One retry: if a
       * softened scene is still refused, the user should see it and decide.
       */
      if (!result.imageUrl
          && (result.failureReason === 'safety' || result.failureReason === 'content_policy')
          && !isStoppedRef.current) {
          const softenedScene = softenScene(beat.scene);
          const softenedAction = beat.art ? softenScene(beat.art.action) : null;
          const softenedEnv = beat.art ? softenScene(beat.art.environment) : null;

          if (softenedScene.changed || softenedAction?.changed || softenedEnv?.changed) {
              console.warn(
                  `[safety] Page ${pageNum} blocked (${result.failureReason}); retrying with softened wording.`,
                  softenedScene.matched,
              );
              const safeBeat: Beat = {
                  ...beat,
                  scene: softenedScene.text,
                  art: beat.art ? {
                      ...beat.art,
                      action: softenedAction!.text,
                      environment: softenedEnv!.text,
                  } : undefined,
              };
              const retryInstruction = [artInstruction, SAFE_RETRY_DIRECTION].filter(Boolean).join(' ');
              result = await generateImage(safeBeat, type, retryInstruction, extraRefImages, prevImage, prevBeat, pageNum, comicOverrides, useOnlySelectedRefs, currentImageToPreserve, adjacentPageImages, consistencyMode, profileOverrides, preserveCharacterIds);
              if (result.imageUrl) {
                  // Keep the page's words, but store what was actually drawn.
                  updateFaceState(faceId, { narrative: safeBeat });
              }
          }
      }
      if (isStoppedRef.current) return;
      if (!result.imageUrl) {
          updateFaceState(faceId, { isLoading: false, hasFailed: true, originalPrompt: result.originalPrompt, failureReason: result.failureReason });
      } else {
          updateFaceState(faceId, { imageUrl: result.imageUrl, isLoading: false, hasFailed: false, originalPrompt: result.originalPrompt, failureReason: undefined });

          // Visual QA: score the render against the character references and reroll
          // once with a targeted correction if it drifted. Opt-in — costs one extra
          // vision call per page — and deliberately capped at a single retry so a
          // persistently-failing page cannot spend the user's quota in a loop.
          const { qaAutoReroll, qaThreshold } = useSettingsStore.getState();
          if (qaAutoReroll && type !== 'back_cover' && result.imageUrl && !isStoppedRef.current) {
              const verdict = await runPanelQA(result.imageUrl, pageNum);
              if (verdict && verdict.overall < qaThreshold && verdict.correction) {
                  console.warn(`[QA] Page ${pageNum} scored ${verdict.overall}/10 — rerolling. ${verdict.summary}`);
                  updateFaceState(faceId, { isLoading: true });
                  const retry = await generateImage(
                      beat, type, verdict.correction, extraRefImages, prevImage, prevBeat, pageNum,
                      comicOverrides, useOnlySelectedRefs, currentImageToPreserve, adjacentPageImages,
                      true, profileOverrides, preserveCharacterIds,
                  );
                  if (retry.imageUrl && !isStoppedRef.current) {
                      updateFaceState(faceId, {
                          imageUrl: retry.imageUrl, isLoading: false, hasFailed: false,
                          originalPrompt: retry.originalPrompt, failureReason: undefined,
                      });
                  } else {
                      updateFaceState(faceId, { isLoading: false });
                  }
              }
          }

          // Feature G: Fire-and-forget visual drift check for story pages (not cover/back_cover).
          // Uses canvas pixel sampling — no AI call, non-blocking.
          if (type === 'story' && prevImage && pageNum !== undefined && pageNum >= 2) {
              const profiles = useCharacterStore.getState().getProfilesArray();
              checkVisualDrift(result.imageUrl, prevImage, pageNum, profiles).then(warnings => {
                  if (warnings.length > 0) {
                      warnings.forEach(w => useComicStore.getState().addDriftWarning(w));
                  }
              });
          }
      }
  };

  /**
   * Generate multiple cover variants for user selection
   * @param variantCount Number of variants to generate (default 3)
   */
  const generateCoverVariants = async (variantCount: number = 3): Promise<void> => {
    setIsGeneratingVariants(true);
    setCoverVariants([]);
    setSelectedCoverIndex(null);

    const variants: { imageUrl: string; prompt: string }[] = [];
    // GAP-14: Anchor cover with character names and story description for better composition.
    const heroName = getHero()?.name || 'the hero';
    const friendName = getFriend()?.name;
    const coverScene = `Comic book cover for "${storyContext.title || 'Untitled'}" featuring ${heroName}${friendName ? ` and ${friendName}` : ''}.${storyContext.descriptionText ? ` ${storyContext.descriptionText.slice(0, 120)}` : ''}`;
    const coverBeat: Beat = { scene: coverScene, choices: [], focus_char: 'hero' };

    // Different cover style variations
    const styleVariations = [
      '', // Default style
      'dramatic lighting with bold shadows',
      'dynamic action pose composition',
      'heroic portrait style with logo treatment',
      'cinematic widescreen composition'
    ];

    try {
      // Generate variants in parallel (max 3 concurrent)
      const variantPromises = [];
      for (let i = 0; i < variantCount; i++) {
        const styleHint = styleVariations[i % styleVariations.length];
        const instruction = styleHint ? `Cover style: ${styleHint}` : undefined;

        variantPromises.push(
          generateImage(coverBeat, 'cover', instruction, undefined, undefined, undefined, 0)
            .then(result => {
              if (result.imageUrl) {
                variants.push({ imageUrl: result.imageUrl, prompt: result.originalPrompt });
                // Update variants progressively
                setCoverVariants([...variants]);
              }
              return result;
            })
            .catch(e => {
              console.error(`Cover variant ${i + 1} failed:`, e);
              return null;
            })
        );
      }

      const results = await Promise.all(variantPromises);

      // Track failure count for logging
      const failedCount = results.filter(r => r === null || !r?.imageUrl).length;

      if (failedCount === variantCount) {
        console.error(`All ${variantCount} cover variants failed to generate`);
        // Could show user notification here in future
      } else if (failedCount > 0) {
        console.warn(`${failedCount}/${variantCount} cover variants failed to generate`);
      }

      if (variants.length > 0) {
        setCoverVariants(variants);
        setShowCoverSelector(true);
      }
    } catch (e) {
      console.error('Cover variant generation failed:', e);
    } finally {
      setIsGeneratingVariants(false);
    }
  };

  /**
   * Apply selected cover variant to the comic
   */
  const selectCoverVariant = (index: number) => {
    if (index >= 0 && index < coverVariants.length) {
      const selected = coverVariants[index];
      setSelectedCoverIndex(index);

      // Update the cover face with selected variant
      updateFaceState('cover', {
        imageUrl: selected.imageUrl,
        originalPrompt: selected.prompt,
        isLoading: false,
        hasFailed: false
      });

      setShowCoverSelector(false);
    }
  };

  const generateBatch = async (startPage: number, count: number) => {
      // Use ref (not state) — this function is called from async/closure contexts where
      // the state variable may be stale from the render that created the closure.
      const isNovelMode = !generateFromOutlineRef.current;
      const config = getComicConfig(storyContext.pageLength, extraPages, isNovelMode);
      const pagesToGen: number[] = [];
      for (let i = 0; i < count; i++) {
          const p = startPage + i;
          if (p <= config.TOTAL_PAGES && !generatingPages.current.has(p)) {
              pagesToGen.push(p);
          }
      }
      
      if (pagesToGen.length === 0) return;
      pagesToGen.forEach(p => generatingPages.current.add(p));

      const newFaces: ComicFace[] = [];
      pagesToGen.forEach(pageNum => {
          const type = pageNum === config.BACK_COVER_PAGE ? 'back_cover' : 'story';
          newFaces.push({ id: `page-${pageNum}`, type, choices: [], isLoading: true, pageIndex: pageNum });
      });

      setComicFaces(prev => {
          const existing = new Set(prev.map(f => f.id));
          return [...prev, ...newFaces.filter(f => !existing.has(f.id))];
      });
      newFaces.forEach(f => { if (!historyRef.current.find(h => h.id === f.id)) historyRef.current.push(f); });

      // Phase 4.2 — Show progress bar in Outline Mode
      if (generateFromOutlineRef.current && !isNovelMode) {
          setGenerationProgress({ current: 0, total: config.TOTAL_PAGES });
      }

      try {
          const { maxConcurrentPages = 1 } = useSettingsStore.getState();
          const queue = pageQueueRef.current;
          queue.updateOptions({ maxConcurrent: maxConcurrentPages });

          const runPage = async (pageNum: number) => {
              if (isStoppedRef.current) return;
              try {
                  // Transient 429s and 5xxs previously killed a page outright; the
                  // backoff helper existed in utils/ but was never imported.
                  await retryWithBackoff(
                      () => generateSinglePage({ faceId: `page-${pageNum}`, pageNum, type: pageNum === config.BACK_COVER_PAGE ? 'back_cover' : 'story' }),
                      {
                          maxAttempts: 3,
                          onRetry: (attempt, _err, delayMs) =>
                              console.warn(`[batch] Page ${pageNum} attempt ${attempt} failed, retrying in ${delayMs}ms`),
                      },
                  );
              } finally {
                  generatingPages.current.delete(pageNum);
              }
              if (generateFromOutlineRef.current && !isNovelMode) {
                  const completedSoFar = historyRef.current.filter(f => f.imageUrl && !f.isLoading).length;
                  setGenerationProgress({ current: completedSoFar, total: config.TOTAL_PAGES });
              }
          };

          if (maxConcurrentPages <= 1) {
              // Sequential: preserves each page's view of the previous page's art.
              for (const pageNum of pagesToGen) {
                  if (isStoppedRef.current) break;
                  await runPage(pageNum);
              }
          } else {
              // Concurrent: the queue caps in-flight requests and throttles per minute.
              await Promise.all(
                  pagesToGen.map(pageNum =>
                      queue.submit(() => runPage(pageNum), { id: `page-${pageNum}`, priority: 'normal' })
                          .catch(e => console.error(`[batch] Page ${pageNum} failed`, e)),
                  ),
              );
          }
      } catch (e) {
          console.error("Batch generation error", e);
      } finally {
          if (isStoppedRef.current) {
              setComicFaces(prev => prev.filter(f => !f.isLoading || !!f.imageUrl || f.id === 'cover'));
              setGenerationProgress(null); // Phase 4.2 — Clear on stop
          }
          pagesToGen.forEach(p => generatingPages.current.delete(p));

          // Auto-continue in Outline Mode: generate next batch if more pages remain
          if (!isStoppedRef.current && generateFromOutlineRef.current) {
              const maxGenerated = Math.max(...pagesToGen, 0);
              if (maxGenerated < config.TOTAL_PAGES) {
                  // Schedule next batch after a small delay
                  setTimeout(() => {
                      if (!isStoppedRef.current) {
                          generateBatch(maxGenerated + 1, config.BATCH_SIZE);
                      }
                  }, 100);
              } else {
                  setGenerationProgress(null); // Phase 4.2 — Clear when all pages done
              }
          }
      }
  }

  const handleStoryContextUpdate = (updates: Partial<StoryContext>) => {
    setStoryContext(prev => ({ ...prev, ...updates }));
  };

  // Handle preset selection - updates genre, art style, page length, and story description
  const handlePresetSelect = (preset: ComicPreset) => {
    // Update genre
    setSelectedGenre(preset.genre);

    // Update story context with art style, page length, and story hint
    setStoryContext(prev => ({
      ...prev,
      artStyle: preset.artStyle,
      pageLength: preset.pageLength,
      // Use outline template for story description if available, otherwise use story hint
      descriptionText: preset.outlineTemplate || preset.storyHint
    }));
  };

  const handleOutlineUpload = async (file: File) => {
    if (file.type && !file.type.startsWith('text/') && !file.name.match(/\.(txt|md)$/i)) {
       showToast({ type: 'error', message: 'Outlines must be .txt or .md files. PDFs are not supported.' });
       return;
    }
    try {
      const content = await file.text();
      setStoryOutline({
        content,
        isReady: true,
        isGenerating: false
      });
    } catch (e) {
      console.error("Failed to read outline file.");
    }
  };


  /**
   * Parse enhanced outline text into structured PageCharacterPlan array
   * Robust implementation with multiple fallback strategies
   */

  // Mode Selection Handlers
  const handleStartAdventure = () => {
    // Validate basic requirements before showing mode selection
    if (!getHero()) {
      showToast({ type: 'warning', message: 'Add a portrait for your main character before starting.' });
      return;
    }
    if (selectedGenre === 'Custom' && !customPremise.trim()) {
      showToast({ type: 'warning', message: 'Custom genre needs a story premise — describe what happens.' });
      return;
    }
    setShowModeSelection(true);
  };

  const handleModeSelect = (mode: 'novel' | 'outline') => {
    const isOutline = mode === 'outline';
    generateFromOutlineRef.current = isOutline; // sync ref BEFORE launchStory reads it
    setGenerateFromOutline(isOutline);
    if (isOutline) {
      setStoryOutline({ content: "", isReady: false, isGenerating: false });
    }
    setShowModeSelection(false);

    // Show what this run will cost before spending the user's quota on it.
    const cast = [getHero(), getFriend(), ...getAdditionalChars()].filter(Boolean) as Persona[];
    const { qaAutoReroll, useModelSheets } = useSettingsStore.getState();
    setPendingPlan({
      pageCount: storyContext.pageLength,
      characterCount: cast.length,
      isOutlineMode: isOutline,
      missingModelSheets: useModelSheets
        ? cast.filter(p => !hasValidModelSheet(p, storyContext.artStyle)).map(p => p.name || 'Unnamed')
        : [],
      qaEnabled: qaAutoReroll,
      artStyle: storyContext.artStyle,
    });
  };

  /** User confirmed the cost estimate — start the run. */
  const handleConfirmGeneration = () => {
    setPendingPlan(null);
    // A new run supersedes whatever was restored.
    setResumablePageCount(0);
    launchStory();
  };

  /** User backed out — return them to mode selection rather than the setup form. */
  const handleCancelGeneration = () => {
    setPendingPlan(null);
    setShowModeSelection(true);
  };

  const handleModeSelectionBack = () => {
    setShowModeSelection(false);
  };

  const launchStory = async () => {
    const hasKey = await validateApiKey();
    if (!hasKey) return;

    // Basic validation already done in handleStartAdventure
    if (!getHero()) return;

    // Feature E: autoCharacterAnalysis setting also controls whether to skip AI analysis
    const autoAnalysisEnabled = useSettingsStore.getState().autoCharacterAnalysis;
    if (skipProfileAnalysis || !autoAnalysisEnabled) {
        // Skip AI analysis - use blank profiles for manual entry
        const profiles = generateBlankProfiles();
        setTempProfiles(profiles);
        setShowProfilesStep(true);
    } else if (useSavedProfiles) {
        // Check for existing saved profiles and use them if available
        setIsGeneratingProfiles(true);
        try {
            const store = useCharacterStore.getState();
            const allChars = [getHero(), getFriend(), ...getAdditionalChars()].filter(Boolean) as Persona[];
            const existingProfiles = store.getProfilesArray();

            // Find which characters already have profiles
            const existingProfileIds = new Set(existingProfiles.map(p => p.id));
            const charsWithProfiles = allChars.filter(c => existingProfileIds.has(c.id));
            const charsWithoutProfiles = allChars.filter(c => !existingProfileIds.has(c.id));

            // Staleness detection: check compiled references for age (GAP-DISCONNECT-5)
            const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
            const existingRefs = store.getReferencesArray();
            const now = Date.now();
            const staleRefs = existingRefs.filter(ref => ref.compiledAt && (now - ref.compiledAt) > STALE_THRESHOLD_MS);
            if (staleRefs.length > 0) {
                const staleNames = staleRefs.map(r => r.characterName || r.characterId).join(', ');
                console.warn(`[Profile] Stale saved profiles detected (>24h old): ${staleNames}. Consider re-analyzing.`);
                setHasStaleSavedProfiles(true);
            } else {
                setHasStaleSavedProfiles(false);
            }

            let finalProfiles: CharacterProfile[] = [];

            // Reuse existing profiles
            for (const char of charsWithProfiles) {
                const existingProfile = existingProfiles.find(p => p.id === char.id);
                if (existingProfile) {
                    finalProfiles.push(existingProfile);
                }
            }

            // Generate missing profiles
            if (charsWithoutProfiles.length > 0) {
                console.log(`[Profile] Generating ${charsWithoutProfiles.length} missing profile(s)...`);
                for (const char of charsWithoutProfiles) {
                    try {
                        const profile = await generateCharacterProfile(char);
                        finalProfiles.push(profile);
                        // Note: Profile will be saved via batch setAllProfiles() at the end
                    } catch (e) {
                        console.error(`Failed to generate profile for ${char.name}:`, e);
                        // Create a blank profile as fallback
                        const blankProfile: CharacterProfile = {
                            id: char.id,
                            name: char.name,
                            faceDescription: '',
                            bodyType: '',
                            clothing: '',
                            colorPalette: '',
                            distinguishingFeatures: ''
                        };
                        finalProfiles.push(blankProfile);
                        // Note: Profile will be saved via batch setAllProfiles() at the end
                    }
                }
            }

            // Sort profiles to match character order
            const charOrder = allChars.map(c => c.id);
            finalProfiles.sort((a, b) => charOrder.indexOf(a.id) - charOrder.indexOf(b.id));

            // Set profiles and skip to generation (no ProfilesDialog)
            setTempProfiles(finalProfiles);
            store.setAllProfiles(finalProfiles);

            // Skip ProfilesDialog and proceed directly
            if (generateFromOutlineRef.current && !storyOutline.isReady) {
                setShowOutlineStep(true);
                generateOutline();
            } else {
                proceedToComicGeneration();
            }
        } catch (e) {
            console.error("Profile handling failed:", e);
            // Fallback to manual entry
            const profiles = generateBlankProfiles();
            setTempProfiles(profiles);
            setShowProfilesStep(true);
        } finally {
            setIsGeneratingProfiles(false);
        }
    } else {
        // Original flow - AI analysis with ProfilesDialog review
        setIsGeneratingProfiles(true);
        try {
            const profiles = await generateAllProfiles();
            setTempProfiles(profiles);
            setShowProfilesStep(true);
        } catch (e) {
            console.error("Profile generation failed before starting:", e);
            showToast({ type: 'error', message: 'Could not analyse the character portraits. Check your API key and connection.' });
        } finally {
            setIsGeneratingProfiles(false);
        }
    }
  };

  const continueAfterProfiles = () => {
    // Sync all profiles to Zustand store
    useCharacterStore.getState().setAllProfiles(tempProfiles);
    setShowProfilesStep(false);

    if (generateFromOutline && !storyOutline.isReady) {
        setShowOutlineStep(true);
        generateOutline();
        return;
    }

    proceedToComicGeneration();
  };

  const proceedToComicGeneration = () => {
    const isNovelMode = !generateFromOutline;
    const config = getComicConfig(storyContext.pageLength, extraPages, isNovelMode);
    setIsTransitioning(true);
    isStoppedRef.current = false;
    
    let availableTones = TONES;
    if (selectedGenre === "Teen Drama / Slice of Life" || selectedGenre === "Lighthearted Comedy") {
        availableTones = TONES.filter(t => t.includes("CASUAL") || t.includes("WHOLESOME") || t.includes("QUIPPY"));
    } else if (selectedGenre === "Classic Horror") {
        availableTones = TONES.filter(t => t.includes("INNER-MONOLOGUE") || t.includes("OPERATIC"));
    }
    
    setStoryTone(availableTones[Math.floor(Math.random() * availableTones.length)]);

    // A supplied cover skips the most expensive call in the run. It is generated
    // first, before the user has seen anything, so reusing existing key art saves
    // both money and the wait before the first page appears.
    const suppliedCover = storyContext.preGeneratedCover;
    const coverFace: ComicFace = suppliedCover
      ? {
          id: 'cover', type: 'cover', choices: [], isLoading: false, pageIndex: 0,
          imageUrl: suppliedCover,
          narrative: {
            scene: `Cover art for "${storyContext.title || 'Untitled'}" (supplied by the user).`,
            choices: [], focus_char: 'hero',
          },
        }
      : { id: 'cover', type: 'cover', choices: [], isLoading: true, pageIndex: 0 };

    setComicFaces([coverFace]);
    historyRef.current = [coverFace];

    if (!suppliedCover) {
      generatingPages.current.add(0);
      generateSinglePage({ faceId: 'cover', pageNum: 0, type: 'cover' }).finally(() => generatingPages.current.delete(0));
    } else {
      console.log('[cover] using the supplied cover; skipping generation');
    }
    
    setTimeout(async () => {
        setIsStarted(true);
        setShowSetup(false);
        setIsTransitioning(false);
        // Initialize Novel Mode state with target pages
        setNovelModeState(prev => ({
            ...prev,
            originalTargetPages: storyContext.pageLength,
            isWrappingUp: false,
            hasExceededTarget: false,
            customActionHistory: [],
            outlineDriftDetected: false,
            driftSummary: undefined
        }));
        cachedChoicesRef.current.clear();
        // Generate the initial batch of pages.
        // Novel Mode: generates NOVEL_MODE_BATCH_SIZE pages (a full spread) before showing any decision.
        // Outline Mode: generates 1 page then kicks off the batch pipeline.
        await generateBatch(1, config.INITIAL_PAGES);
        if (!isNovelMode) {
            // Outline Mode only: kick off next batch immediately (Novel Mode waits for user's choice)
            generateBatch(config.INITIAL_PAGES + 1, config.BATCH_SIZE);
        }
    }, 1100);
  };

  // Detect if custom action diverges significantly from the story outline
  const detectOutlineDrift = (customAction: string, currentPage: number): { isDrifting: boolean; summary?: string } => {
      if (!storyOutline.content || !storyOutline.isReady) {
          return { isDrifting: false };
      }

      // Extract relevant outline section for current page range
      const outlineLines = storyOutline.content.split('\n');
      const pagePattern = new RegExp(`PAGE\\s*${currentPage}|Page\\s*${currentPage}`, 'i');

      let relevantSection = '';
      let foundPage = false;
      for (const line of outlineLines) {
          if (pagePattern.test(line)) {
              foundPage = true;
          }
          if (foundPage) {
              relevantSection += line + '\n';
              if (/PAGE\s*\d+/i.test(line) && !pagePattern.test(line)) {
                  break;
              }
          }
      }

      if (!relevantSection) {
          return { isDrifting: false };
      }

      // Extract keywords from both action and outline section
      const extractKeywords = (text: string): string[] => {
          const stopWords = ['the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'by', 'this', 'that', 'it'];
          return text.toLowerCase()
              .replace(/[^\w\s]/g, '')
              .split(/\s+/)
              .filter(word => word.length > 3 && !stopWords.includes(word));
      };

      const outlineKeywords = extractKeywords(relevantSection);
      const actionKeywords = extractKeywords(customAction);

      // Check for significant divergence
      const overlap = outlineKeywords.filter(k => actionKeywords.includes(k));
      const overlapRatio = overlap.length / Math.max(outlineKeywords.length, 1);

      // Check for location/character contradictions
      const actionLower = customAction.toLowerCase();
      const contradictions: string[] = [];

      if ((actionLower.includes('leave') || actionLower.includes('go to') || actionLower.includes('travel')) &&
          !relevantSection.toLowerCase().includes('leave') && !relevantSection.toLowerCase().includes('travel')) {
          contradictions.push('Unexpected location change');
      }

      if (overlapRatio < 0.15 || contradictions.length > 0) {
          return {
              isDrifting: true,
              summary: contradictions.length > 0
                  ? `Your action "${customAction.substring(0, 40)}..." may diverge from the outline: ${contradictions.join(', ')}`
                  : `Your action "${customAction.substring(0, 40)}..." diverges from the planned story direction.`
          };
      }

      return { isDrifting: false };
  };

  const handleChoice = async (pageIndex: number, choice: string, isCustomAction: boolean = false) => {
      const isNovelMode = !generateFromOutline;
      const config = getComicConfig(storyContext.pageLength, extraPages, isNovelMode);

      // Mark the choice on the current page
      updateFaceState(`page-${pageIndex}`, { resolvedChoice: choice, customActionUsed: isCustomAction ? choice : undefined });

      // If skipped, just dismiss the dialogue - don't generate new pages
      if (choice === '[SKIPPED]') return;

      if (isNovelMode) {
          // Track custom actions for potential drift detection
          if (isCustomAction) {
              setNovelModeState(prev => ({
                  ...prev,
                  customActionHistory: [
                      ...prev.customActionHistory,
                      { pageIndex, action: choice, timestamp: Date.now() }
                  ]
              }));

              // Check for outline drift if we have an outline
              if (storyOutline.isReady && storyOutline.content) {
                  const driftResult = detectOutlineDrift(choice, pageIndex);
                  if (driftResult.isDrifting) {
                      setNovelModeState(prev => ({
                          ...prev,
                          outlineDriftDetected: true,
                          driftSummary: driftResult.summary
                      }));
                      // Don't block - just flag for user notification
                  }
              }
          }

          const currentPage = Math.max(...historyRef.current.map(f => f.pageIndex || 0));
          const nextPage = currentPage + 1;

          // Check if we've reached/exceeded target
          if (nextPage > novelModeState.originalTargetPages && !novelModeState.hasExceededTarget) {
              setNovelModeState(prev => ({ ...prev, hasExceededTarget: true }));
          }

          // Generate NOVEL_MODE_BATCH_SIZE pages after each choice (one full spread)
          const batchEnd = Math.min(nextPage + NOVEL_MODE_BATCH_SIZE - 1, config.TOTAL_PAGES);
          const pagesToGen: number[] = [];
          for (let p = nextPage; p <= batchEnd; p++) {
              if (!generatingPages.current.has(p)) pagesToGen.push(p);
          }

          if (pagesToGen.length > 0) {
              // Create all placeholder faces upfront
              pagesToGen.forEach(pageNum => {
                  const faceId = `page-${pageNum}`;
                  const type: ComicFace['type'] = pageNum === config.BACK_COVER_PAGE ? 'back_cover' : 'story';
                  const isExtra = pageNum > novelModeState.originalTargetPages;
                  const newFace: ComicFace = {
                      id: faceId, type, choices: [], isLoading: true,
                      pageIndex: pageNum, isExtraPage: isExtra,
                      isDecisionPage: false // will be resolved by generateSinglePage via config.DECISION_PAGES
                  };
                  setComicFaces(prev => prev.find(f => f.id === faceId) ? prev : [...prev, newFace]);
                  if (!historyRef.current.find(h => h.id === faceId)) historyRef.current.push(newFace);
                  generatingPages.current.add(pageNum);
              });

              // Generate pages sequentially; only the first carries the user's choice as instruction
              for (let i = 0; i < pagesToGen.length; i++) {
                  const pageNum = pagesToGen[i];
                  const faceId = `page-${pageNum}`;
                  const type: ComicFace['type'] = pageNum === config.BACK_COVER_PAGE ? 'back_cover' : 'story';
                  const instruction = i === 0 ? `User chose: "${choice}". Continue the story based on this choice.` : undefined;
                  await generateSinglePage({ faceId, pageNum, type, instruction });
                  generatingPages.current.delete(pageNum);

                  // Cache choices for reroll preservation
                  const generatedFace = historyRef.current.find(f => f.pageIndex === pageNum);
                  if (generatedFace?.choices && generatedFace.choices.length > 0) {
                      cachedChoicesRef.current.set(pageNum, [...generatedFace.choices]);
                      updateFaceState(faceId, { originalChoices: [...generatedFace.choices] });
                  }
              }
          }
      } else {
          // Outline Mode: Use batch generation
          const maxPage = Math.max(...historyRef.current.map(f => f.pageIndex || 0));
          if (maxPage + 1 <= config.TOTAL_PAGES) {
              generateBatch(maxPage + 1, config.BATCH_SIZE);
          }
      }
  }

  // Get wrap-up instruction for final story page
  const getWrapUpInstruction = (): string => {
      // Collect significant user choices for narrative closure
      const significantChoices = novelModeState.customActionHistory
          .slice(-3) // Last 3 custom actions
          .map(c => c.action)
          .join(', ');

      return `
This is the FINAL PAGE of the story. The user has chosen to end it here.

INSTRUCTIONS:
1. Bring the current narrative thread to a SATISFYING CONCLUSION
2. Reference the user's key choices: ${significantChoices || 'their journey throughout the story'}
3. End with either:
   - A clear resolution (if the story feels complete)
   - A meaningful cliffhanger with "TO BE CONTINUED..." (if tension remains)
4. Make the ending feel EARNED - don't rush, but don't drag
5. The tone should match the story's established mood
6. DO NOT generate any choices - this is the final page

Create a powerful, memorable conclusion that honors the user's story path.
      `.trim();
  };

  // Handle "Stop Here" - wrap up story with final page
  const handleStopHere = async () => {
      setNovelModeState(prev => ({ ...prev, isWrappingUp: true }));

      const currentPage = Math.max(...historyRef.current.map(f => f.pageIndex || 0));
      const wrapUpPage = currentPage + 1;
      const config = getComicConfig(storyContext.pageLength, extraPages, true);

      // Generate final wrap-up page (not a decision page)
      const faceId = `page-${wrapUpPage}`;
      const newFace: ComicFace = {
          id: faceId,
          type: 'story',
          choices: [],
          isLoading: true,
          pageIndex: wrapUpPage,
          isDecisionPage: false // Final page has no choices
      };

      setComicFaces(prev => [...prev.filter(f => f.id !== faceId), newFace]);
      historyRef.current = historyRef.current.filter(f => f.id !== faceId);
      historyRef.current.push(newFace);
      generatingPages.current.add(wrapUpPage);

      try {
          // Writer-scoped: this is narrative direction, not art direction.
          await generateSinglePage({ faceId, pageNum: wrapUpPage, type: 'story', instruction: getWrapUpInstruction(), instructionScope: 'writer' });
      } catch (e) {
          console.error('[handleStopHere] Wrap-up page generation failed:', e);
          updateFaceState(faceId, { isLoading: false, hasFailed: true });
      } finally {
          generatingPages.current.delete(wrapUpPage);
      }

      // Check if wrap-up page succeeded before generating back cover
      const wrapUpResult = historyRef.current.find(f => f.id === faceId);
      if (wrapUpResult?.hasFailed) {
          console.warn('[handleStopHere] Wrap-up page failed, skipping back cover');
          setNovelModeState(prev => ({ ...prev, isWrappingUp: false }));
          return;
      }

      // Generate back cover
      const backCoverPage = wrapUpPage + 1;
      const backCoverId = `page-${backCoverPage}`;
      const backCoverFace: ComicFace = {
          id: backCoverId,
          type: 'back_cover',
          choices: [],
          isLoading: true,
          pageIndex: backCoverPage,
          isDecisionPage: false
      };

      setComicFaces(prev => [...prev.filter(f => f.id !== backCoverId), backCoverFace]);
      historyRef.current.push(backCoverFace);
      generatingPages.current.add(backCoverPage);

      try {
          await generateSinglePage({ faceId: backCoverId, pageNum: backCoverPage, type: 'back_cover' });
      } catch (e) {
          console.error('[handleStopHere] Back cover generation failed:', e);
          updateFaceState(backCoverId, { isLoading: false, hasFailed: true });
      } finally {
          generatingPages.current.delete(backCoverPage);
      }

      // Update extra pages count
      setExtraPages(wrapUpPage - storyContext.pageLength);
      setNovelModeState(prev => ({ ...prev, isWrappingUp: false }));
  };

  const handleReroll = (pageIndex: number) => {
      setRerollTarget(pageIndex);
  };

  // Quick retry with enhanced context (emblem/weapon refs + outline)
  const handleQuickRetry = async (pageIndex: number) => {
      const config = getComicConfig(storyContext.pageLength, extraPages);
      const faceId = pageIndex === 0 ? 'cover' : `page-${pageIndex}`;
      const type: ComicFace['type'] = pageIndex === 0 ? 'cover' : (pageIndex === config.BACK_COVER_PAGE ? 'back_cover' : 'story');

      // Collect all emblem and weapon reference images
      const enhancedRefImages: string[] = [];
      const collectRefs = (p: Persona | null) => {
          if (!p) return;
          if (p.emblemImage) enhancedRefImages.push(p.emblemImage);
          if (p.weaponImage) enhancedRefImages.push(p.weaponImage);
          // Also include portrait and character refs for better consistency
          if (p.base64) enhancedRefImages.push(p.base64);
          const refs = p.referenceImages || (p.referenceImage ? [p.referenceImage] : []);
          refs.forEach(r => enhancedRefImages.push(r));
      };
      collectRefs(getHero());
      collectRefs(getFriend());
      getAdditionalChars().forEach(c => collectRefs(c));

      // Build enhanced instruction with page context
      let enhancedInstruction = `This is a retry for page ${pageIndex}.`;

      // Add outline context if available
      if (storyOutline.content && generateFromOutline) {
          // Try to extract the relevant page section from outline
          const outlineLines = storyOutline.content.split('\n');
          const pagePattern = new RegExp(`(page\\s*${pageIndex}|panel\\s*${pageIndex})`, 'i');
          let pageOutline = '';
          let capturing = false;
          for (const line of outlineLines) {
              if (pagePattern.test(line)) {
                  capturing = true;
                  pageOutline = line + '\n';
              } else if (capturing) {
                  if (/^(page|panel)\s*\d+/i.test(line)) break;
                  pageOutline += line + '\n';
              }
          }
          if (pageOutline.trim()) {
              enhancedInstruction += `\n\nOUTLINE FOR THIS PAGE:\n${pageOutline.trim()}`;
          }
      }

      enhancedInstruction += `\n\nPay special attention to character emblems, logos, and weapons. Use the provided reference images to ensure accuracy.`;

      // Set loading state
      updateFaceState(faceId, { isLoading: true, hasFailed: false });

      // Generate with enhanced context
      try {
          // Preserve the page's caption and dialogue. Quick Retry used to regenerate
          // the beat, so a retry could return art with no speech bubbles at all —
          // the same defect fixed for the reroll modal in the previous session.
          const retryFace = historyRef.current.find(fc => fc.id === faceId);
          await generateSinglePage({
              faceId,
              pageNum: pageIndex,
              type,
              instruction: enhancedInstruction,
              extraRefImages: enhancedRefImages.length > 0 ? enhancedRefImages : undefined,
              existingBeat: retryFace?.narrative,
          });
      } catch (e) {
          console.error('Quick retry failed:', e);
          updateFaceState(faceId, { isLoading: false, hasFailed: true });
      }
  };

  const getRerollGallery = () => {
      const items: { id: string; base64: string; label: string; charId: string }[] = [];
      const addPersona = (p: Persona | null, label: string) => {
          if (!p) return;
          // Model sheet first: it is the canonical reference, and listing it at the
          // top makes that legible. Its absence from this gallery is why every
          // reroll used to fall back to raw portraits.
          if (p.modelSheet) items.push({ id: `${p.id}-sheet`, base64: p.modelSheet, label: `${label} Model Sheet`, charId: p.id });
          if (p.base64) items.push({ id: `${p.id}-portrait`, base64: p.base64, label: `${label} Portrait`, charId: p.id });
          const refs = p.referenceImages || (p.referenceImage ? [p.referenceImage] : []);
          refs.forEach((r, i) => items.push({ id: `${p.id}-ref-${i}`, base64: r, label: `${label} Ref ${i+1}`, charId: p.id }));
          if (p.emblemImage) items.push({ id: `${p.id}-emblem`, base64: p.emblemImage, label: `${label} Emblem`, charId: p.id });
          if (p.weaponImage) items.push({ id: `${p.id}-weapon`, base64: p.weaponImage, label: `${label} Weapon`, charId: p.id });
      };
      addPersona(hero, hero?.name || 'Hero');
      addPersona(friend, friend?.name || 'Co-Star');
      additionalCharacters.forEach(c => addPersona(c, c.name || 'Char'));
      return items;
  };

  const handleRerollSubmit = (options: RerollOptions) => {
      if (rerollTarget === null) return;
      const { instruction, negativePrompt, selectedRefImages, selectedProfileIds, regenerationModes, regenerateNarrative, shotTypeOverride, balloonShapeOverride, applyFlashbackStyle, reinforceWithReferenceImages, useSelectedRefsOnly, prevPageImageUrl, nextPageImageUrl, consistencyMode, preserveCharacterIds } = options;

      const pageIndex = rerollTarget;
      setRerollTarget(null);
      const faceId = pageIndex === 0 ? 'cover' : `page-${pageIndex}`;
      const rerollConfig = getComicConfig(storyContext.pageLength, extraPages);
      const type: ComicFace['type'] = pageIndex === 0 ? 'cover'
          : (pageIndex === rerollConfig.BACK_COVER_PAGE ? 'back_cover' : 'story');

      // Get previous choices from the face being rerolled (for Novel Mode choice reroll)
      const currentFace = comicFaces.find(f => f.id === faceId);
      const previousChoices = currentFace?.isDecisionPage ? currentFace.choices : undefined;

      // Store previous choices in face state for potential future rerolls
      const existingPreviousChoices = currentFace?.previousChoices || [];
      const allPreviousChoices = previousChoices
          ? [...existingPreviousChoices, ...previousChoices]
          : existingPreviousChoices;

      // Build final instruction based on regeneration modes (supports multiple)
      let finalInstruction = instruction || '';
      const modeInstructions: Record<RegenerationMode, string> = {
          'full': '',
          'characters_only': 'Redraw only the characters, matching their cast references more closely. Keep the background, environment, lighting, and composition of the existing panel identical.',
          'expression_only': 'Change only the facial expressions. Keep pose, clothing, background, and lighting identical to the existing panel.',
          'outfit_only': 'Change only the clothing. Keep faces, pose, background, and lighting identical to the existing panel.',
          'emblem_only': 'Change only the emblem, reproducing the emblem reference exactly — same shape, colours, proportions, and placement. Everything else stays identical to the existing panel.',
          'weapon_only': 'Change only the weapon, reproducing the weapon reference exactly — same design, shape, and details. Everything else stays identical to the existing panel.'
      };

      // BATCH 1.4.1: Pass current image for non-full modes to help preserve scene
      // Also include when preserve characters are selected (need reference panel for copying them)
      const isNonFullMode = regenerationModes && regenerationModes.some(m => m !== 'full');
      const hasPreserveMode = preserveCharacterIds && preserveCharacterIds.length > 0;
      const currentImage = (isNonFullMode || hasPreserveMode) && currentFace?.imageUrl ? currentFace.imageUrl : undefined;

      // Combine instructions from all selected modes (excluding 'full')
      if (regenerationModes && regenerationModes.length > 0) {
          const nonFullModes = regenerationModes.filter(m => m !== 'full');
          if (nonFullModes.length > 0) {
              const combinedModeInstructions = nonFullModes.map(m => modeInstructions[m]).join(' ');
              finalInstruction = combinedModeInstructions + (instruction ? ` Additional: ${instruction}` : '');
          }
      }

      // Add negative prompt if provided - explicitly tell AI what NOT to include
      if (negativePrompt) {
          finalInstruction += ` Do not include: ${negativePrompt}.`;
      }

      // Reference reinforcement. Deliberately one short sentence: the prompt's
      // RULES block already states that costumes and faces must match their
      // references, and restating it in caps only competes with that.
      if (reinforceWithReferenceImages && selectedRefImages.length > 0) {
          finalInstruction += ` Treat the supplied reference images as the source of truth for appearance.`;
      }

      // Build comic fundamentals overrides object
      const comicOverrides = {
          shotTypeOverride,
          balloonShapeOverride,
          applyFlashbackStyle,
      };

      updateFaceState(faceId, { isLoading: true, imageUrl: undefined, hasFailed: false, previousChoices: allPreviousChoices });

      // DISCONNECT-6 FIX: Pass filtered profiles as an override instead of mutating the global store.
      // The previous pattern (setAllProfiles(filtered) → generate → setAllProfiles(restored)) was
      // fragile under concurrent rerolls or errors. profileOverrides is used only for this call.
      const allProfiles = getProfilesArray();
      const profileOverrides = allProfiles.filter(p => selectedProfileIds.includes(p.id));

      // In Novel Mode, preserve original choices instead of regenerating them
      const isNovelMode = !generateFromOutline;
      const preservedChoices = isNovelMode && currentFace?.isDecisionPage
          ? (currentFace.originalChoices || cachedChoicesRef.current.get(pageIndex) || currentFace.choices)
          : undefined;

      // Build adjacent page images for scene/outfit continuity
      const rerollAdjacentImages: Array<{ base64: string; label: string }> = [];
      if (prevPageImageUrl) {
          const base64 = prevPageImageUrl.includes(',') ? prevPageImageUrl.split(',')[1] : prevPageImageUrl;
          rerollAdjacentImages.push({ base64, label: `PREVIOUS PAGE (page ${pageIndex - 1})` });
      }
      if (nextPageImageUrl) {
          const base64 = nextPageImageUrl.includes(',') ? nextPageImageUrl.split(',')[1] : nextPageImageUrl;
          rerollAdjacentImages.push({ base64, label: `NEXT PAGE (page ${pageIndex + 1})` });
      }

      generateSinglePage({
          faceId,
          pageNum: pageIndex,
          type,
          instruction: finalInstruction || undefined,
          extraRefImages: selectedRefImages.length > 0 ? selectedRefImages : undefined,
          previousChoices: allPreviousChoices.length > 0 ? allPreviousChoices : undefined,
          comicOverrides,
          useOnlySelectedRefs: useSelectedRefsOnly && selectedRefImages.length > 0,
          currentImageToPreserve: currentImage,
          adjacentPageImages: rerollAdjacentImages.length > 0 ? rerollAdjacentImages : undefined,
          consistencyMode,
          profileOverrides: profileOverrides.length > 0 ? profileOverrides : undefined,
          preserveCharacterIds: hasPreserveMode ? preserveCharacterIds : undefined,
          existingBeat: regenerateNarrative ? undefined : currentFace?.narrative,
      })
          .then(() => {
              // Restore preserved choices in Novel Mode after image regeneration
              if (preservedChoices && preservedChoices.length > 0 && isNovelMode) {
                  updateFaceState(faceId, {
                      choices: preservedChoices,
                      originalChoices: preservedChoices,
                      isDecisionPage: currentFace?.isDecisionPage
                  });
              }
          })
          .catch((error) => {
              console.error(`Reroll failed for page ${pageIndex}:`, error);
          });
  };

  const handleRerollUploadRef = async (files: FileList) => {
      // Upload new refs to the hero by default (they'll appear in the gallery)
      try {
          const newRefs: string[] = [];
          for (let i = 0; i < files.length; i++) {
              newRefs.push(await fileToBase64(files[i]));
          }
          const existing = hero?.referenceImages || (hero?.referenceImage ? [hero.referenceImage] : []);
          handleHeroUpdate({ referenceImages: [...existing, ...newRefs] });
      } catch (e) { console.error('Upload failed'); }
  };

  const handleRerollDeleteRef = (charId: string, refIndex: number) => {
      const getExisting = (p: Persona | null) => p?.referenceImages || (p?.referenceImage ? [p.referenceImage] : []);
      if (charId === 'hero' || charId === hero?.id) {
          handleHeroUpdate({ referenceImages: getExisting(hero).filter((_, i) => i !== refIndex) });
      } else if (charId === 'friend' || charId === friend?.id) {
          handleFriendUpdate({ referenceImages: getExisting(friend).filter((_, i) => i !== refIndex) });
      } else {
          const char = additionalCharacters.find(c => c.id === charId);
          handleUpdateCharacter(charId, { referenceImages: getExisting(char || null).filter((_, i) => i !== refIndex) });
      }
  };

  const handleAddPage = (instruction?: string) => {
      const oldConfig = getComicConfig(storyContext.pageLength, extraPages);
      const newExtraPages = extraPages + 1;
      setExtraPages(newExtraPages);
      
      const newConfig = getComicConfig(storyContext.pageLength, newExtraPages);
      const oldBackCoverId = `page-${oldConfig.BACK_COVER_PAGE}`;
      
      // Convert old back cover to story
      updateFaceState(oldBackCoverId, { type: 'story', isLoading: true, imageUrl: undefined });
      
      // Add the new back cover to state
      const newBackCover: ComicFace = { id: `page-${newConfig.BACK_COVER_PAGE}`, type: 'back_cover', choices: [], isLoading: true, pageIndex: newConfig.BACK_COVER_PAGE };
      setComicFaces(prev => [...prev, newBackCover]);
      historyRef.current.push(newBackCover);
      
      generatingPages.current.add(oldConfig.BACK_COVER_PAGE);
      generateSinglePage({ faceId: oldBackCoverId, pageNum: oldConfig.BACK_COVER_PAGE, type: 'story', instruction }).finally(() => {
          generatingPages.current.delete(oldConfig.BACK_COVER_PAGE);
          generatingPages.current.add(newConfig.BACK_COVER_PAGE);
          generateSinglePage({ faceId: `page-${newConfig.BACK_COVER_PAGE}`, pageNum: newConfig.BACK_COVER_PAGE, type: 'back_cover' }).finally(() => {
              generatingPages.current.delete(newConfig.BACK_COVER_PAGE);
          });
      });
  };

  const handleStop = () => {
      isStoppedRef.current = true;
      setComicFaces(prev => prev.filter(f => !f.isLoading || !!f.imageUrl || f.id === 'cover'));
  };

  const resetApp = () => {
      isStoppedRef.current = true; // abort any in-flight generation
      setIsStarted(false);
      setShowSetup(true);
      setComicFaces([]);
      setCurrentSheetIndex(0);
      historyRef.current = [];
      generatingPages.current.clear();
      setHero(null);
      setFriend(null);
      useCharacterStore.getState().clearAdditionalCharacters();
      setExtraPages(0);
  };

  const handleGoHome = async () => {
      const ok = await confirm({
          title: 'Back to setup?',
          message:
              'This clears the pages from the reader so you can start a new comic.\n\n' +
              'Your characters, settings, and model sheets are kept, and this comic stays in Recent Sessions — you can reload it from the setup screen at any time.',
          confirmLabel: 'Back to setup',
      });
      if (!ok) return;

      isStoppedRef.current = true; // abort any in-flight generation
      setIsStarted(false);
      setShowSetup(true);
      setComicFaces([]);
      historyRef.current = [];
      generatingPages.current.clear();
      setExtraPages(0);
      setResumablePageCount(0);
  };

  const handleClearSetup = async () => {
      const ok = await confirm({
          title: 'Clear everything?',
          message:
              'This permanently deletes your characters, their portraits, reference images, and model sheets, along with your story settings.\n\n' +
              'This cannot be undone. Export a draft first if you might want them back.',
          confirmLabel: 'Delete everything',
          destructive: true,
      });
      if (!ok) return;
      setHero(null);
      setFriend(null);
      useCharacterStore.getState().clearAdditionalCharacters();
      setStoryContext({
        title: "",
        descriptionText: "",
        descriptionFiles: [],
        publisherName: "Marvel",
        seriesTitle: "Infinite Heroes",
        issueNumber: "1",
        useOverlayLogo: true,
        artStyle: ART_STYLES[0],
        pageLength: DEFAULT_PAGE_LENGTH
      });
      setCustomPremise("");
      setSelectedGenre(GENRES[0]);
      setStoryOutline({ content: "", isReady: false, isGenerating: false });
      localStorage.removeItem('infinite_heroes_cast');
  };

  const compositeCover = async (imageUrl: string, context: StoryContext): Promise<string> => {
      return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = 480;
          canvas.height = 720;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(imageUrl);

          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
               ctx.drawImage(img, 0, 0, 480, 720);
               if (context.useOverlayLogo) {
                   ctx.fillStyle = 'white';
                   ctx.fillRect(160, 20, 160, 80);
                   ctx.lineWidth = 4;
                   ctx.strokeStyle = 'black';
                   ctx.strokeRect(160, 20, 160, 80);
                   
                   ctx.fillStyle = context.publisherLogoBgColor || '#DC2626';
                   ctx.fillRect(160, 20, 160, 45);
                   ctx.strokeRect(160, 20, 160, 45);

                   const finishText = () => {
                       ctx.fillStyle = 'black';
                       ctx.font = 'bold 24px "Comic Sans MS", sans-serif';
                       ctx.textAlign = 'center';
                       ctx.textBaseline = 'middle';
                       ctx.fillText(`#${context.issueNumber || '1'}`, 240, 82);

                       ctx.font = 'bold 44px Impact, sans-serif';
                       ctx.textAlign = 'center';
                       ctx.lineWidth = 6;
                       ctx.lineJoin = 'round';
                       ctx.strokeStyle = 'black';
                       ctx.strokeText(context.seriesTitle.toUpperCase(), 240, 150);
                       ctx.fillStyle = '#FFD700';
                       ctx.fillText(context.seriesTitle.toUpperCase(), 240, 150);

                       // Story Title below Series Title
                       if (context.title) {
                           ctx.font = 'bold 22px Impact, sans-serif';
                           ctx.lineWidth = 4;
                           ctx.strokeStyle = 'black';
                           ctx.strokeText(context.title.toUpperCase(), 240, 190);
                           ctx.fillStyle = 'white';
                           ctx.fillText(context.title.toUpperCase(), 240, 190);
                       }

                       resolve(canvas.toDataURL('image/jpeg', 0.9));
                   };

                   if (context.publisherLogo) {
                       const logoImg = new Image();
                       logoImg.crossOrigin = "anonymous";
                       logoImg.onload = () => {
                           if (context.publisherLogoFit === 'cover') {
                               ctx.drawImage(logoImg, 160, 20, 160, 45);
                           } else {
                               const aspect = logoImg.width / logoImg.height;
                               let lw = 160, lh = 45;
                               if (aspect > 160/45) lh = 160 / aspect;
                               else lw = 45 * aspect;
                               ctx.drawImage(logoImg, 160 + (160-lw)/2, 20 + (45-lh)/2, lw, lh);
                           }
                           finishText();
                       };
                       logoImg.onerror = finishText;
                       logoImg.src = `data:image/png;base64,${context.publisherLogo}`;
                   } else {
                       ctx.fillStyle = 'white';
                       ctx.font = 'bold 16px Impact, sans-serif';
                       ctx.textAlign = 'center';
                       ctx.textBaseline = 'middle';
                       ctx.fillText(context.publisherName.substring(0, 15).toUpperCase(), 240, 42);
                       finishText();
                   }
               } else {
                   resolve(imageUrl);
               }
          };
          img.onerror = () => resolve(imageUrl);
          img.src = imageUrl;
      });
  };

  // Process image with optional CMYK adjustment
  const processImageForPrint = async (imageUrl: string, cmykMode: boolean): Promise<string> => {
    if (!cmykMode) return imageUrl;

    return new Promise<string>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageUrl);
          return;
        }
        ctx.drawImage(img, 0, 0);
        // Real gamut-aware conversion: colours outside the CMYK gamut are
        // clamped rather than the whole image being uniformly desaturated,
        // so in-gamut artwork keeps its punch.
        const printCanvas = convertToCmykSafe(canvas);
        const gamut = analyzeGamut(canvas);
        if (gamut.outOfGamutPercentage > 20) {
          console.warn(`[print] ${gamut.outOfGamutPercentage.toFixed(1)}% of pixels fall outside the CMYK gamut; printed colours will differ from screen.`);
        }
        resolve(printCanvas.toDataURL('image/jpeg', 0.95));
      };
      img.onerror = () => resolve(imageUrl);
      img.src = imageUrl;
    });
  };

  // Draw bleed marks on PDF page
  const drawBleedMarks = (doc: jsPDF, pageWidth: number, pageHeight: number, bleedMm: number) => {
    const bleedPt = bleedMm * 2.83465; // Convert mm to points
    const markLength = 12; // Length of crop marks in points
    const markOffset = 3; // Offset from edge in points

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.5);

    // Top-left corner marks
    doc.line(bleedPt - markOffset - markLength, bleedPt, bleedPt - markOffset, bleedPt); // Horizontal
    doc.line(bleedPt, bleedPt - markOffset - markLength, bleedPt, bleedPt - markOffset); // Vertical

    // Top-right corner marks
    doc.line(pageWidth - bleedPt + markOffset, bleedPt, pageWidth - bleedPt + markOffset + markLength, bleedPt);
    doc.line(pageWidth - bleedPt, bleedPt - markOffset - markLength, pageWidth - bleedPt, bleedPt - markOffset);

    // Bottom-left corner marks
    doc.line(bleedPt - markOffset - markLength, pageHeight - bleedPt, bleedPt - markOffset, pageHeight - bleedPt);
    doc.line(bleedPt, pageHeight - bleedPt + markOffset, bleedPt, pageHeight - bleedPt + markOffset + markLength);

    // Bottom-right corner marks
    doc.line(pageWidth - bleedPt + markOffset, pageHeight - bleedPt, pageWidth - bleedPt + markOffset + markLength, pageHeight - bleedPt);
    doc.line(pageWidth - bleedPt, pageHeight - bleedPt + markOffset, pageWidth - bleedPt, pageHeight - bleedPt + markOffset + markLength);
  };

  const downloadPDF = async (faces: ComicFace[], options: Omit<ExportOptions, 'format'>) => {
    const { cmykMode, addBleedMarks, pageSize, customWidth, customHeight, resolution } = options;

    // Get page dimensions based on selection
    const pageDimensions = pageSize === 'custom'
      ? { width: customWidth, height: customHeight }
      : PAGE_SIZES[pageSize];

    // Convert inches to points (72 points per inch)
    const baseWidthPt = pageDimensions.width * 72;
    const baseHeightPt = pageDimensions.height * 72;

    // Add bleed area if enabled (3mm = ~8.5 points)
    const bleedMm = 3;
    const bleedPt = addBleedMarks ? bleedMm * 2.83465 : 0;
    const PAGE_WIDTH = baseWidthPt + (bleedPt * 2);
    const PAGE_HEIGHT = baseHeightPt + (bleedPt * 2);

    // Get DPI for metadata
    const dpi = RESOLUTION_OPTIONS[resolution].dpi;

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'pt',
      format: [PAGE_WIDTH, PAGE_HEIGHT]
    });

    // Set document properties with resolution info
    doc.setProperties({
      title: storyContext.title || 'Infinite Heroes Comic',
      creator: 'Infinite Heroes Comic Creator',
      keywords: `comic, ${resolution}, ${dpi}DPI`
    });

    const pagesToPrint = faces.filter(face => face.imageUrl && !face.isLoading).sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));

    for (let index = 0; index < pagesToPrint.length; index++) {
        const face = pagesToPrint[index];
        if (index > 0) doc.addPage([PAGE_WIDTH, PAGE_HEIGHT], 'portrait');
        if (face.imageUrl) {
            // Burn in any hand-placed lettering first, so the export matches
            // what the reader shows.
            const letteredUrl = await composeLettering({
              imageUrl: face.imageUrl,
              bubbles: face.bubbles,
              sfx: face.sfx,
              toSFXElement: (p) => placedSFXToElement(p),
            });
            const coverIsSupplied = Boolean(storyContext.preGeneratedCover)
              && face.imageUrl === storyContext.preGeneratedCover;
            let finalImg = (face.type === 'cover' && storyContext.useOverlayLogo && !coverIsSupplied)
                ? await compositeCover(letteredUrl, storyContext)
                : letteredUrl;

            // Apply CMYK adjustment if enabled
            if (cmykMode) {
              finalImg = await processImageForPrint(finalImg, true);
            }

            // Add image with bleed offset
            doc.addImage(finalImg, 'JPEG', 0, 0, PAGE_WIDTH, PAGE_HEIGHT);

            // Draw bleed/trim marks if enabled
            if (addBleedMarks) {
              drawBleedMarks(doc, PAGE_WIDTH, PAGE_HEIGHT, bleedMm);
            }
        }
    }
    doc.save(`${storyContext.title || 'Infinite-Heroes'}-Issue.pdf`);
  };

  const downloadImages = async (faces: ComicFace[], format: 'webp' | 'png' | 'jpeg') => {
    const pagesToPrint = faces.filter(face => face.imageUrl && !face.isLoading).sort((a, b) => (a.pageIndex || 0) - (b.pageIndex || 0));
    const entries: Array<{ name: string; data: string }> = [];
    
    for (const face of pagesToPrint) {
      if (!face.imageUrl) continue;
      
      let downloadUrl = face.imageUrl;
      
      // Same compositing for image export: what is shown is what is saved.
      downloadUrl = await composeLettering({
        imageUrl: downloadUrl,
        bubbles: face.bubbles,
        sfx: face.sfx,
        toSFXElement: (p) => placedSFXToElement(p),
      });

      const suppliedCoverPage = Boolean(storyContext.preGeneratedCover)
        && face.imageUrl === storyContext.preGeneratedCover;
      if (face.type === 'cover' && storyContext.useOverlayLogo && !suppliedCoverPage) {
          downloadUrl = await compositeCover(face.imageUrl, storyContext);
      }
      
      // If the requested format is different from the source, we might need to convert
      // But for simplicity and browser compatibility, we'll try to trigger download with the requested extension
      // Most modern browsers will handle the data URL correctly regardless of the extension if it's a valid image
      // However, to be precise, we can use a canvas to convert
      
      if (!face.imageUrl.includes(`image/${format}`)) {
        downloadUrl = await new Promise<string>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0);
            resolve(canvas.toDataURL(`image/${format}`));
          };
          img.src = face.imageUrl!;
        });
      }

      const pName = face.type === 'cover' ? '00-Cover'
        : face.type === 'back_cover' ? '99-BackCover'
        : `Page-${String(face.pageIndex).padStart(2, '0')}`;
      entries.push({
        name: `${storyContext.title || 'Infinite-Heroes'}-${pName}.${format}`,
        data: downloadUrl,
      });
    }

    // One archive rather than one click per page. Every major browser throttles
    // or silently drops a burst of programmatic downloads, so exporting an issue
    // used to deliver an unpredictable subset of it.
    if (entries.length === 1) {
      const link = document.createElement('a');
      link.href = entries[0].data;
      link.download = entries[0].name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    await downloadAsZip(entries, `${storyContext.title || 'Infinite-Heroes'}-${format}.zip`);
  };

  const handleExport = async (options: ExportOptions) => {
    setShowExportDialog(false);
    const faces = comicFaces.filter(f => f.imageUrl && !f.isLoading);
    if (faces.length === 0) {
      console.warn("No pages ready to export yet!");
      return;
    }

    if (options.format === 'pdf') {
      const { format, ...pdfOptions } = options;
      await downloadPDF(faces, pdfOptions);
    } else {
      await downloadImages(faces, options.format);
    }
  };

  const handleHeroUpdate = async (updates: Partial<Persona>) => {
    // Phase 5.2 — Mark profile stale when portrait changes
    if (updates.base64 && hero && updates.base64 !== hero.base64) {
      useCharacterStore.getState().markProfileStale(hero.id);
    }
    setHero(hero ? { ...hero, ...updates } : { id: 'hero', name: 'Hero', base64: '', desc: 'Main Hero', ...updates });
  };

  const handleFriendUpdate = async (updates: Partial<Persona>) => {
    // Phase 5.2 — Mark profile stale when portrait changes
    if (updates.base64 && friend && updates.base64 !== friend.base64) {
      useCharacterStore.getState().markProfileStale(friend.id);
    }
    setFriend(friend ? { ...friend, ...updates } : { id: 'friend', name: 'Co-Star', base64: '', desc: 'Sidekick', ...updates });
  };

  const handlePortraitUpload = async (id: string, file: File) => {
    try {
      const base64 = await fileToBase64(file);
      if (id === 'hero') handleHeroUpdate({ base64 });
      else if (id === 'friend') handleFriendUpdate({ base64 });
      else handleUpdateCharacter(id, { base64 });
    } catch (e) { console.error("Upload failed"); }
  };

  const handleRefUpload = async (id: string, files: FileList) => {
    try {
      const newRefs: string[] = [];
      for (let i = 0; i < files.length; i++) {
        newRefs.push(await fileToBase64(files[i]));
      }
      const getExisting = (p: Persona | null) => p?.referenceImages || (p?.referenceImage ? [p.referenceImage] : []);
      if (id === 'hero') handleHeroUpdate({ referenceImages: [...getExisting(hero), ...newRefs] });
      else if (id === 'friend') handleFriendUpdate({ referenceImages: [...getExisting(friend), ...newRefs] });
      else {
        const char = additionalCharacters.find(c => c.id === id);
        handleUpdateCharacter(id, { referenceImages: [...getExisting(char || null), ...newRefs] });
      }
    } catch (e) { console.error("Upload failed"); }
  };

  const handleRefRemove = (id: string, index: number) => {
    const getExisting = (p: Persona | null) => p?.referenceImages || (p?.referenceImage ? [p.referenceImage] : []);
    if (id === 'hero') handleHeroUpdate({ referenceImages: getExisting(hero).filter((_, i) => i !== index) });
    else if (id === 'friend') handleFriendUpdate({ referenceImages: getExisting(friend).filter((_, i) => i !== index) });
    else {
      const char = additionalCharacters.find(c => c.id === id);
      handleUpdateCharacter(id, { referenceImages: getExisting(char || null).filter((_, i) => i !== index) });
    }
  };

  /** Use an image the user already has as the issue's cover. */
  const handleCoverUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast({ type: 'error', message: 'Cover art must be an image file.' });
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setStoryContext(prev => ({
      ...prev,
      preGeneratedCover: dataUrl,
      // Your cover already has whatever title treatment you gave it. Compositing
      // the app's logo and title over the top double-prints them.
      useOverlayLogo: false,
    }));
  };

  /** Drop a supplied cover so the next run generates one. */
  const handleCoverRemove = () => {
    setStoryContext(prev => ({ ...prev, preGeneratedCover: undefined, preGeneratedCoverFit: undefined }));
  };

  /** Letterbox the supplied cover, or crop it to fill the page. */
  const handleCoverFitChange = (fit: 'contain' | 'cover') => {
    setStoryContext(prev => ({ ...prev, preGeneratedCoverFit: fit }));
  };

  const handleEmblemUpload = async (id: string, file: File) => {
    try {
      const base64 = await fileToBase64(file);
      if (id === 'hero') handleHeroUpdate({ emblemImage: base64 });
      else if (id === 'friend') handleFriendUpdate({ emblemImage: base64 });
      else handleUpdateCharacter(id, { emblemImage: base64 });
    } catch (e) { console.error("Emblem upload failed"); }
  };

  const handleEmblemRemove = (id: string) => {
    if (id === 'hero') handleHeroUpdate({ emblemImage: undefined, emblemPlacement: undefined, emblemPlacementCustom: undefined });
    else if (id === 'friend') handleFriendUpdate({ emblemImage: undefined, emblemPlacement: undefined, emblemPlacementCustom: undefined });
    else handleUpdateCharacter(id, { emblemImage: undefined, emblemPlacement: undefined, emblemPlacementCustom: undefined });
  };

  const handleWeaponUpload = async (id: string, file: File) => {
    try {
      const base64 = await fileToBase64(file);
      if (id === 'hero') handleHeroUpdate({ weaponImage: base64 });
      else if (id === 'friend') handleFriendUpdate({ weaponImage: base64 });
      else handleUpdateCharacter(id, { weaponImage: base64 });
    } catch (e) { console.error("Weapon image upload failed"); }
  };

  const handleWeaponRemove = (id: string) => {
    if (id === 'hero') handleHeroUpdate({ weaponImage: undefined, weaponDescriptionText: undefined });
    else if (id === 'friend') handleFriendUpdate({ weaponImage: undefined, weaponDescriptionText: undefined });
    else handleUpdateCharacter(id, { weaponImage: undefined, weaponDescriptionText: undefined });
  };

  const handleBackstoryFileUpload = async (id: string, files: FileList) => {
    try {
      const processed = await processFiles(files);
      if (id === 'hero') handleHeroUpdate({ backstoryFiles: [...(hero?.backstoryFiles || []), ...processed] });
      else if (id === 'friend') handleFriendUpdate({ backstoryFiles: [...(friend?.backstoryFiles || []), ...processed] });
      else {
        const char = additionalCharacters.find(c => c.id === id);
        handleUpdateCharacter(id, { backstoryFiles: [...(char?.backstoryFiles || []), ...processed] });
      }
    } catch (e) { console.error("Upload failed"); }
  };

  const handleBackstoryFileRemove = (id: string, index: number) => {
    if (id === 'hero') handleHeroUpdate({ backstoryFiles: hero?.backstoryFiles?.filter((_, i) => i !== index) });
    else if (id === 'friend') handleFriendUpdate({ backstoryFiles: friend?.backstoryFiles?.filter((_, i) => i !== index) });
    else {
      const char = additionalCharacters.find(c => c.id === id);
      handleUpdateCharacter(id, { backstoryFiles: char?.backstoryFiles?.filter((_, i) => i !== index) });
    }
  };

  const handleStoryFileUpload = async (files: FileList) => {
    // Filter out non-text and non-image files
    const validFiles = Array.from(files).filter(f => f.type.startsWith('text/') || f.type.startsWith('image/') || f.name.match(/\.(txt|md)$/i));
    if (validFiles.length < files.length) console.warn("Only text files (.txt, .md) and images are supported.");
    if (validFiles.length === 0) return;
    
    try {
      // Use filtered list
      const dataTransfer = new DataTransfer();
      validFiles.forEach(f => dataTransfer.items.add(f));
      
      const processed = await processFiles(dataTransfer.files);
      handleStoryContextUpdate({ descriptionFiles: [...storyContext.descriptionFiles, ...processed] });
    } catch (e) { console.error("Upload failed"); }
  };

  const handleStoryFileRemove = (index: number) => {
    handleStoryContextUpdate({ descriptionFiles: storyContext.descriptionFiles.filter((_, i) => i !== index) });
  };

  /**
   * Serialize the full working state.
   *
   * Shared by file export and per-session snapshots so the two can never drift
   * apart — a field added here is automatically covered by both.
   */
  const buildDraftSnapshot = (kind: DraftKind = 'comic'): Record<string, unknown> => {
    const store = useCharacterStore.getState();
    return {
        // What this draft is FOR. A setup draft reopens the welcome screen so the
        // cast can be edited; a comic draft reopens the finished artwork. One
        // button producing one ambiguous file made the two indistinguishable.
        draftKind: kind,
        comicFaces,
        history: historyRef.current,
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
        characterProfiles: Array.from(store.characterProfiles.entries()),
        characterLocks: Array.from(store.characterLocks.entries()),
    };
  };

  /**
   * Apply a serialized draft to live state.
   *
   * @returns true when the draft contained rendered pages, meaning the reader
   *          should be opened rather than the setup form.
   */
  const restoreDraftSnapshot = (parsed: Record<string, any>): boolean => {
    /**
     * Settle any page that was captured mid-flight.
     *
     * A snapshot taken during generation stores faces with isLoading: true.
     * After a restore nothing is generating, so those pages would sit on
     * "Inking page..." forever with no way to progress. Pages that never
     * produced art are marked failed instead, which surfaces the existing
     * retry affordance.
     */
    const settle = (faces: ComicFace[] = []): ComicFace[] =>
      faces.map(face => ({
        ...face,
        isLoading: false,
        hasFailed: face.hasFailed ?? !face.imageUrl,
      }));

    setComicFaces(settle(parsed.comicFaces));
    historyRef.current = settle(parsed.history);
    setHero(parsed.hero || null);
    setFriend(parsed.friend || null);
    const importCharsStore = useCharacterStore.getState();
    importCharsStore.clearAdditionalCharacters();
    (parsed.additionalCharacters || []).forEach((c: Persona) => importCharsStore.addCharacter(c));
    setStoryContext(prev => ({ ...prev, ...(parsed.storyContext || {}) }));
    setExtraPages(parsed.extraPages || 0);

    if (parsed.storyOutline) setStoryOutline(parsed.storyOutline);
    if (parsed.generateFromOutline !== undefined) {
      setGenerateFromOutline(parsed.generateFromOutline);
      // Keep the ref in step: generateBatch reads it, not the state value.
      generateFromOutlineRef.current = parsed.generateFromOutline;
    }
    if (parsed.richMode !== undefined) setRichMode(parsed.richMode);
    if (parsed.selectedGenre) setSelectedGenre(parsed.selectedGenre);
    if (parsed.selectedLanguage) setSelectedLanguage(parsed.selectedLanguage);
    if (parsed.customPremise !== undefined) setCustomPremise(parsed.customPremise);

    // Sync character profiles to Zustand (clear stale data from previous session)
    const importStore = useCharacterStore.getState();
    if (parsed.characterProfiles && Array.isArray(parsed.characterProfiles)) {
      importStore.setAllProfiles(
        (parsed.characterProfiles as [string, CharacterProfile][]).map(([, p]) => p)
      );
    } else {
      // Old format draft or no profiles — clear stale profiles from previous session
      importStore.setAllProfiles([]);
    }
    // Always clear compiled references on import (rebuilt fresh from profiles)
    importStore.clearCharacterReferences();

    /**
     * Land on the setup screen with every field populated, rather than jumping
     * straight into the reader.
     *
     * Loading a draft is usually the start of more work — changing the cast,
     * adjusting the art style, regenerating a bad page — and being dropped into
     * a reader (often showing failed pages) hides the very fields the user came
     * back to edit. When the draft does contain finished pages, Setup offers an
     * explicit way in instead.
     */
    const readyPages = (parsed.comicFaces ?? []).filter((f: ComicFace) => f.imageUrl).length;

    /*
     * Where to land.
     *
     * A comic draft goes straight to the artwork — that is what the user saved
     * it for. A setup draft opens the welcome screen so the cast and settings
     * can be edited. Drafts saved before this distinction existed carry no
     * kind, so fall back to "does it actually contain finished pages", which
     * also keeps a draft full of failed pages out of the reader.
     */
    const kind: DraftKind | undefined = parsed.draftKind;
    const openReader = kind === 'comic' ? readyPages > 0
      : kind === 'setup' ? false
      : readyPages > 0;

    setIsStarted(readyPages > 0);
    setShowSetup(!openReader);
    setIsTransitioning(false);
    setCurrentSheetIndex(1);
    setResumablePageCount(openReader ? 0 : readyPages);
    return readyPages > 0;
  };

  /** Open the reader for a draft that was just restored. */
  const handleResumeComic = () => {
    setShowSetup(false);
    setIsTransitioning(false);
    setIsStarted(true);
  };

  /**
   * Reload a past session from its stored snapshot.
   *
   * Returns a human-readable reason on failure so the caller can tell the user
   * why nothing happened — a silent no-op is what made this feature look broken
   * in the first place.
   */
  const handleRestoreSession = async (sessionId: string): Promise<string | null> => {
    const result = await loadSnapshot(sessionId);
    if (!result.success || !result.data) {
      // Sessions logged before snapshots existed have metadata but no state.
      return result.error === 'no snapshot stored for this session'
        ? `Full state is only kept for the ${MAX_SESSION_SNAPSHOTS} most recent sessions. Import this one's draft file instead.`
        : (result.error || 'Could not read this session.');
    }
    try {
      restoreDraftSnapshot(result.data as Record<string, any>);
      // Continue writing to the session that was just reopened, rather than
      // forking a new one and leaving the original frozen.
      sessionIdRef.current = sessionId;
      return null;
    } catch (e) {
      console.error('[session] restore failed', e);
      return 'This session could not be restored — its saved data may be damaged.';
    }
  };

  /** Delete a session's snapshot alongside its metadata row. */
  const handleDeleteSessionSnapshot = (sessionId: string) => {
    deleteSnapshot(sessionId).catch(e => console.warn('[session] snapshot delete failed', e));
  };

  /**
   * Download the current state as a draft file.
   *
   * @param kind 'setup' reopens on the welcome screen with the cast and settings
   *   loaded; 'comic' reopens the rendered pages. The filename says which, so a
   *   folder of drafts stays readable months later.
   */
  const exportDraft = (kind: DraftKind = 'comic') => {
    const data = JSON.stringify(buildDraftSnapshot(kind));
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const stem = storyContext.title ? storyContext.title.replace(/\s+/g, '_') : 'Infinite_Heroes';
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stem}_${kind === 'setup' ? 'Setup' : 'Comic'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDraft = (file: File) => {
    console.log('[importDraft] Called with file:', file.name, file.size, 'bytes');
    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
        showToast({ type: 'error', message: 'That is not a draft file. Choose a .json saved from this app.' });
        return;
    }
    try {
      const reader = new FileReader();
      reader.onerror = () => showToast({ type: 'error', message: 'Could not read that file from disk.' });
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          if (!text || !text.trim().startsWith('{')) {
            showToast({ type: 'error', message: 'That draft file looks damaged and could not be read.' });
            return;
          }
          const parsed = JSON.parse(text);
          console.log('[importDraft] Parsed keys:', Object.keys(parsed));
          const hasPages = restoreDraftSnapshot(parsed);
          if (!hasPages) console.log("Setup fields populated successfully!");
        } catch(err) {
          console.error('Draft parse error:', err);
          showToast({ type: 'error', message: 'That draft file could not be read — it may be from a different app.' });
        }
      };
      reader.readAsText(file);
    } catch (err) {
      console.error('Draft import error:', err);
      showToast({ type: 'error', message: 'Could not open that draft file.' });
    }
  };

  const handleSheetClick = (index: number) => {
      if (!isStarted) return;
      if (index === 0 && currentSheetIndex === 0) return;
      
      const config = getComicConfig(storyContext.pageLength, extraPages);
      const maxSheetIndex = Math.ceil((config.TOTAL_PAGES + 2) / 2); // Including covers
      
      if (index < currentSheetIndex) {
          setCurrentSheetIndex(index);
      } else if (index === currentSheetIndex && currentSheetIndex < maxSheetIndex) {
          setCurrentSheetIndex(prev => prev + 1);
      }
  };

  const handleSurpriseMe = () => {
    const randomAdjectives = ["Neon", "Dark", "Savage", "Quantum", "Infinite", "Crimson", "Shadow", "Cosmic", "Neon", "Gothic"];
    const randomNouns = ["Knights", "Syndicate", "Horizon", "Phantom", "Legends", "Vanguard", "Zero", "Wanderer", "Chronicles"];
    const title = `${randomAdjectives[Math.floor(Math.random()*randomAdjectives.length)]} ${randomNouns[Math.floor(Math.random()*randomNouns.length)]}`;
    const genre = GENRES[Math.floor(Math.random()*GENRES.length)];
    const style = ART_STYLES[Math.floor(Math.random()*ART_STYLES.length)];

    setStoryContext(prev => ({
      ...prev,
      title: title,
      seriesTitle: title.toUpperCase(),
      artStyle: style,
      descriptionText: "An unpredictable, explosive action story."
    }));
    setSelectedGenre(genre);
    if(genre === 'Custom') setCustomPremise("A mysterious anomaly forces unusual heroes to team up.");
  };

  const handleAISurpriseMe = async (options: {
    useCharContext: boolean;
    selectedCharIds: string[];
    useCurrentSettings: boolean;
    extraInput: string;
  }) => {
    setIsSurprisingMe(true);
    try {
      const contextParts: string[] = [];

      if (options.useCharContext && options.selectedCharIds.length > 0) {
        const chars = [
          hero ? { id: 'hero', name: hero.name, backstory: hero.backstoryText } : null,
          friend ? { id: 'friend', name: friend.name, backstory: friend.backstoryText } : null,
          ...additionalCharacters.map(c => ({ id: c.id, name: c.name, backstory: c.backstoryText }))
        ].filter(Boolean) as any[];
        chars
          .filter((c: any) => options.selectedCharIds.includes(c.id))
          .forEach((c: any) => {
            if (c.name) contextParts.push(`Character: ${c.name}${c.backstory ? `\nBackstory: ${c.backstory}` : ''}`);
          });
      }

      if (options.extraInput.trim()) {
        contextParts.push(`User direction: ${options.extraInput.trim()}`);
      }

      const nonCustomGenres = GENRES.filter(g => g !== 'Custom');
      const genreConstraint = options.useCurrentSettings
        ? `Genre must be exactly: "${selectedGenre}"`
        : `Choose one genre from this list: ${nonCustomGenres.join(', ')}`;
      const styleConstraint = options.useCurrentSettings
        ? `Art style must be exactly: "${storyContext.artStyle}"`
        : `Choose one art style from this list: ${ART_STYLES.join(', ')}`;

      const systemPrompt = `You are a creative comic book writer. Generate a fresh, original comic story concept. Respond with ONLY valid JSON in this exact format:
{"title":"Story title (2-5 punchy words)","description":"Story description (2-3 vivid, visual sentences)","genre":"<genre from list>","artStyle":"<artStyle from list>"}`;
      const userPrompt = [
        contextParts.length > 0 ? `CONTEXT:\n${contextParts.join('\n\n')}` : '',
        genreConstraint,
        styleConstraint,
        'Create an exciting, visually compelling comic concept. Title should be memorable and punchy.'
      ].filter(Boolean).join('\n\n');

      const claude = getClaude();
      let responseText = '';

      if (claude) {
        try {
          const response = await claude.messages.create({
            model: MODEL_TEXT_NAME_CLAUDE,
            max_tokens: 512,
            system: systemPrompt,
            messages: [{ role: 'user', content: userPrompt }]
          });
          responseText = getTextFromClaudeResponse(response.content).trim();
        } catch (claudeError) {
          console.warn('Claude concept generation failed, falling back to Gemini:', claudeError);
        }
      }

      if (!responseText) {
        const ai = getAI();
        const result = await ai.models.generateContent({
          model: MODEL_TEXT_NAME,
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
        });
        responseText = result.text?.trim() || '';
      }

      let parsed: any = null;
      try { parsed = JSON.parse(extractJsonFromResponse(responseText)); } catch { /* ignored */ }
      if (parsed && parsed.title) {
        const title = String(parsed.title);
        const description = String(parsed.description || '');
        const genre = nonCustomGenres.includes(parsed.genre) ? parsed.genre : (options.useCurrentSettings ? selectedGenre : nonCustomGenres[0]);
        const artStyle = ART_STYLES.includes(parsed.artStyle) ? parsed.artStyle : (options.useCurrentSettings ? storyContext.artStyle : ART_STYLES[0]);

        setStoryContext(prev => ({
          ...prev,
          title,
          seriesTitle: title.toUpperCase(),
          artStyle,
          descriptionText: description
        }));
        setSelectedGenre(genre);
      }
    } catch (e) {
      console.error('AI Surprise Me failed:', e);
      handleSurpriseMe(); // fallback to static
    } finally {
      setIsSurprisingMe(false);
    }
  };

  // Helper: save a generated image to the global gallery
  const saveToGlobalGallery = async (
    imageUrl: string,
    type: GalleryImage['type'],
    sessionTitle: string,
    mode?: GalleryImage['mode'],
    prompt?: string
  ) => {
    try {
      await galleryAdd({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        imageUrl,
        type,
        title: sessionTitle || storyContext.title || 'Untitled',
        genre: selectedGenre !== 'Custom' ? selectedGenre : undefined,
        artStyle: storyContext.artStyle,
        mode,
        prompt,
        sessionId: sessionIdRef.current,
        createdAt: Date.now()
      });
    } catch (e) {
      console.error('Gallery save failed (non-critical):', e);
    }
  };

  // Feature D: Single image generation handler
  const handleSingleImageGenerate = async (params: SingleImageGenerateParams): Promise<string> => {
    const ai = getAI();

    const tabPrompts: Record<string, string> = {
      main: `Create a high-quality comic book ${params.genre ? `${params.genre} ` : ''}character or scene illustration in ${params.artStyle} style. ${params.description}`,
      emblem: `Create a detailed emblem/logo design for a comic book character in ${params.artStyle} style. ${params.description}. Clean isolated design on transparent/white background.`,
      weapon: `Create a detailed weapon or equipment asset for a comic book in ${params.artStyle} style. ${params.description}. Clean isolated design on white background, showing the full weapon clearly.`,
      reference: `Create a character reference sheet in ${params.artStyle} style, ${params.pose || 'front view'}.${params.whiteBackground ? ' Solid white background.' : ''} ${params.description}. Full body visible, clear lighting.`
    };

    const prompt = tabPrompts[params.tab] || params.description;

    // Collect all reference images (explicit uploads + main image as ref if requested)
    const allRefs: string[] = [];
    if (params.refImages?.length) allRefs.push(...params.refImages);
    if (params.useMainAsRef && params.mainImageUrl) {
      const mainBase64 = params.mainImageUrl.split(',')[1];
      if (mainBase64) allRefs.push(mainBase64);
    }

    if (allRefs.length > 0) {
      // Multimodal path: interleave reference images with the text prompt
      type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } };
      const contents: ContentPart[] = [];
      allRefs.forEach((base64, i) => {
        contents.push({ text: `[REFERENCE IMAGE ${i + 1} — use as visual reference]:` });
        contents.push({ inlineData: { mimeType: detectImageMimeType(base64), data: base64 } });
      });
      contents.push({ text: prompt });

      const res = await ai.models.generateContent({
        model: MODEL_IMAGE_GEN_NAME,
        contents,
        config: { imageConfig: { aspectRatio: '2:3' } }
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
      if (!part?.inlineData?.data) throw new Error('No image data returned');
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }

    // Text-only path: simpler generateImages call
    const result = await ai.models.generateImages({
      model: MODEL_IMAGE_GEN_NAME,
      prompt,
      config: { numberOfImages: 1, outputMimeType: 'image/png' }
    });

    const imgData = result.generatedImages?.[0]?.image?.imageBytes;
    if (!imgData) throw new Error('No image data returned');
    return `data:image/png;base64,${imgData}`;
  };

  const handleSingleImageSaveToGallery = (imageUrl: string, params: SingleImageGenerateParams) => {
    const typeMap: Record<string, GalleryImage['type']> = {
      main: 'main', emblem: 'emblem', weapon: 'weapon', reference: 'reference'
    };
    saveToGlobalGallery(imageUrl, typeMap[params.tab] || 'main', params.description.slice(0, 60), 'single', params.description);
  };

  const handleSingleImageImproveDescription = async (
    description: string,
    tab: SingleImageGenerateParams['tab'],
    artStyle: string,
    refImages: string[],
    subContext?: { genre?: string; pose?: string; whiteBackground?: boolean }
  ): Promise<string> => {
    const modeContext: Record<string, string> = {
      main: 'standalone character or scene illustration for a comic book',
      emblem: 'emblem, logo, or chest symbol design for a comic book character (clean isolated design)',
      weapon: 'weapon or equipment asset for a comic book character (clean isolated design on white background)',
      reference: 'full-body character reference sheet showing the character clearly for art reference purposes',
    };

    const hasImages = refImages.length > 0;
    const hasText = description.trim().length > 0;

    const systemPrompt = `You are a creative assistant specializing in comic book art direction.
Your job is to write concise, vivid image generation prompts for a ${modeContext[tab]}.
${hasImages ? 'You will be given reference images — analyze them and incorporate what you see (colors, style, design elements, character features) into your description.' : ''}
Write a description that works as a direct prompt for an AI image generator.
Return ONLY the improved description text. No explanations, no markdown, no quotes.`;

    const userLines: string[] = [];
    userLines.push(`Art style: ${artStyle}`);
    userLines.push(`Mode: ${tab} (${modeContext[tab]})`);
    // Inject sub-context details specific to each mode
    if (subContext?.genre) {
      userLines.push(`Genre / tone: ${subContext.genre} — the image should feel like it belongs in a ${subContext.genre} comic.`);
    }
    if (subContext?.pose) {
      userLines.push(`Required pose: ${subContext.pose} — the description must specify this exact camera angle/pose for the reference sheet.`);
    }
    if (subContext?.whiteBackground !== undefined) {
      userLines.push(`Background: ${subContext.whiteBackground ? 'solid white background — emphasize clean isolated figure on white' : 'stylized background appropriate for the scene'}.`);
    }
    if (hasText) {
      userLines.push(`\nExisting description to expand/improve:\n${description.trim()}`);
    } else {
      userLines.push(`\nNo description provided yet${hasImages ? ' — generate one based on the reference image(s)' : ' — generate a compelling description for this mode'}.`);
    }
    userLines.push(`\nWrite a detailed, specific prompt optimized for AI image generation. Be concise but vivid.`);
    const userPrompt = userLines.join('\n');

    const claude = getClaude();
    let responseText = '';

    try {
      if (claude) {
        try {
          if (hasImages) {
            // Claude with vision — analyze ref images
            const imageBlocks = refImages.map(base64 => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: detectImageMimeType(base64) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              }
            }));
            const response = await claude.messages.create({
              model: MODEL_TEXT_NAME_CLAUDE,
              max_tokens: 512,
              system: systemPrompt,
              messages: [{ role: 'user', content: [...imageBlocks, { type: 'text' as const, text: userPrompt }] }]
            });
            responseText = getTextFromClaudeResponse(response.content).trim();
          } else {
            // Claude text-only
            const response = await claude.messages.create({
              model: MODEL_TEXT_NAME_CLAUDE,
              max_tokens: 512,
              system: systemPrompt,
              messages: [{ role: 'user', content: userPrompt }]
            });
            responseText = getTextFromClaudeResponse(response.content).trim();
          }
        } catch (claudeError) {
          console.warn('Claude single image expand failed, falling back to Gemini:', claudeError);
          handleAnthropicError(claudeError);
        }
      }

      if (!responseText) {
        // Gemini fallback — multimodal if images present
        const ai = getAI();
        if (hasImages) {
          type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
          const parts: Part[] = refImages.map(base64 => ({
            inlineData: { mimeType: detectImageMimeType(base64), data: base64 }
          }));
          parts.push({ text: `${systemPrompt}\n\n${userPrompt}` });
          const res = await ai.models.generateContent({
            model: MODEL_TEXT_NAME,
            contents: [{ role: 'user', parts }]
          });
          responseText = res.text?.trim() || description;
        } else {
          const res = await ai.models.generateContent({
            model: MODEL_TEXT_NAME,
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }]
          });
          responseText = res.text?.trim() || description;
        }
      }
      return responseText;
    } catch (e) {
      console.error('Single image AI expand failed:', e);
      throw new Error('AI expand failed. Please try again.');
    }
  };

  // Pan/Zoom State
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const startPos = useRef({ x: 0, y: 0 });
  const scrollPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      setIsDragging(true);
      startPos.current = { x: e.pageX, y: e.pageY };
      scrollPos.current = { x: containerRef.current!.scrollLeft, y: containerRef.current!.scrollTop };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (!isDragging || zoom <= 1) return;
      e.preventDefault();
      const dx = e.pageX - startPos.current.x;
      const dy = e.pageY - startPos.current.y;
      containerRef.current!.scrollLeft = scrollPos.current.x - dx;
      containerRef.current!.scrollTop = scrollPos.current.y - dy;
  };

  const handleMouseUp = () => setIsDragging(false);

  // Determine API key status for alert banner
  const hasGeminiKey = !!(isAdmin && process.env.API_KEY) || !!userApiKey;
  const hasClaudeKey = !!(isAdmin && process.env.ANTHROPIC_API_KEY) || !!userAnthropicKey;

  // Show alert if missing keys and not dismissed
  const showKeyAlert = !dismissedKeyAlert && (!hasGeminiKey || !hasClaudeKey);

  return (
    // Suspense boundary for the lazily-loaded modals below. Without it React
    // throws the moment one of them first suspends.
    <React.Suspense fallback={<ModalFallback />}>
    <div className="comic-scene">
      {showApiKeyDialog && <ApiKeyDialog onContinue={handleApiKeyDialogContinue} />}

      {/* API Key Alert Banner */}
      {showKeyAlert && (
        <div className={`fixed top-0 left-0 right-0 z-[400] ${!hasGeminiKey ? 'bg-red-600' : 'bg-amber-500'} border-b-4 border-black shadow-lg`}>
          <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white">
              <span className="text-2xl">{!hasGeminiKey ? '🔑' : '💡'}</span>
              <div className="font-comic text-sm sm:text-base">
                {!hasGeminiKey ? (
                  <span><strong>API Key Required!</strong> Add your Gemini key to generate comics.</span>
                ) : !hasClaudeKey ? (
                  <span><strong>Tip:</strong> Add Claude key for better text analysis (optional - Gemini will work for everything)</span>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(true)}
                className="comic-btn bg-white text-black px-4 py-1.5 text-sm font-bold border-2 border-black hover:bg-gray-100 whitespace-nowrap"
              >
                ⚙️ Open Settings
              </button>
              {hasGeminiKey && !hasClaudeKey && (
                <button
                  onClick={() => setDismissedKeyAlert(true)}
                  className="comic-btn bg-amber-700 text-white px-3 py-1.5 text-sm font-bold border-2 border-black hover:bg-amber-600 whitespace-nowrap"
                >
                  Use Gemini Only
                </button>
              )}
              {!hasGeminiKey && (
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="comic-btn bg-blue-500 text-white px-3 py-1.5 text-sm font-bold border-2 border-black hover:bg-blue-400 whitespace-nowrap"
                >
                  Get Free Key →
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Storage Warning Banner */}
      {storageWarning && !dismissedStorageWarning && (
        <div className={`fixed ${showKeyAlert ? 'top-16' : 'top-0'} left-0 right-0 z-[399] ${storageWarning.imagesStripped ? 'bg-orange-600' : 'bg-yellow-500'} border-b-4 border-black shadow-lg`}>
          <div className="max-w-4xl mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-white">
              <span className="text-2xl">{storageWarning.imagesStripped ? '!' : '!'}</span>
              <div className="font-comic text-sm sm:text-base">
                {storageWarning.imagesStripped ? (
                  <span><strong>Storage Limit Reached!</strong> Character images were removed to save your data. Export a draft to preserve everything.</span>
                ) : (
                  <span><strong>Storage Warning:</strong> Using {storageWarning.percentUsed}% of storage ({(storageWarning.currentBytes / 1024 / 1024).toFixed(1)}MB). Consider exporting a draft soon.</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportDraft('comic')}
                className="comic-btn bg-white text-black px-4 py-1.5 text-sm font-bold border-2 border-black hover:bg-gray-100 whitespace-nowrap"
              >
                Export Draft
              </button>
              <button
                onClick={() => setDismissedStorageWarning(true)}
                className={`comic-btn ${storageWarning.imagesStripped ? 'bg-orange-800' : 'bg-yellow-700'} text-white px-3 py-1.5 text-sm font-bold border-2 border-black hover:opacity-90 whitespace-nowrap`}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global Gallery Button — floating, always accessible */}
      <button
          onClick={() => setShowGlobalGallery(true)}
          className={`fixed z-[249] items-center justify-center border-[3px] border-black rounded-full bg-white/90 hover:bg-white shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer touch-manipulation
              ${showSetup ? 'hidden md:flex w-12 h-12 bottom-20 left-20' : 'flex w-10 h-10 top-3 right-14 md:w-12 md:h-12 md:top-auto md:right-auto md:bottom-20 md:left-20'}`}
          title="Global Image Gallery"
          aria-label="Open global gallery"
      >
          <span className={showSetup ? 'text-2xl' : 'text-xl md:text-2xl'}>🖼️</span>
      </button>

      {/* Settings Gear — always visible on desktop; hidden on mobile only when setup screen is showing
          (mobile/tablet setup screen has its own in-card gear via Setup.tsx) */}
      <button
          onClick={() => setShowSettings(true)}
          className={`fixed z-[250] items-center justify-center border-[3px] border-black rounded-full bg-white/90 hover:bg-white shadow-[3px_3px_0px_rgba(0,0,0,1)] hover:shadow-[5px_5px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5 transition-all cursor-pointer touch-manipulation
              ${showSetup ? 'hidden md:flex w-12 h-12 bottom-20 left-6' : 'flex w-10 h-10 top-3 right-3 md:w-12 md:h-12 md:top-auto md:right-auto md:bottom-20 md:left-6'}`}
          title="Settings"
          aria-label="Open settings"
      >
          <span className={showSetup ? 'text-2xl' : 'text-xl md:text-2xl'}>⚙️</span>
      </button>

      {/* Settings Dialog */}
      {showSettings && (
          <SettingsDialog
              serverKeyExists={!!process.env.API_KEY}
              anthropicServerKeyExists={!!process.env.ANTHROPIC_API_KEY}
              adminPasswordHash={process.env.ADMIN_PASSWORD || ''}
              onClose={() => setShowSettings(false)}
              onKeyChange={handleSettingsKeyChange}
              onOpenHelp={() => setShowHelpModal(true)}
              onOpenFullGuide={() => setShowFullTutorial(true)}
          />
      )}

      {/* Help modals (triggered from Settings) */}
      <TutorialModal
          show={showHelpModal}
          onClose={() => setShowHelpModal(false)}
          onOpenFullGuide={() => { setShowHelpModal(false); setShowFullTutorial(true); }}
      />
      <TutorialPage
          show={showFullTutorial}
          onBack={() => setShowFullTutorial(false)}
      />

      {/* Global Image Gallery */}
      {showGlobalGallery && (
          <GlobalGalleryModal onClose={() => setShowGlobalGallery(false)} />
      )}

      {/* Single Image Mode */}
      {showSingleImageMode && (
          <SingleImageMode
              onClose={() => setShowSingleImageMode(false)}
              onGenerate={handleSingleImageGenerate}
              onSaveToGallery={handleSingleImageSaveToGallery}
              onImproveDescription={handleSingleImageImproveDescription}
          />
      )}
      
      <Setup 
          show={showSetup}
          isTransitioning={isTransitioning}
          isGeneratingProfiles={isGeneratingProfiles}
          hero={hero}
          friend={friend}
          additionalCharacters={additionalCharacters}
          storyContext={storyContext}
          selectedGenre={selectedGenre}
          selectedLanguage={selectedLanguage}
          customPremise={customPremise}
          richMode={richMode}
          onHeroUpdate={handleHeroUpdate}
          onResetHero={() => setHero(null)}
          onFriendUpdate={handleFriendUpdate}
          onResetFriend={() => setFriend(null)}
          onAddCharacter={handleAddCharacter}
          onUpdateCharacter={handleUpdateCharacter}
          onDeleteCharacter={handleDeleteCharacter}
          onStoryContextUpdate={handleStoryContextUpdate}
          onPortraitUpload={handlePortraitUpload}
          onRefUpload={handleRefUpload}
          onRefRemove={handleRefRemove}
          onEmblemUpload={handleEmblemUpload}
          onEmblemRemove={handleEmblemRemove}
          onWeaponUpload={handleWeaponUpload}
          onWeaponRemove={handleWeaponRemove}
          onBackstoryFileUpload={handleBackstoryFileUpload}
          onBackstoryFileRemove={handleBackstoryFileRemove}
          onStoryFileUpload={handleStoryFileUpload}
          onStoryFileRemove={handleStoryFileRemove}
          onGenreChange={setSelectedGenre}
          onLanguageChange={setSelectedLanguage}
          onPremiseChange={setCustomPremise}
          onRichModeChange={setRichMode}
          onLaunch={handleStartAdventure}
          onSurpriseMe={handleSurpriseMe}
          onAISurpriseMe={handleAISurpriseMe}
          isSurprisingMe={isSurprisingMe}
          onOpenSingleImageMode={() => setShowSingleImageMode(true)}
          onExportDraft={() => exportDraft('setup')}
          onImportDraft={importDraft}
          onClearSetup={handleClearSetup}
          onImproveText={improveTextWithAI}
          skipProfileAnalysis={skipProfileAnalysis}
          onSkipProfileAnalysisChange={setSkipProfileAnalysis}
          modelSheetProps={modelSheetProps}
          onOpenCharacterLibrary={() => setShowCharacterLibrary(true)}
          onCoverUpload={handleCoverUpload}
          onCoverRemove={handleCoverRemove}
          onCoverFitChange={handleCoverFitChange}
          isCastLoading={isCastLoading}
          resumablePageCount={resumablePageCount}
          onResumeComic={handleResumeComic}
          onRestoreSession={handleRestoreSession}
          onDeleteSessionSnapshot={handleDeleteSessionSnapshot}
          useSavedProfiles={useSavedProfiles}
          onUseSavedProfilesChange={setUseSavedProfiles}
          hasStaleSavedProfiles={hasStaleSavedProfiles}
          onPresetSelect={handlePresetSelect}
          onSettingsOpen={() => setShowSettings(true)}
      />

      {/* Mode Selection Screen */}
      <ModeSelectionScreen
          show={showModeSelection}
          onSelect={handleModeSelect}
          onBack={handleModeSelectionBack}
      />

      {/* Outline Step Dialog */}
      <OutlineStepDialog 
          show={showOutlineStep}
          storyOutline={storyOutline}
          outlineNotes={outlineNotes}
          onOutlineUpdate={(val) => setStoryOutline(prev => ({ ...prev, content: val }))}
          onOutlineNotesChange={setOutlineNotes}
          onGenerateOutline={generateOutline}
          onOutlineUpload={handleOutlineUpload}
          onProceedWithOutline={() => {
              setShowOutlineStep(false);
              proceedToComicGeneration();
          }}
          onCancelOutline={() => {
              setShowOutlineStep(false);
              setIsTransitioning(false);
          }}
      />
      
      {/* Profiles Review Dialog */}
      {showProfilesStep && (
          <ProfilesDialog 
              profiles={tempProfiles}
              onUpdate={(index, updated) => {
                  setTempProfiles(prev => prev.map((p, i) => i === index ? updated : p));
              }}
              onAnalyze={handleAnalyzeProfile}
              modelSheetProps={modelSheetProps}
              onConfirm={continueAfterProfiles}
              onCancel={() => {
                  setShowProfilesStep(false);
                  setIsTransitioning(false); // Back to setup
              }}
          />
      )}

      {/* Reroll Modal */}
      {rerollTarget !== null && (
          <RerollModal
              pageIndex={rerollTarget}
              outline={storyOutline.content}
              allRefImages={getRerollGallery()}
              availableProfiles={getProfilesArray().map(p => ({ id: p.id, name: p.name }))}
              fullProfiles={getProfilesArray()}
              originalPrompt={comicFaces.find(f => f.pageIndex === rerollTarget)?.originalPrompt}
              prevPageImageUrl={comicFaces.find(f => f.pageIndex === rerollTarget - 1)?.imageUrl}
              nextPageImageUrl={comicFaces.find(f => f.pageIndex === rerollTarget + 1)?.imageUrl}
              currentPageImageUrl={comicFaces.find(f => f.pageIndex === rerollTarget)?.imageUrl}
              initialSelectedProfileIds={rerollProfileSelection}
              onProfileSelectionChange={setRerollProfileSelection}
              onSubmit={handleRerollSubmit}
              onClose={() => setRerollTarget(null)}
              onUploadRef={handleRerollUploadRef}
              onDeleteRef={handleRerollDeleteRef}
              onProfileUpdate={(profileId, updates) => {
                  // Update profile in Zustand store
                  useCharacterStore.getState().updateCharacterProfile(profileId, updates);
              }}
              onAnalyzeProfile={async (profileId) => {
                  // Find corresponding persona and regenerate profile
                  const allPersonas = [getHero(), getFriend(), ...getAdditionalChars()].filter(Boolean) as Persona[];
                  const persona = allPersonas.find(p => p.id === profileId);
                  if (persona) {
                      const newProfile = await generateCharacterProfile(persona, true);
                      // Update profile in Zustand store
                      useCharacterStore.getState().setCharacterProfile(profileId, newProfile);
                  }
              }}
              onImproveText={improveTextWithAI}
          />
      )}

      {/* Page Navigation & Zoom Controls */}
      {isStarted && !showSetup && (
          <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-auto items-end">
              {showPageNav && (
                  <div className="flex bg-white border-[3px] border-black p-2 shadow-[4px_4px_0px_rgba(0,0,0,1)] rounded divide-x-[3px] divide-black items-center">
                      <div className="flex items-center gap-2 px-3">
                          <button 
                              onClick={() => setCurrentSheetIndex(Math.max(0, currentSheetIndex - 1))}
                              disabled={currentSheetIndex === 0}
                              className="comic-btn w-8 h-8 rounded-full bg-yellow-400 hover:bg-yellow-300 border-[2px] border-black flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all"
                          >
                              <span className="font-bold text-sm">◀</span>
                          </button>
                      
                          <span className="font-comic font-bold text-sm hidden sm:inline ml-1">PAGE</span>
                          <input 
                              type="text"
                              value={pageNavInput}
                              onChange={(e) => setPageNavInput(e.target.value)}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                      let pageNum = parseInt(pageNavInput);
                                      if (isNaN(pageNum) || pageNavInput.toLowerCase() === 'cover') pageNum = 0;
                                      
                                      const config = getComicConfig(storyContext.pageLength, extraPages);
                                      if (pageNum >= 0 && pageNum <= config.TOTAL_PAGES + 1) {
                                          const targetSheet = pageNum === 0 ? 0 : Math.ceil(pageNum / 2);
                                          setCurrentSheetIndex(targetSheet);
                                      }
                                  }
                              }}
                              className="w-16 h-8 text-center border-2 border-black font-bold focus:outline-none"
                          />
                          <span className="font-comic font-bold text-gray-500 text-sm hidden sm:inline">/ {getComicConfig(storyContext.pageLength, extraPages).TOTAL_PAGES}</span>
                          <button 
                              onClick={() => {
                                  let pageNum = parseInt(pageNavInput);
                                  if (isNaN(pageNum) || pageNavInput.toLowerCase() === 'cover') pageNum = 0;
                                  
                                  const config = getComicConfig(storyContext.pageLength, extraPages);
                                  if (pageNum >= 0 && pageNum <= config.TOTAL_PAGES + 1) {
                                      const targetSheet = pageNum === 0 ? 0 : Math.ceil(pageNum / 2);
                                      setCurrentSheetIndex(targetSheet);
                                  }
                              }}
                              className="comic-btn ml-1 bg-blue-600 text-white text-xs font-bold px-2 py-1 border-[2px] border-black hover:bg-blue-500"
                          >
                              GO
                          </button>

                          <button 
                              onClick={() => {
                                  const maxSheet = Math.ceil((getComicConfig(storyContext.pageLength, extraPages).TOTAL_PAGES + 1) / 2);
                                  setCurrentSheetIndex(Math.min(maxSheet, currentSheetIndex + 1));
                              }}
                              disabled={currentSheetIndex >= Math.ceil((getComicConfig(storyContext.pageLength, extraPages).TOTAL_PAGES + 1) / 2)}
                              className="comic-btn w-8 h-8 rounded-full bg-yellow-400 hover:bg-yellow-300 border-[2px] border-black flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shadow-[2px_2px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all ml-2"
                          >
                              <span className="font-bold text-sm">▶</span>
                          </button>
                      </div>
                      <div className="flex gap-1 pl-3">
                          <button onClick={zoomOut} className="comic-btn w-8 h-8 bg-gray-200 hover:bg-gray-300 font-bold text-lg flex items-center justify-center border-[2px] border-black" aria-label="Zoom out" title="Zoom out">-</button>
                          <button onClick={resetZoom} className="comic-btn px-2 h-8 bg-gray-200 hover:bg-gray-300 font-bold flex items-center justify-center border-[2px] border-black text-xs" aria-label={`Reset zoom (currently ${Math.round(zoom * 100)}%)`} title="Reset zoom">{Math.round(zoom * 100)}%</button>
                          <button onClick={zoomIn} className="comic-btn w-8 h-8 bg-gray-200 hover:bg-gray-300 font-bold text-lg flex items-center justify-center border-[2px] border-black" aria-label="Zoom in" title="Zoom in">+</button>
                      </div>
                  </div>
              )}
              {/* Spread/single toggle. Lives here rather than pinned to the book,
                  which is centred and transformed and pushed it under the nav. */}
              {viewToggle?.canToggle && (
                  <button
                      onClick={viewToggle.toggle}
                      className="comic-btn text-xs bg-white text-black px-3 py-1 font-comic tracking-widest border-[2px] border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:bg-gray-100 self-end"
                      title={`Switch to ${viewToggle.mode === 'spread' ? 'single-page' : 'two-page'} view (V)`}
                  >
                      {viewToggle.mode === 'spread' ? 'SINGLE PAGE' : 'TWO PAGES'}
                  </button>
              )}

              {/* Fix lettering by hand rather than rerolling the whole page. */}
              <button
                  onClick={() => openLetteringEditor('bubbles')}
                  className="comic-btn text-xs bg-white text-black px-3 py-1 font-comic tracking-widest border-[2px] border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:bg-gray-100 self-end"
                  title="Add or fix speech bubbles on this page"
              >
                  BUBBLES
              </button>
              <button
                  onClick={() => openLetteringEditor('sfx')}
                  className="comic-btn text-xs bg-white text-black px-3 py-1 font-comic tracking-widest border-[2px] border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:bg-gray-100 self-end"
                  title="Add sound effects to this page"
              >
                  SFX
              </button>

              {/* Reading mode — text alternative for the artwork, and a handy proofing view. */}
              <button
                  onClick={() => setShowScriptReader(true)}
                  className="comic-btn text-xs bg-white text-black px-3 py-1 font-comic tracking-widest border-[2px] border-black shadow-[2px_2px_0_rgba(0,0,0,1)] hover:bg-gray-100 self-end"
                  title="Read the comic as text"
              >
                  READ AS TEXT
              </button>

              {/* Toggle Page Nav Button */}
              <button 
                  onClick={() => setShowPageNav(!showPageNav)} 
                  className="comic-btn text-xs bg-black text-white px-3 py-1 font-comic tracking-widest border-[2px] border-white shadow-[2px_2px_0_rgba(0,0,0,1)] hover:bg-gray-800 self-end"
              >
                  {showPageNav ? 'HIDE NAV' : 'SHOW NAV'}
              </button>
          </div>
      )}

      {/* Main Container */}
      <div 
          ref={containerRef}
          className={`absolute inset-0 z-0 overflow-auto flex items-center justify-center ${showSetup && !isTransitioning ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
          style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
      >
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'center center', transition: zoom === 1 ? 'transform 0.2s ease-out' : 'none', minWidth: 'max-content', minHeight: 'max-content', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Book 
          onProgressChange={setReaderProgress}
          onViewModeAvailable={setViewToggle}
          comicFaces={comicFaces}
          currentSheetIndex={currentSheetIndex}
          isStarted={isStarted}
          isSetupVisible={showSetup && !isTransitioning}
          storyContext={storyContext}
          extraPages={extraPages}
          generateFromOutline={generateFromOutline}
          onSheetClick={handleSheetClick}
          onChoice={handleChoice}
          onReroll={handleReroll}
          onQuickRetry={handleQuickRetry}
          onAddPage={handleAddPage}
          onStop={handleStop}
          onStopHere={handleStopHere}
          onOpenBook={() => setCurrentSheetIndex(1)}
          onDownload={() => setShowExportDialog(true)}
                  onReset={resetApp}
              />
          </div>
      </div>

      {/* Top Left Mode Badge */}
      {isStarted && !showSetup && (
        <div className="fixed top-4 left-4 z-[100] flex flex-col gap-2 items-start pointer-events-none">
            <div className="bg-black/90 px-5 py-2 border-[3px] border-white shadow-[4px_4px_0_rgba(0,0,0,1)] flex items-center gap-2 rounded-sm transform -rotate-1">
                <span className="text-yellow-400 font-comic text-xl tracking-wider uppercase font-bold">
                   {generateFromOutline ? "📖 OUTLINE MODE" : "🎲 NOVEL MODE"}
                </span>
            </div>

            {/*
              What the app is doing right now. Stacked under the mode badge on the
              left, where the top navigation cannot cover it. White on near-black
              rather than the old purple-on-dark, which was unreadable even when
              it was not hidden.
            */}
            {readerProgress?.isGenerating && (
                <div
                    role="status"
                    aria-live="polite"
                    className="bg-purple-700 border-[3px] border-white shadow-[4px_4px_0_rgba(0,0,0,1)] px-3 py-1.5 flex items-center gap-2 rounded-sm"
                >
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                    <span className="font-comic text-white text-sm uppercase tracking-wide">
                        Drawing page {Math.min(readerProgress.done + 1, readerProgress.total)} of {readerProgress.total}
                    </span>
                </div>
            )}
        </div>
      )}

      {confirmDialog}

      {letteringTarget && (() => {
          const face = comicFaces.find(fc => fc.id === letteringTarget.faceId);
          if (!face?.imageUrl) return null;
          return letteringTarget.tool === 'bubbles' ? (
              <BubbleEditor
                  panelImage={face.imageUrl}
                  pages={letterablePages}
                  currentPageId={face.id}
                  onPageChange={(id) => setLetteringTarget({ faceId: id, tool: 'bubbles' })}
                  initialBubbles={face.bubbles}
                  characters={[getHero(), getFriend(), ...getAdditionalChars()]
                      .filter(Boolean)
                      .map(p => ({ id: p!.id, name: p!.name || 'Character' }))}
                  onBubblesChange={(bubbles) => handleBubblesChange(face.id, bubbles)}
                  onClose={() => setLetteringTarget(null)}
              />
          ) : (
              <SFXEditor
                  panelImage={face.imageUrl}
                  pages={letterablePages}
                  currentPageId={face.id}
                  onPageChange={(id) => setLetteringTarget({ faceId: id, tool: 'sfx' })}
                  initialSFX={face.sfx}
                  onSFXChange={(sfx) => handleSFXChange(face.id, sfx)}
                  onClose={() => setLetteringTarget(null)}
              />
          );
      })()}

      {showCharacterLibrary && (
          <CharacterLibraryModal
              onClose={() => setShowCharacterLibrary(false)}
              onSelectCharacter={handleLibrarySelect}
          />
      )}

      {showScriptReader && (
        <ScriptReader
          faces={comicFaces}
          cast={{ hero: getHero(), friend: getFriend(), others: getAdditionalChars() }}
          title={storyContext.title}
          onClose={() => setShowScriptReader(false)}
        />
      )}

      {pendingPlan && (
        <GenerationConfirmDialog
          plan={pendingPlan}
          onConfirm={handleConfirmGeneration}
          onCancel={handleCancelGeneration}
        />
      )}

      {/*
        Screen-reader announcements for generation.
        Generation runs for minutes with no visual change a screen reader can
        report; without a live region the app simply goes silent.
      */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {generationAnnouncement(generationProgress, isStarted && !showSetup)}
      </div>

      {/* Phase 4.2 — Outline Mode Generation Progress Bar */}
      {generationProgress && isStarted && !showSetup && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] bg-white border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] px-4 py-3 min-w-[280px] max-w-[400px] w-full sm:w-auto">
          <p className="font-comic text-xs font-bold uppercase text-center mb-2 text-gray-700" aria-hidden="true">
            📄 Generating page {generationProgress.current} of {generationProgress.total}…
          </p>
          <div
            className="w-full bg-gray-200 rounded-full h-2.5 border border-gray-300"
            role="progressbar"
            aria-valuenow={generationProgress.current}
            aria-valuemin={0}
            aria-valuemax={generationProgress.total}
            aria-label={`Generating page ${generationProgress.current} of ${generationProgress.total}`}
          >
            <div
              className="bg-yellow-400 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.round((generationProgress.current / generationProgress.total) * 100))}%` }}
            />
          </div>
        </div>
      )}

      {/* Top Right Navigation */}
      {isStarted && !showSetup && (
        <div className="fixed top-4 right-4 z-[100] flex gap-2">
            <button onClick={handleGoHome} className="comic-btn bg-gray-200 text-black font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:bg-gray-300 hover:scale-105 transition-all outline-none text-sm tracking-widest font-bold">
                🏠 HOME
            </button>
            {storyOutline.content && (
                <button onClick={() => setShowOutlineDialog(true)} className="comic-btn bg-purple-600 text-white font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:scale-105 transition-all outline-none text-sm tracking-widest font-bold">
                    📖 OUTLINE
                </button>
            )}
            
            {/* Global Reroll Dropdown */}
            <div className="relative">
                <button onClick={() => setShowGlobalReroll(!showGlobalReroll)} className="comic-btn bg-orange-500 text-white font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:scale-105 transition-all outline-none text-sm tracking-widest font-bold">
                    🎲 REROLL PAGE
                </button>
                {showGlobalReroll && (
                    <div className="absolute top-14 right-0 bg-white border-[3px] border-black p-3 shadow-[4px_4px_0_rgba(0,0,0,1)] z-[200] flex flex-col gap-2 min-w-[200px]">
                        <h3 className="font-comic font-bold text-center border-b-2 border-black pb-1 mb-1 whitespace-nowrap">Reroll Specific Page</h3>
                        <div className="flex items-center justify-center gap-1">
                            <button onClick={() => setGlobalRerollPageInput(String(Math.max(1, parseInt(globalRerollPageInput || '1') - 1)))} className="comic-btn w-8 h-8 bg-yellow-400 font-bold text-lg border-2 border-black flex items-center justify-center">-</button>
                            <input 
                                type="number" 
                                value={globalRerollPageInput} 
                                onChange={e => setGlobalRerollPageInput(e.target.value)}
                                className="w-14 h-8 text-center font-bold text-lg border-2 border-black focus:outline-none"
                            />
                            <button onClick={() => setGlobalRerollPageInput(String(Math.min(getComicConfig(storyContext.pageLength, extraPages).TOTAL_PAGES, parseInt(globalRerollPageInput || '1') + 1)))} className="comic-btn w-8 h-8 bg-yellow-400 font-bold text-lg border-2 border-black flex items-center justify-center">+</button>
                        </div>
                        <button 
                            onClick={() => {
                                const pageNum = parseInt(globalRerollPageInput);
                                const maxPage = getComicConfig(storyContext.pageLength, extraPages).TOTAL_PAGES;
                                if (pageNum >= 1 && pageNum <= maxPage) {
                                    handleReroll(pageNum);
                                    setShowGlobalReroll(false);
                                }
                            }}
                            className="comic-btn w-full bg-red-600 text-white py-1.5 font-bold tracking-widest border-2 border-black hover:bg-red-500 mt-1"
                        >
                            GO
                        </button>
                    </div>
                )}
            </div>

            <button onClick={() => setShowGallery(true)} className="comic-btn bg-yellow-400 text-black font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:scale-105 transition-all outline-none text-sm tracking-widest font-bold">
                🖼️ GALLERY
            </button>
            <button onClick={() => exportDraft('comic')} title="Download this comic. Reopening it goes straight to the pages." className="comic-btn bg-blue-600 text-white font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:scale-105 transition-all outline-none text-sm tracking-widest font-bold">
                SAVE COMIC
            </button>
            <button 
                onClick={() => setShowExportDialog(true)}
                className="comic-btn bg-red-600 text-white font-comic px-4 py-2 border-[3px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:scale-105 transition-all uppercase font-bold tracking-widest text-sm"
            >
                Export Comic
            </button>
        </div>
      )}

      {showExportDialog && (
        <ExportDialog 
          onClose={() => setShowExportDialog(false)} 
          onExport={handleExport} 
        />
      )}

      {showOutlineDialog && (
        <OutlineDialog
          outline={storyOutline.content}
          title={storyContext.title || 'Comic Outline'}
          onClose={() => setShowOutlineDialog(false)}
        />
      )}

      {showGallery && (
        <GalleryModal
              onNotify={showToast}
          faces={comicFaces}
          title={storyContext.title || 'Comic'}
          onClose={() => setShowGallery(false)}
          onReplaceImage={(faceId, newImageUrl) => {
            console.log('[GalleryReplace] Replacing image for face:', faceId, 'new URL length:', newImageUrl.length);

            // Update both state and historyRef to ensure persistence
            setComicFaces(prev => {
              const foundFace = prev.find(f => f.id === faceId);
              console.log('[GalleryReplace] Found face in state:', !!foundFace, 'pageIndex:', foundFace?.pageIndex, 'type:', foundFace?.type);
              const updated = prev.map(face =>
                face.id === faceId
                  ? { ...face, imageUrl: newImageUrl }
                  : face
              );
              return updated;
            });

            // Also update historyRef so exports and other operations use the new image
            const idx = historyRef.current.findIndex(f => f.id === faceId);
            if (idx !== -1) {
              historyRef.current[idx] = { ...historyRef.current[idx], imageUrl: newImageUrl };
              console.log('[GalleryReplace] historyRef updated at index:', idx);
            } else {
              console.warn('[GalleryReplace] Face not found in historyRef:', faceId);
            }
          }}
          onGenerateCoverVariants={() => generateCoverVariants(3)}
          onBatchRegenerate={async (faceIds) => {
            console.log('[BatchRegenerate] Starting batch regeneration for:', faceIds);
            setShowGallery(false);

            // Process each face sequentially to avoid API overload
            for (const faceId of faceIds) {
              const face = comicFaces.find(f => f.id === faceId);
              if (!face) {
                console.warn('[BatchRegenerate] Face not found:', faceId);
                continue;
              }

              // Mark as loading
              updateFaceState(faceId, { isLoading: true, hasFailed: false });

              try {
                const isNovelMode = !generateFromOutline;
                const config = getComicConfig(storyContext.pageLength, extraPages, isNovelMode);
                const type: ComicFace['type'] = face.pageIndex === 0 ? 'cover' : (face.pageIndex === config.BACK_COVER_PAGE ? 'back_cover' : 'story');

                await generateSinglePage({ faceId, pageNum: face.pageIndex ?? 0, type });
                console.log('[BatchRegenerate] Completed:', faceId);
              } catch (e) {
                console.error('[BatchRegenerate] Failed:', faceId, e);
                updateFaceState(faceId, { isLoading: false, hasFailed: true });
              }
            }

            console.log('[BatchRegenerate] Batch complete');
          }}
        />
      )}

      {showCoverSelector && (
        <CoverVariantSelector
          variants={coverVariants}
          selectedIndex={selectedCoverIndex}
          isGenerating={isGeneratingVariants}
          onSelect={selectCoverVariant}
          onClose={() => setShowCoverSelector(false)}
          onGenerateMore={() => generateCoverVariants(3)}
        />
      )}

      <DriftWarningToast onReroll={(pageIndex) => handleReroll(pageIndex)} />
    </div>
    </React.Suspense>
  );
};

export default App;
