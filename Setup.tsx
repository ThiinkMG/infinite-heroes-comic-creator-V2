/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Persona, StoryContext, ART_STYLES, GENRES } from './types';
import { ModelSheetStrip, type ModelSheetState } from './components/ModelSheetStrip';
import { ComicPreset } from './data/comicPresets';
import {
    Tooltip,
    CharacterCard,
    StorySettingsSection,
    CoverConfigSection,
    PresetSelector,
    CustomPreset,
    ActionButtons,
    TutorialModal,
    SavePresetModal,
    Footer,
    CostEstimator
} from './components';
import { HelpTooltip } from './components/HelpTooltip';
import { TutorialPage } from './components/TutorialPage';
import { UndoRedoButtons } from './components/UndoRedoButtons';
import { useUndoHistory } from './hooks/useUndoHistory';
import { useSessionHistoryStore, SessionEntry } from './stores/useSessionHistoryStore';

/**
 * Props for the Setup component.
 */
interface SetupProps {
    show: boolean;
    isTransitioning: boolean;
    isGeneratingProfiles: boolean;
    hero: Persona | null;
    friend: Persona | null;
    additionalCharacters: Persona[];
    storyContext: StoryContext;
    selectedGenre: string;
    selectedLanguage: string;
    customPremise: string;
    richMode: boolean;
    onHeroUpdate: (updates: Partial<Persona>) => void;
    onResetHero: () => void;
    onFriendUpdate: (updates: Partial<Persona>) => void;
    onResetFriend: () => void;
    onAddCharacter: () => void;
    onUpdateCharacter: (id: string, updates: Partial<Persona>) => void;
    onDeleteCharacter: (id: string) => void;
    onStoryContextUpdate: (updates: Partial<StoryContext>) => void;
    onPortraitUpload: (id: string, file: File) => void;
    onRefUpload: (id: string, files: FileList) => void;
    onRefRemove: (id: string, index: number) => void;
    onEmblemUpload: (id: string, file: File) => void;
    onEmblemRemove: (id: string) => void;
    onWeaponUpload: (id: string, file: File) => void;
    onWeaponRemove: (id: string) => void;
    onBackstoryFileUpload: (id: string, files: FileList) => void;
    onBackstoryFileRemove: (id: string, index: number) => void;
    onStoryFileUpload: (files: FileList) => void;
    onStoryFileRemove: (index: number) => void;
    onGenreChange: (val: string) => void;
    onLanguageChange: (val: string) => void;
    onPremiseChange: (val: string) => void;
    onRichModeChange: (val: boolean) => void;
    onLaunch: () => void;
    onSurpriseMe: () => void;
    onAISurpriseMe?: (options: {
        useCharContext: boolean;
        selectedCharIds: string[];
        useCurrentSettings: boolean;
        extraInput: string;
    }) => Promise<void>;
    isSurprisingMe?: boolean;
    onOpenSingleImageMode?: () => void;
    onExportDraft: () => void;
    onImportDraft: (file: File) => void;
    onClearSetup: () => void;
    onImproveText?: (text: string, context?: string, purpose?: 'story_description' | 'regeneration_instruction' | 'backstory') => Promise<string>;
    skipProfileAnalysis?: boolean;
    onSkipProfileAnalysisChange?: (val: boolean) => void;
    useSavedProfiles?: boolean;
    onUseSavedProfilesChange?: (val: boolean) => void;
    hasStaleSavedProfiles?: boolean;
    onPresetSelect?: (preset: ComicPreset) => void;
    onSettingsOpen?: () => void;
    /**
     * Casting step. Lives on the setup screen rather than mid-launch because a
     * model sheet is something you decide about while configuring the cast —
     * and because the launch flow can skip the profiles dialog entirely.
     */
    /** Supply an existing cover instead of generating one. */
    onCoverUpload?: (file: File) => Promise<void>;
    /** Drop a supplied cover so the next run generates one. */
    onCoverRemove?: () => void;
    /** True while the saved cast is still being read from storage. */
    isCastLoading?: boolean;
    /**
     * Pages already rendered in a just-restored draft. When above zero, Setup
     * offers a way back into the reader — loading a draft populates these fields
     * rather than jumping straight to the artwork.
     */
    resumablePageCount?: number;
    /** Open the reader for the restored draft. */
    onResumeComic?: () => void;
    /**
     * Reload a past session. Resolves to null on success, or a message
     * explaining why it could not be restored.
     */
    onRestoreSession?: (sessionId: string) => Promise<string | null>;
    /** Remove a session's stored snapshot when its row is deleted. */
    onDeleteSessionSnapshot?: (sessionId: string) => void;
    modelSheetProps?: {
        characters: Persona[];
        artStyle: string;
        states: Record<string, ModelSheetState>;
        onGenerate: (personaId: string) => void;
        onClear: (personaId: string) => void;
        onGenerateAll: () => void;
        onUpload?: (personaId: string, file: File) => void;
        onConfirm?: (options: { title: string; message: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
    };
}

// LocalStorage key for custom presets
const CUSTOM_PRESETS_KEY = 'userCustomPresets';

// Load custom presets from localStorage
const loadCustomPresets = (): CustomPreset[] => {
    try {
        const stored = localStorage.getItem(CUSTOM_PRESETS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

// Save custom presets to localStorage
const saveCustomPresets = (presets: CustomPreset[]) => {
    try {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
    } catch (e) {
        console.error('Failed to save custom presets:', e);
    }
};

// Validation error types
interface ValidationErrors {
    heroName?: string;
    heroPortrait?: string;
    storyDescription?: string;
    customPremise?: string;
}

/**
 * Setup component - the main configuration screen for creating characters and story settings.
 * Allows users to configure hero/co-star characters, story context, and generation options.
 */
export const Setup: React.FC<SetupProps> = (props) => {
    const [showTutorial, setShowTutorial] = useState(false);
    const [showTutorialPage, setShowTutorialPage] = useState(false);
    const [isImprovingStory, setIsImprovingStory] = useState(false);
    const [improveStoryError, setImproveStoryError] = useState('');
    const [selectedContextChars, setSelectedContextChars] = useState<Set<string>>(new Set());
    const [showContextDropdown, setShowContextDropdown] = useState(false);
    const [showExpandedStory, setShowExpandedStory] = useState(false);
    const [showSavePresetModal, setShowSavePresetModal] = useState(false);
    const [customPresets, setCustomPresets] = useState<CustomPreset[]>(loadCustomPresets);

    // AI Surprise Me options panel state
    const [showSurprisePanel, setShowSurprisePanel] = useState(false);
    const [surpriseUseCharContext, setSurpriseUseCharContext] = useState(true);
    const [surpriseSelectedChars, setSurpriseSelectedChars] = useState<Set<string>>(new Set());
    const [surpriseUseCurrentSettings, setSurpriseUseCurrentSettings] = useState(false);
    const [surpriseExtraInput, setSurpriseExtraInput] = useState('');

    // Undo/redo for story description (tracks pre-AI-improve states)
    const storyDescHistory = useUndoHistory<string>(props.storyContext.descriptionText);

    // Session history store for Feature E
    const { sessions, remove: removeSession } = useSessionHistoryStore();
    /** Session currently being restored, so the row can show progress. */
    const [restoringSessionId, setRestoringSessionId] = useState<string | null>(null);
    /** Why the last restore attempt failed, shown inline on that row. */
    const [restoreError, setRestoreError] = useState<{ id: string; message: string } | null>(null);

    const handleSessionClick = async (sessionId: string) => {
        if (!props.onRestoreSession || restoringSessionId) return;
        setRestoreError(null);
        setRestoringSessionId(sessionId);
        try {
            const error = await props.onRestoreSession(sessionId);
            if (error) {
                setRestoreError({ id: sessionId, message: error });
            } else {
                setShowSessionHistory(false);
            }
        } finally {
            setRestoringSessionId(null);
        }
    };
    const [showSessionHistory, setShowSessionHistory] = useState(false);
    const [sessionSortKey, setSessionSortKey] = useState<'date_desc' | 'date_asc' | 'mode'>('date_desc');
    const [sessionFilterMode, setSessionFilterMode] = useState<'all' | 'novel' | 'outline' | 'single'>('all');

    // Responsive collapsible sections for mobile
    const [castExpanded, setCastExpanded] = useState(true);
    const [storyExpanded, setStoryExpanded] = useState(true);

    // Validation state
    const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
    const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

    // Validation functions
    const validateHeroName = (): string | undefined => {
        if (!props.hero?.name || props.hero.name.trim() === '') {
            return 'Hero name is required';
        }
        return undefined;
    };

    const validateHeroPortrait = (): string | undefined => {
        if (!props.hero?.base64) {
            return 'Hero portrait is required';
        }
        return undefined;
    };

    const validateStoryDescription = (): string | undefined => {
        if (props.selectedGenre === 'Custom' && (!props.storyContext.descriptionText || props.storyContext.descriptionText.trim() === '')) {
            return 'Story description is required for Custom genre';
        }
        return undefined;
    };

    const validateCustomPremise = (): string | undefined => {
        if (props.selectedGenre === 'Custom' && (!props.customPremise || props.customPremise.trim() === '')) {
            return 'Premise is required for Custom genre';
        }
        return undefined;
    };

    // Run all validations and return errors
    const validateAll = (): ValidationErrors => {
        return {
            heroName: validateHeroName(),
            heroPortrait: validateHeroPortrait(),
            storyDescription: validateStoryDescription(),
            customPremise: validateCustomPremise()
        };
    };

    // Handle field blur - validate specific field
    const handleFieldBlur = (field: keyof ValidationErrors) => {
        if (!hasAttemptedSubmit) return; // Only show errors after first submit attempt

        let error: string | undefined;
        switch (field) {
            case 'heroName':
                error = validateHeroName();
                break;
            case 'heroPortrait':
                error = validateHeroPortrait();
                break;
            case 'storyDescription':
                error = validateStoryDescription();
                break;
            case 'customPremise':
                error = validateCustomPremise();
                break;
        }

        setValidationErrors(prev => ({ ...prev, [field]: error }));
    };

    // Handle launch with validation
    const handleLaunch = () => {
        setHasAttemptedSubmit(true);
        const errors = validateAll();
        setValidationErrors(errors);

        if (!errors.heroName && !errors.heroPortrait && !errors.storyDescription && !errors.customPremise) {
            props.onLaunch();
        }
    };

    // Get all characters for context dropdown
    const allCharacters = [
        props.hero ? { id: 'hero', name: props.hero.name || 'Hero', backstory: props.hero.backstoryText || '' } : null,
        props.friend ? { id: 'friend', name: props.friend.name || 'Co-Star', backstory: props.friend.backstoryText || '' } : null,
        ...props.additionalCharacters.map(c => ({ id: c.id, name: c.name || 'Character', backstory: c.backstoryText || '' }))
    ].filter(Boolean) as { id: string; name: string; backstory: string }[];

    const handleImproveStory = async () => {
        if (!props.onImproveText || !props.storyContext.descriptionText.trim()) return;

        setIsImprovingStory(true);
        try {
            // Build context from selected characters
            let context = '';
            if (selectedContextChars.size > 0) {
                const contextParts = allCharacters
                    .filter(c => selectedContextChars.has(c.id))
                    .map(c => `${c.name}: ${c.backstory}`)
                    .filter(s => s.length > 10);
                if (contextParts.length > 0) {
                    context = contextParts.join('\n\n');
                }
            }

            const original = props.storyContext.descriptionText;
            const improved = await props.onImproveText(
                props.storyContext.descriptionText,
                context || undefined,
                'story_description'
            );
            storyDescHistory.push(original); // save pre-improve state for undo
            props.onStoryContextUpdate({ descriptionText: improved });
        } catch (e) {
            console.error('Failed to improve story:', e);
            setImproveStoryError('AI Improve failed. Please try again.');
            setTimeout(() => setImproveStoryError(''), 5000);
        } finally {
            setIsImprovingStory(false);
        }
    };

    const handleUndoStoryDesc = () => {
        const prev = storyDescHistory.undo();
        if (prev !== null) props.onStoryContextUpdate({ descriptionText: prev });
    };

    const handleRedoStoryDesc = () => {
        const next = storyDescHistory.redo();
        if (next !== null) props.onStoryContextUpdate({ descriptionText: next });
    };

    const toggleContextChar = (id: string) => {
        setSelectedContextChars(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSurpriseChar = (id: string) => {
        setSurpriseSelectedChars(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleAISurpriseMe = async () => {
        if (!props.onAISurpriseMe) {
            props.onSurpriseMe();
            return;
        }
        setShowSurprisePanel(false);
        await props.onAISurpriseMe({
            useCharContext: surpriseUseCharContext,
            selectedCharIds: Array.from(surpriseSelectedChars),
            useCurrentSettings: surpriseUseCurrentSettings,
            extraInput: surpriseExtraInput
        });
    };

    // Sorted/filtered session history
    const filteredSessions = sessions
        .filter(s => sessionFilterMode === 'all' || s.mode === sessionFilterMode)
        .sort((a, b) => {
            if (sessionSortKey === 'date_desc') return b.updatedAt - a.updatedAt;
            if (sessionSortKey === 'date_asc') return a.updatedAt - b.updatedAt;
            return a.mode.localeCompare(b.mode);
        });

    const handleSavePreset = (name: string, description: string) => {
        const newPreset: CustomPreset = {
            id: `custom-${Date.now()}`,
            name,
            description,
            genre: props.selectedGenre,
            artStyle: props.storyContext.artStyle,
            pageLength: props.storyContext.pageLength,
            samplePlotOutline: props.storyContext.descriptionText,
            createdAt: Date.now()
        };

        const updated = [...customPresets, newPreset];
        setCustomPresets(updated);
        saveCustomPresets(updated);
        setShowSavePresetModal(false);
    };

    const handleDeleteCustomPreset = (presetId: string) => {
        const updated = customPresets.filter(p => p.id !== presetId);
        setCustomPresets(updated);
        saveCustomPresets(updated);
    };

    const handleUpdateCustomPreset = (presetId: string, updates: Partial<CustomPreset>) => {
        const updated = customPresets.map(p =>
            p.id === presetId ? { ...p, ...updates } : p
        );
        setCustomPresets(updated);
        saveCustomPresets(updated);
    };

    const handleSelectCustomPreset = (preset: CustomPreset) => {
        props.onGenreChange(preset.genre);
        props.onStoryContextUpdate({
            artStyle: preset.artStyle,
            pageLength: preset.pageLength,
            descriptionText: preset.samplePlotOutline
        });
    };

    if (!props.show && !props.isTransitioning && !showTutorial && !showTutorialPage) {
        return null;
    }

    return (
        <>
        <style>{`
             @keyframes knockout-exit {
                0% { transform: scale(1) rotate(1deg); }
                15% { transform: scale(1.1) rotate(-5deg); }
                100% { transform: translateY(-200vh) rotate(1080deg) scale(0.5); opacity: 1; }
             }
             @keyframes pow-enter {
                 0% { transform: translate(-50%, -50%) scale(0) rotate(-45deg); opacity: 0; }
                 30% { transform: translate(-50%, -50%) scale(1.5) rotate(10deg); opacity: 1; }
                 100% { transform: translate(-50%, -50%) scale(1.8) rotate(0deg); opacity: 0; }
             }
          `}</style>
        {props.isTransitioning && (
            <div className="fixed top-1/2 left-1/2 z-[210] pointer-events-none" style={{ animation: 'pow-enter 1s forwards ease-out' }}>
                <svg viewBox="0 0 200 150" className="w-[500px] h-[400px] drop-shadow-[0_10px_0_rgba(0,0,0,0.5)]">
                    <path d="M95.7,12.8 L110.2,48.5 L148.5,45.2 L125.6,74.3 L156.8,96.8 L119.4,105.5 L122.7,143.8 L92.5,118.6 L60.3,139.7 L72.1,103.2 L34.5,108.8 L59.9,79.9 L24.7,57.3 L62.5,54.4 L61.2,16.5 z" fill="#FFD700" stroke="black" strokeWidth="4"/>
                    <text x="100" y="95" textAnchor="middle" fontFamily="'Bangers', cursive" fontSize="70" fill="#DC2626" stroke="black" strokeWidth="2" transform="rotate(-5 100 75)">POW!</text>
                </svg>
            </div>
        )}

        <div className={`fixed inset-0 z-[200] overflow-y-auto`}
             style={{
                 background: props.isTransitioning ? 'transparent' : 'rgba(0,0,0,0.85)',
                 backdropFilter: props.isTransitioning ? 'none' : 'blur(6px)',
                 animation: props.isTransitioning ? 'knockout-exit 1s forwards cubic-bezier(.6,-0.28,.74,.05)' : 'none',
                 pointerEvents: props.isTransitioning ? 'none' : 'auto'
             }}>
          <div className="min-h-full flex items-center justify-center p-2 sm:p-4 pb-24 sm:pb-32 md:pb-24">
            {/* Compacted width and internal spacing - responsive padding */}
            <div className="max-w-[900px] w-full bg-white p-3 sm:p-4 md:p-5 border-4 sm:border-[6px] border-black shadow-[6px_6px_0px_rgba(0,0,0,0.6)] sm:shadow-[12px_12px_0px_rgba(0,0,0,0.6)] text-center relative">

                {/* Settings gear — inside card on mobile/tablet, hidden on desktop (floating gear handles desktop) */}
                {props.onSettingsOpen && (
                    <button
                        onClick={props.onSettingsOpen}
                        className="absolute top-3 right-3 md:hidden w-9 h-9 bg-white border-[3px] border-black rounded-full flex items-center justify-center shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:shadow-[3px_3px_0px_rgba(0,0,0,1)] active:shadow-[1px_1px_0px_rgba(0,0,0,1)] transition-all touch-manipulation z-10"
                        title="Settings"
                        aria-label="Open settings"
                    >
                        <span className="text-lg leading-none">⚙️</span>
                    </button>
                )}

                <h1 className="font-comic text-3xl sm:text-4xl md:text-5xl text-red-600 leading-none mb-1 tracking-wide inline-block mr-2 sm:mr-3" style={{textShadow: '2px 2px 0px black'}}>INFINITE</h1>
                <h1 className="font-comic text-3xl sm:text-4xl md:text-5xl text-yellow-400 leading-none mb-3 sm:mb-4 tracking-wide inline-block" style={{textShadow: '2px 2px 0px black'}}>HEROES</h1>

                {(props.resumablePageCount ?? 0) > 0 && props.onResumeComic && (
                    <div className="border-[3px] border-black bg-green-100 p-3 mb-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between">
                            <div>
                                <p className="font-comic text-base uppercase text-green-900">
                                    Draft loaded — {props.resumablePageCount} page{props.resumablePageCount === 1 ? '' : 's'} already drawn
                                </p>
                                <p className="font-ui text-xs text-gray-700">
                                    Your cast and story settings are filled in below. Edit anything you like, or jump straight back to the artwork.
                                </p>
                            </div>
                            <button
                                onClick={props.onResumeComic}
                                className="comic-btn shrink-0 bg-green-600 text-white font-comic px-4 py-2 border-[3px] border-black uppercase text-sm hover:bg-green-500"
                            >
                                Open Comic
                            </button>
                        </div>
                    )}

                {props.isCastLoading && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="border-[3px] border-black bg-blue-100 p-2 mb-3 font-comic text-sm uppercase text-blue-900"
                    >
                        Restoring your saved cast…
                    </div>
                )}

                <div className="flex flex-col md:flex-row gap-3 sm:gap-4 mb-3 sm:mb-4 text-left">

                    {/* Left Column: Cast */}
                    <div className="flex-1 flex flex-col gap-2">
                        <div
                            onClick={() => setCastExpanded(!castExpanded)}
                            className="font-comic text-lg sm:text-xl text-black border-b-4 border-black mb-1 flex justify-between items-center w-full text-left hover:bg-gray-50 p-1 -m-1 transition-colors md:cursor-default cursor-pointer md:cursor-default"
                            role="button"
                            aria-expanded={castExpanded}
                            aria-controls="cast-section"
                        >
                            <span className="flex items-center gap-2">
                                <span className="md:hidden text-gray-500">{castExpanded ? '▼' : '▶'}</span>
                                1. THE CAST
                            </span>
                            <button
                                onClick={(e) => { e.stopPropagation(); props.onAddCharacter(); }}
                                className="bg-blue-600 text-white text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 hover:bg-blue-500 border-2 border-black touch-manipulation"
                            >
                                ADD CHARACTER
                            </button>
                        </div>

                        <div
                            id="cast-section"
                            className={`max-h-[50vh] sm:max-h-[60vh] md:max-h-[700px] overflow-y-auto pr-1 sm:pr-2 custom-scrollbar transition-all duration-300 ${castExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden md:opacity-100 md:h-auto md:overflow-y-auto'}`}
                        >
                            <CharacterCard
                                title="MAIN (REQUIRED)"
                                persona={props.hero}
                                isFixed
                                isRequired
                                onUpdate={props.onHeroUpdate}
                                onReset={props.onResetHero}
                                onPortraitUpload={(file) => props.onPortraitUpload('hero', file)}
                                onRefUpload={(files) => props.onRefUpload('hero', files)}
                                onRefRemove={(i) => props.onRefRemove('hero', i)}
                                onEmblemUpload={(file) => props.onEmblemUpload('hero', file)}
                                onEmblemRemove={() => props.onEmblemRemove('hero')}
                                onWeaponUpload={(file) => props.onWeaponUpload('hero', file)}
                                onWeaponRemove={() => props.onWeaponRemove('hero')}
                                onBackstoryFileUpload={(files) => props.onBackstoryFileUpload('hero', files)}
                                onBackstoryFileRemove={(i) => props.onBackstoryFileRemove('hero', i)}
                                onImproveText={props.onImproveText}
                                otherCharacters={[
                                    props.friend ? { id: 'friend', name: props.friend.name || 'Co-Star', backstoryText: props.friend.backstoryText } : null,
                                    ...props.additionalCharacters.map(c => ({ id: c.id, name: c.name || 'Character', backstoryText: c.backstoryText }))
                                ].filter(Boolean) as { id: string; name: string; backstoryText?: string }[]}
                                nameError={validationErrors.heroName}
                                portraitError={validationErrors.heroPortrait}
                                onNameBlur={() => handleFieldBlur('heroName')}
                                onPortraitBlur={() => handleFieldBlur('heroPortrait')}
                            />

                            <CharacterCard
                                title="CO-STAR (OPTIONAL)"
                                persona={props.friend}
                                isFixed
                                onUpdate={props.onFriendUpdate}
                                onReset={props.onResetFriend}
                                onPortraitUpload={(file) => props.onPortraitUpload('friend', file)}
                                onRefUpload={(files) => props.onRefUpload('friend', files)}
                                onRefRemove={(i) => props.onRefRemove('friend', i)}
                                onEmblemUpload={(file) => props.onEmblemUpload('friend', file)}
                                onEmblemRemove={() => props.onEmblemRemove('friend')}
                                onWeaponUpload={(file) => props.onWeaponUpload('friend', file)}
                                onWeaponRemove={() => props.onWeaponRemove('friend')}
                                onBackstoryFileUpload={(files) => props.onBackstoryFileUpload('friend', files)}
                                onBackstoryFileRemove={(i) => props.onBackstoryFileRemove('friend', i)}
                                onImproveText={props.onImproveText}
                                otherCharacters={[
                                    props.hero ? { id: 'hero', name: props.hero.name || 'Hero', backstoryText: props.hero.backstoryText } : null,
                                    ...props.additionalCharacters.map(c => ({ id: c.id, name: c.name || 'Character', backstoryText: c.backstoryText }))
                                ].filter(Boolean) as { id: string; name: string; backstoryText?: string }[]}
                            />

                            {props.additionalCharacters.map((char) => (
                                <CharacterCard
                                    key={char.id}
                                    title="ADDITIONAL CHARACTER"
                                    persona={char}
                                    onUpdate={(updates) => props.onUpdateCharacter(char.id, updates)}
                                    onDelete={() => props.onDeleteCharacter(char.id)}
                                    onPortraitUpload={(file) => props.onPortraitUpload(char.id, file)}
                                    onRefUpload={(files) => props.onRefUpload(char.id, files)}
                                    onRefRemove={(i) => props.onRefRemove(char.id, i)}
                                    onEmblemUpload={(file) => props.onEmblemUpload(char.id, file)}
                                    onEmblemRemove={() => props.onEmblemRemove(char.id)}
                                    onWeaponUpload={(file) => props.onWeaponUpload(char.id, file)}
                                    onWeaponRemove={() => props.onWeaponRemove(char.id)}
                                    onBackstoryFileUpload={(files) => props.onBackstoryFileUpload(char.id, files)}
                                    onBackstoryFileRemove={(i) => props.onBackstoryFileRemove(char.id, i)}
                                    onImproveText={props.onImproveText}
                                    otherCharacters={[
                                        props.hero ? { id: 'hero', name: props.hero.name || 'Hero', backstoryText: props.hero.backstoryText } : null,
                                        props.friend ? { id: 'friend', name: props.friend.name || 'Co-Star', backstoryText: props.friend.backstoryText } : null,
                                        ...props.additionalCharacters
                                            .filter(c => c.id !== char.id)
                                            .map(c => ({ id: c.id, name: c.name || 'Character', backstoryText: c.backstoryText }))
                                    ].filter(Boolean) as { id: string; name: string; backstoryText?: string }[]}
                                />
                            ))}
                        </div>

                        {props.modelSheetProps && props.modelSheetProps.characters.length > 0 && (
                            <div className="mt-3">
                                <ModelSheetStrip {...props.modelSheetProps} />
                            </div>
                        )}
                    </div>

                    {/* Right Column: Settings */}
                    <div className="flex-1 flex flex-col gap-2">
                        <div
                            onClick={() => setStoryExpanded(!storyExpanded)}
                            className="font-comic text-lg sm:text-xl text-black border-b-4 border-black mb-1 flex justify-between items-center w-full text-left hover:bg-gray-50 p-1 -m-1 transition-colors cursor-pointer md:cursor-default"
                            role="button"
                            aria-expanded={storyExpanded}
                            aria-controls="story-section"
                        >
                            <span className="flex items-center gap-2">
                                <span className="md:hidden text-gray-500">{storyExpanded ? '▼' : '▶'}</span>
                                2. THE STORY
                            </span>
                            <div className="relative">
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (props.onAISurpriseMe) setShowSurprisePanel(!showSurprisePanel);
                                        else props.onSurpriseMe();
                                    }}
                                    disabled={props.isSurprisingMe}
                                    className="bg-yellow-400 text-black text-[10px] sm:text-xs px-2 py-1 sm:py-1.5 hover:bg-yellow-300 border-2 border-black flex items-center gap-1 font-bold touch-manipulation disabled:opacity-60"
                                >
                                    {props.isSurprisingMe ? '⏳ GENERATING...' : '🎲 SURPRISE ME!'}
                                </button>

                                {/* AI Surprise Me options panel */}
                                {showSurprisePanel && !props.isSurprisingMe && (
                                    <>
                                        <div className="fixed inset-0 z-[49]" onClick={() => setShowSurprisePanel(false)} />
                                        <div className="absolute right-0 top-full mt-1 bg-white border-2 border-black shadow-[4px_4px_0px_rgba(0,0,0,0.3)] z-50 w-64">
                                            <div className="p-2 bg-yellow-400 border-b-2 border-black">
                                                <p className="font-comic text-xs font-bold uppercase">✨ AI Story Generator</p>
                                                <p className="font-comic text-[10px] text-yellow-900">AI will create title, story, genre &amp; art style</p>
                                            </div>

                                            {/* Use character context */}
                                            <div className="p-2 border-b border-gray-200">
                                                <label className="flex items-center gap-2 cursor-pointer mb-1">
                                                    <input
                                                        type="checkbox"
                                                        checked={surpriseUseCharContext}
                                                        onChange={e => { setSurpriseUseCharContext(e.target.checked); if (!e.target.checked) setSurpriseSelectedChars(new Set()); }}
                                                        className="w-4 h-4 accent-yellow-600"
                                                    />
                                                    <span className="font-comic text-xs font-bold">Use Character Context</span>
                                                </label>
                                                {surpriseUseCharContext && allCharacters.length > 0 && (
                                                    <div className="ml-5 max-h-20 overflow-y-auto">
                                                        {allCharacters.map(c => (
                                                            <label key={c.id} className="flex items-center gap-2 py-0.5 hover:bg-yellow-50 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={surpriseSelectedChars.has(c.id)}
                                                                    onChange={() => toggleSurpriseChar(c.id)}
                                                                    className="w-3 h-3 accent-yellow-600"
                                                                />
                                                                <span className="font-comic text-[10px] truncate">{c.name}</span>
                                                            </label>
                                                        ))}
                                                    </div>
                                                )}
                                                {surpriseUseCharContext && allCharacters.length === 0 && (
                                                    <p className="text-[10px] text-gray-400 ml-5 italic">No characters added yet</p>
                                                )}
                                            </div>

                                            {/* Keep current settings */}
                                            <div className="p-2 border-b border-gray-200">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={surpriseUseCurrentSettings}
                                                        onChange={e => setSurpriseUseCurrentSettings(e.target.checked)}
                                                        className="w-4 h-4 accent-yellow-600"
                                                    />
                                                    <span className="font-comic text-xs font-bold">Keep Current Genre &amp; Style</span>
                                                </label>
                                            </div>

                                            {/* Extra input */}
                                            <div className="p-2 border-b border-gray-200">
                                                <p className="font-comic text-[10px] text-gray-600 uppercase mb-1">Extra direction (optional):</p>
                                                <textarea
                                                    value={surpriseExtraInput}
                                                    onChange={e => setSurpriseExtraInput(e.target.value)}
                                                    placeholder="e.g. Make it a heist story set in space..."
                                                    className="w-full p-1.5 border-2 border-black font-comic text-[10px] resize-none h-12"
                                                    onClick={e => e.stopPropagation()}
                                                />
                                            </div>

                                            <div className="p-2 flex gap-2">
                                                <button
                                                    onClick={handleAISurpriseMe}
                                                    className="flex-1 comic-btn bg-yellow-500 text-black text-xs px-2 py-1.5 border-2 border-black hover:bg-yellow-400 font-bold"
                                                >
                                                    🎲 GENERATE
                                                </button>
                                                <button
                                                    onClick={() => setShowSurprisePanel(false)}
                                                    className="comic-btn bg-gray-400 text-white text-xs px-2 py-1.5 border-2 border-black hover:bg-gray-300"
                                                    aria-label="Close AI story generator panel"
                                                    title="Close"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        <div
                            id="story-section"
                            className={`bg-yellow-50 p-2 sm:p-3 border-4 border-black h-full flex flex-col transition-all duration-300 ${storyExpanded ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden md:opacity-100 md:h-auto'}`}
                        >
                            <div className="mb-2 sm:mb-3">
                                <p className="font-comic text-sm sm:text-base mb-1 font-bold text-gray-800 uppercase">Story Title</p>
                                <input
                                    type="text"
                                    value={props.storyContext.title}
                                    onChange={(e) => props.onStoryContextUpdate({ title: e.target.value })}
                                    placeholder="Enter your story title..."
                                    className="w-full p-2 sm:p-2.5 border-2 border-black font-comic text-base sm:text-lg shadow-[3px_3px_0px_rgba(0,0,0,0.1)] touch-manipulation"
                                    aria-label="Story title"
                                />
                            </div>

                            {/* Story Description with AI Improve */}
                            <div className="mb-2 sm:mb-3">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 mb-1">
                                    <div className="font-comic text-sm sm:text-base font-bold text-gray-800 uppercase flex items-center">
                                        <label htmlFor="story-description-input">
                                            Describe Your Story{props.selectedGenre === 'Custom' && <span className="text-red-600 ml-0.5">*</span>}
                                        </label>
                                        <HelpTooltip
                                            title="Story Tips"
                                            text="Include plot points, character motivations, key scenes, and conflicts. The more detail you provide, the better the AI can create a cohesive story."
                                            position="right"
                                        />
                                    </div>
                                    <div className="flex gap-1 self-end sm:self-auto items-center">
                                        {props.onImproveText && (storyDescHistory.canUndo || storyDescHistory.canRedo) && (
                                            <UndoRedoButtons
                                                onUndo={handleUndoStoryDesc}
                                                onRedo={handleRedoStoryDesc}
                                                canUndo={storyDescHistory.canUndo}
                                                canRedo={storyDescHistory.canRedo}
                                                undoDescription="Revert story description"
                                                redoDescription="Redo story description"
                                                size="small"
                                            />
                                        )}
                                        {props.onImproveText && (
                                            <div className="relative">
                                                <button
                                                    onClick={() => setShowContextDropdown(!showContextDropdown)}
                                                    disabled={isImprovingStory || !props.storyContext.descriptionText.trim()}
                                                    className="comic-btn bg-purple-600 text-white text-[10px] sm:text-xs px-2 py-1 sm:py-0.5 hover:bg-purple-500 border-2 border-black uppercase disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 touch-manipulation min-h-[36px] sm:min-h-0"
                                                    title="Improve story description with AI"
                                                >
                                                    {isImprovingStory ? '⏳ IMPROVING...' : '✨ AI IMPROVE'}
                                                </button>
                                            {/* Character Context Dropdown */}
                                            {showContextDropdown && !isImprovingStory && (
                                                <div className="absolute right-0 top-full mt-1 bg-white border-2 border-black shadow-[3px_3px_0px_rgba(0,0,0,0.3)] z-50 min-w-[200px]">
                                                    <div className="p-2 border-b-2 border-gray-200">
                                                        <p className="font-comic text-[10px] text-gray-600 uppercase">Include character context (optional):</p>
                                                    </div>
                                                    <div className="max-h-32 overflow-y-auto">
                                                        {allCharacters.length > 0 ? allCharacters.map(c => (
                                                            <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 hover:bg-purple-50 cursor-pointer">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={selectedContextChars.has(c.id)}
                                                                    onChange={() => toggleContextChar(c.id)}
                                                                    className="w-4 h-4 accent-purple-600"
                                                                />
                                                                <span className="font-comic text-xs truncate">{c.name}</span>
                                                            </label>
                                                        )) : (
                                                            <p className="text-xs text-gray-400 p-2 italic">No characters added yet</p>
                                                        )}
                                                    </div>
                                                    <div className="p-2 border-t-2 border-gray-200 flex gap-2">
                                                        <button
                                                            onClick={() => { handleImproveStory(); setShowContextDropdown(false); }}
                                                            className="flex-1 comic-btn bg-green-600 text-white text-xs px-2 py-1 border-2 border-black hover:bg-green-500 font-bold"
                                                        >
                                                            ✨ IMPROVE
                                                        </button>
                                                        <button
                                                            onClick={() => setShowContextDropdown(false)}
                                                            className="comic-btn bg-gray-400 text-white text-xs px-2 py-1 border-2 border-black hover:bg-gray-300"
                                                            aria-label="Close character context dropdown"
                                                            title="Close"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                        <button
                                            onClick={() => setShowExpandedStory(true)}
                                            className="comic-btn bg-blue-500 text-white text-[10px] sm:text-xs px-2 py-1 sm:py-0.5 hover:bg-blue-400 border-2 border-black uppercase touch-manipulation min-h-[36px] sm:min-h-0"
                                            title="Expand story editor"
                                        >
                                            ⤢ EXPAND
                                        </button>
                                    </div>
                                </div>
                                <textarea
                                    id="story-description-input"
                                    value={props.storyContext.descriptionText}
                                    onChange={(e) => props.onStoryContextUpdate({ descriptionText: e.target.value })}
                                    onBlur={() => handleFieldBlur('storyDescription')}
                                    placeholder="Type or paste a synopsis, script, or plot points..."
                                    className={`w-full p-2 font-comic text-sm h-24 sm:h-20 resize-none shadow-[3px_3px_0px_rgba(0,0,0,0.1)] mb-2 touch-manipulation ${validationErrors.storyDescription ? 'border-[3px] border-red-600' : 'border-2 border-black'}`}
                                    aria-label="Story description"
                                    aria-invalid={!!validationErrors.storyDescription}
                                />
                                {validationErrors.storyDescription && <p className="font-comic text-xs text-red-600 mb-2 flex items-center gap-1"><span className="font-bold">!</span> {validationErrors.storyDescription}</p>}
                                <div className="flex flex-wrap gap-1.5 sm:gap-2 items-center">
                                    <label className="comic-btn bg-gray-200 text-black text-[10px] sm:text-xs px-2 py-1.5 sm:py-1 hover:bg-gray-300 cursor-pointer border-2 border-black touch-manipulation min-h-[36px] sm:min-h-0 flex items-center">
                                        UPLOAD FILES
                                        <input
                                            type="file"
                                            multiple
                                            accept=".txt,.md,image/*"
                                            className="hidden"
                                            onChange={(e) => e.target.files && props.onStoryFileUpload(e.target.files)}
                                            aria-label="Upload story files"
                                        />
                                    </label>
                                    {props.storyContext.descriptionFiles.map((f, i) => (
                                        <div key={i} className="bg-yellow-100 border border-black p-1 text-[10px] flex items-center gap-1 sm:gap-2">
                                            {f.mimeType?.startsWith('image/') && f.base64 ? (
                                                <img src={`data:${f.mimeType};base64,${f.base64}`} alt={f.name} className="w-7 h-7 sm:w-8 sm:h-8 object-cover border border-black" />
                                            ) : (
                                                <div className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-gray-200 border border-black text-gray-500 font-bold text-[8px] sm:text-[10px]">DOC</div>
                                            )}
                                            <span className="truncate max-w-[60px] sm:max-w-[80px]">{f.name}</span>
                                            <button onClick={() => props.onStoryFileRemove(i)} className="text-red-600 font-bold hover:scale-110 text-lg leading-none p-1 touch-manipulation" aria-label={`Remove file ${f.name}`}>×</button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Expanded Story Modal */}
                            {showExpandedStory && (
                                <div className="fixed inset-0 z-[700] bg-black/90 backdrop-blur-md flex items-center justify-center p-2 sm:p-4" onClick={() => setShowExpandedStory(false)}>
                                    <div className="max-w-[800px] w-full bg-white border-[4px] sm:border-[6px] border-black p-4 sm:p-6 shadow-[8px_8px_0px_rgba(0,0,0,0.5)] sm:shadow-[12px_12px_0px_rgba(0,0,0,0.5)] relative max-h-[95vh] sm:max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                                        <div className="flex justify-between items-center mb-3 sm:mb-4 gap-2">
                                            <h3 className="font-comic text-lg sm:text-2xl text-blue-600 uppercase tracking-tighter truncate">
                                                Story Description
                                            </h3>
                                            <button
                                                onClick={() => setShowExpandedStory(false)}
                                                className="shrink-0 bg-red-600 text-white w-8 h-8 sm:w-10 sm:h-10 border-2 sm:border-4 border-black font-bold text-lg sm:text-xl flex items-center justify-center hover:scale-110 hover:bg-red-500"
                                                aria-label="Close story editor"
                                                title="Close story editor"
                                            >×</button>
                                        </div>
                                        <textarea
                                            value={props.storyContext.descriptionText}
                                            onChange={(e) => props.onStoryContextUpdate({ descriptionText: e.target.value })}
                                            placeholder="Type or paste a synopsis, script, or plot points. Include character motivations, key scenes, conflicts, settings, and any specific dialogue or narrative beats you want in your comic..."
                                            className="flex-1 w-full p-3 sm:p-4 border-2 sm:border-4 border-black font-comic text-sm resize-none shadow-inner min-h-[250px] sm:min-h-[300px] leading-relaxed"
                                            autoFocus
                                        />
                                        <div className="mt-3 sm:mt-4 flex justify-between items-center gap-2">
                                            <p className="font-comic text-[10px] sm:text-xs text-gray-500">
                                                {props.storyContext.descriptionText.length} chars
                                            </p>
                                            {improveStoryError && (
                                                <p className="font-comic text-xs text-red-600 font-bold">{improveStoryError}</p>
                                            )}
                                            <div className="flex gap-2">
                                                {props.onImproveText && (
                                                    <button
                                                        onClick={() => { handleImproveStory(); }}
                                                        disabled={isImprovingStory || !props.storyContext.descriptionText.trim()}
                                                        className="comic-btn bg-purple-600 text-white px-3 sm:px-4 py-2 font-bold border-2 sm:border-[3px] border-black hover:bg-purple-500 uppercase text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title="Improve description with AI"
                                                    >
                                                        {isImprovingStory ? '⏳ IMPROVING...' : '✨ AI IMPROVE'}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setShowExpandedStory(false)}
                                                    className="comic-btn bg-green-600 text-white px-4 sm:px-6 py-2 font-bold border-2 sm:border-[3px] border-black hover:bg-green-500 uppercase text-sm sm:text-base"
                                                >
                                                    ✓ DONE
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Preset Selector */}
                            <PresetSelector
                                customPresets={customPresets}
                                onPresetSelect={props.onPresetSelect}
                                onCustomPresetSelect={handleSelectCustomPreset}
                                onDeleteCustomPreset={handleDeleteCustomPreset}
                                onOpenSavePresetModal={() => setShowSavePresetModal(true)}
                            />

                            {/* Story Settings (Genre, Art Style, etc.) */}
                            <StorySettingsSection
                                selectedGenre={props.selectedGenre}
                                selectedLanguage={props.selectedLanguage}
                                storyContext={props.storyContext}
                                customPremise={props.customPremise}
                                customPremiseError={validationErrors.customPremise}
                                onGenreChange={props.onGenreChange}
                                onLanguageChange={props.onLanguageChange}
                                onStoryContextUpdate={props.onStoryContextUpdate}
                                onPremiseChange={props.onPremiseChange}
                                onCustomPremiseBlur={() => handleFieldBlur('customPremise')}
                            />

                            {/* Cover Config */}
                            <CoverConfigSection
                                onCoverUpload={props.onCoverUpload}
                                onCoverRemove={props.onCoverRemove}
                                storyContext={props.storyContext}
                                onStoryContextUpdate={props.onStoryContextUpdate}
                            />

                            <p className="font-comic text-[9px] sm:text-[10px] text-gray-500 mt-2 pl-1 flex items-center flex-wrap">
                                Story mode (Novel/Outline) is selected after clicking "Start Adventure"
                                <HelpTooltip
                                    title="Novel vs Outline"
                                    text="Novel Mode: Interactive with player choices at key moments. Outline Mode: AI generates the entire story automatically from your description."
                                    position="top"
                                />
                            </p>
                        </div>
                    </div>
                </div>

                {/* === GENERATION OPTIONS SECTION === */}
                <div className="mt-3 sm:mt-4 border-[3px] border-gray-300 bg-gradient-to-r from-gray-50 to-slate-50 p-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Left: Generation Options */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                            <span className="font-comic text-xs font-bold text-gray-700 uppercase shrink-0">⚙️ Options:</span>

                            <label className="flex items-center gap-1.5 font-comic text-xs cursor-pointer text-black hover:text-yellow-700 transition-colors touch-manipulation whitespace-nowrap">
                                <input type="checkbox" checked={props.richMode} onChange={(e) => props.onRichModeChange(e.target.checked)} className="w-4 h-4 accent-yellow-600 shrink-0" aria-label="Rich dialogue mode" />
                                <span>✨ Rich Dialogue</span>
                                <Tooltip text="Uses longer, descriptive captions and deep internal monologues." />
                            </label>

                            {props.onUseSavedProfilesChange && (
                                <label className={`flex items-center gap-1.5 font-comic text-xs cursor-pointer transition-colors touch-manipulation whitespace-nowrap ${props.skipProfileAnalysis ? 'opacity-40' : 'text-green-700 hover:text-green-900'}`}>
                                    <input
                                        type="checkbox"
                                        checked={props.useSavedProfiles ?? true}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.onUseSavedProfilesChange?.(e.target.checked)}
                                        className="w-4 h-4 accent-green-600 shrink-0"
                                        aria-label="Use saved character profiles"
                                        disabled={props.skipProfileAnalysis}
                                    />
                                    <span>💾 Use Saved Profiles</span>
                                    <Tooltip text="Reuses saved character analysis. Auto-generates missing profiles." />
                                </label>
                            )}
                            {props.useSavedProfiles && props.hasStaleSavedProfiles && (
                                <p className="font-comic text-[10px] text-amber-700 font-bold mt-0.5">
                                    Some saved profiles are &gt;24h old — consider re-analyzing.
                                </p>
                            )}

                            {props.onSkipProfileAnalysisChange && (
                                <label className="flex items-center gap-1.5 font-comic text-xs cursor-pointer text-purple-700 hover:text-purple-900 transition-colors touch-manipulation whitespace-nowrap">
                                    <input
                                        type="checkbox"
                                        checked={props.skipProfileAnalysis || false}
                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => props.onSkipProfileAnalysisChange?.(e.target.checked)}
                                        className="w-4 h-4 accent-purple-600 shrink-0"
                                        aria-label="Skip AI pre-analysis"
                                    />
                                    <span>🎯 Skip Analysis</span>
                                    <Tooltip text="Skip AI portrait analysis. Fill in profiles manually." />
                                </label>
                            )}
                        </div>

                        {/* Right: Cost Estimate */}
                        <CostEstimator
                            pageCount={props.storyContext.pageLength || 6}
                            characterCount={
                                (props.hero ? 1 : 0) +
                                (props.friend ? 1 : 0) +
                                props.additionalCharacters.length
                            }
                            isOutlineMode={true}
                            showBreakdown={false}
                            className="shrink-0"
                        />
                    </div>
                </div>


                {/* Extra Mode Buttons */}
                {(props.onOpenSingleImageMode || sessions.length > 0) && (
                    <div className="flex gap-2 mb-2 flex-wrap">
                        {props.onOpenSingleImageMode && (
                            <button
                                onClick={props.onOpenSingleImageMode}
                                className="comic-btn bg-green-600 text-white text-sm px-3 py-2 font-bold border-[3px] border-black hover:bg-green-500 uppercase touch-manipulation flex items-center gap-1"
                            >
                                🎨 Single Image Mode
                            </button>
                        )}
                        {sessions.length > 0 && (
                            <button
                                onClick={() => setShowSessionHistory(true)}
                                className="comic-btn bg-indigo-600 text-white text-sm px-3 py-2 font-bold border-[3px] border-black hover:bg-indigo-500 uppercase touch-manipulation flex items-center gap-1"
                            >
                                📋 Recent Sessions ({sessions.length})
                            </button>
                        )}
                    </div>
                )}

                {/* Action Buttons */}
                <ActionButtons
                    isTransitioning={props.isTransitioning}
                    isGeneratingProfiles={props.isGeneratingProfiles}
                    onHelp={() => setShowTutorial(true)}
                    onExportDraft={props.onExportDraft}
                    onImportDraft={props.onImportDraft}
                    onClearSetup={props.onClearSetup}
                    onLaunch={handleLaunch}
                />
            </div>
          </div>

          {/* Save Preset Modal */}
          <SavePresetModal
              show={showSavePresetModal}
              selectedGenre={props.selectedGenre}
              artStyle={props.storyContext.artStyle}
              pageLength={props.storyContext.pageLength}
              storyDescriptionText={props.storyContext.descriptionText}
              onClose={() => setShowSavePresetModal(false)}
              onSave={handleSavePreset}
          />

          {/* Tutorial Modal */}
          <TutorialModal
              show={showTutorial}
              onClose={() => setShowTutorial(false)}
              onOpenFullGuide={() => { setShowTutorial(false); setShowTutorialPage(true); }}
          />

          <TutorialPage
              show={showTutorialPage}
              onBack={() => setShowTutorialPage(false)}
          />

          {/* Session History Modal */}
          {showSessionHistory && (
              <div
                  className="fixed inset-0 z-[600] bg-black/80 flex items-center justify-center p-4"
                  onClick={() => setShowSessionHistory(false)}
              >
                  <div
                      className="bg-white border-[6px] border-black max-w-xl w-full max-h-[80vh] flex flex-col shadow-[10px_10px_0px_rgba(0,0,0,0.5)]"
                      onClick={e => e.stopPropagation()}
                  >
                      <div className="bg-indigo-600 p-4 flex items-center justify-between border-b-4 border-black">
                          <h3 className="font-comic text-white text-xl font-bold uppercase">📋 Recent Sessions</h3>
                          <button onClick={() => setShowSessionHistory(false)} className="text-white hover:text-gray-200 text-xl font-bold" aria-label="Close session history" title="Close session history">✕</button>
                      </div>

                      {/* Controls */}
                      <div className="flex gap-2 flex-wrap px-3 pt-2 pb-2 border-b-2 border-gray-200 bg-gray-50">
                          <select
                              value={sessionSortKey}
                              onChange={e => setSessionSortKey(e.target.value as any)}
                              className="border-2 border-black font-comic text-xs p-1"
                          >
                              <option value="date_desc">Newest first</option>
                              <option value="date_asc">Oldest first</option>
                              <option value="mode">By mode</option>
                          </select>
                          <select
                              value={sessionFilterMode}
                              onChange={e => setSessionFilterMode(e.target.value as any)}
                              className="border-2 border-black font-comic text-xs p-1"
                          >
                              <option value="all">All modes</option>
                              <option value="novel">Novel</option>
                              <option value="outline">Outline</option>
                              <option value="single">Single Image</option>
                          </select>
                          <span className="text-xs text-gray-400 font-comic ml-auto self-center">
                              {filteredSessions.length} session{filteredSessions.length !== 1 ? 's' : ''}
                          </span>
                      </div>

                      <div className="overflow-y-auto flex-1">
                          {filteredSessions.length === 0 ? (
                              <p className="text-center font-comic text-gray-400 p-8">No sessions found.</p>
                          ) : (
                              filteredSessions.map(session => (
                                  <div key={session.id} className="border-b border-gray-200">
                                    <div className="flex items-center gap-3 p-3 hover:bg-gray-50">
                                      {/* Thumbnail */}
                                      {session.thumbnail ? (
                                          <img src={session.thumbnail} alt="" className="w-10 h-14 object-cover border-2 border-gray-300 shrink-0" />
                                      ) : (
                                          <div className="w-10 h-14 bg-gray-200 border-2 border-gray-300 shrink-0 flex items-center justify-center text-gray-400 text-xs">📄</div>
                                      )}
                                      {/* The row itself reloads the session. A real <button> so it is
                                          reachable by keyboard, not a div with a click handler. */}
                                      <button
                                          type="button"
                                          onClick={() => handleSessionClick(session.id)}
                                          disabled={!props.onRestoreSession || restoringSessionId !== null}
                                          aria-label={`Reload session ${session.title || 'Untitled'}, ${session.mode} mode, ${session.pageCount} page${session.pageCount !== 1 ? 's' : ''}`}
                                          className="flex-1 min-w-0 text-left disabled:cursor-wait"
                                      >
                                          <p className="font-comic text-sm font-bold truncate">
                                            {session.title || 'Untitled'}
                                            {restoringSessionId === session.id && (
                                              <span className="ml-2 text-[10px] text-blue-600 uppercase">Loading…</span>
                                            )}
                                          </p>
                                          <div className="flex items-center gap-2 flex-wrap">
                                              <span className={`text-white text-[10px] px-1.5 py-0.5 font-comic font-bold ${session.mode === 'novel' ? 'bg-blue-600' : session.mode === 'outline' ? 'bg-purple-600' : 'bg-green-600'}`}>
                                                  {session.mode}
                                              </span>
                                              {session.genre && <span className="text-[10px] text-gray-500 font-comic">{session.genre}</span>}
                                              <span className="text-[10px] text-gray-400 font-comic">{session.pageCount} page{session.pageCount !== 1 ? 's' : ''}</span>
                                          </div>
                                          <p className="text-[10px] text-gray-400 font-comic">
                                              {new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                          </p>
                                      </button>
                                      <button
                                          onClick={() => {
                                              removeSession(session.id);
                                              // Otherwise the snapshot outlives its row and IndexedDB grows unbounded.
                                              props.onDeleteSessionSnapshot?.(session.id);
                                          }}
                                          className="text-red-400 hover:text-red-600 text-sm font-bold shrink-0 p-1"
                                          title="Delete session"
                                          aria-label={`Delete session ${session.title || 'Untitled'}`}
                                      >
                                          🗑
                                      </button>
                                    </div>
                                    {restoreError?.id === session.id && (
                                      <p role="alert" className="font-comic text-[11px] text-red-700 px-3 pb-2">
                                        {restoreError.message}
                                      </p>
                                    )}
                                  </div>
                              ))
                          )}
                      </div>

                      <div className="p-3 border-t-2 border-gray-200 flex justify-between items-center">
                          <p className="font-comic text-xs text-gray-500">Click a session to reload it. Sessions are saved automatically as you generate.</p>
                          <button onClick={() => setShowSessionHistory(false)} className="comic-btn bg-gray-400 text-white text-sm px-3 py-1.5 border-2 border-black hover:bg-gray-300 font-bold">Close</button>
                      </div>
                  </div>
              </div>
          )}
        </div>

        {/* Footer is only visible when setup is active */}
        <Footer />
        </>
    );
}
