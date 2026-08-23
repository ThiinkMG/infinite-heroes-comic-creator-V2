/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RerollModal - Regeneration interface for comic panels
 * V2 Batch Plan: Restructured with new Phase 1 components
 */

import React, { useState, useRef, useEffect } from 'react';
import { RegenerationMode, ShotType, BalloonShape, RerollOptions, CharacterProfile } from './types';
import {
    ReferenceImageGallery,
    ProfileSelector,
    InstructionInput,
    ComicFundamentalsOverrides,
    TipsPanel,
    CurrentImagePreview,
    QuickPresets,
    StrengthSlider,
    ConsistencyPreview,
    QUICK_PRESETS,
    getStrengthPrompt,
    type RefImage,
    type QuickPreset
} from './components/reroll';
import { CharacterFocusSelector } from './components/reroll/CharacterFocusSelector';
import { usePageHistory, type RerollHistoryEntry } from './stores/useRerollHistory';
import { useCharacterStore } from './stores/useCharacterStore';

interface RerollModalProps {
    pageIndex: number;
    outline: string;
    allRefImages: RefImage[];
    availableProfiles: { id: string, name: string }[];
    fullProfiles: CharacterProfile[];
    originalPrompt?: string;
    /** Current panel image URL for preview */
    currentImageUrl?: string;
    /** Optional caption for current image */
    currentCaption?: string;
    /** Initial selected profile IDs (for preserving selection across modal open/close) */
    initialSelectedProfileIds?: string[];
    /** Callback when profile selection changes (for preserving state in parent) */
    onProfileSelectionChange?: (selectedIds: string[]) => void;
    onSubmit: (options: RerollOptions) => void;
    onClose: () => void;
    onUploadRef: (files: FileList) => void;
    onDeleteRef: (charId: string, refIndex: number) => void;
    onProfileUpdate?: (profileId: string, updates: Partial<CharacterProfile>) => void;
    onAnalyzeProfile?: (profileId: string) => Promise<void>;
    onAddNewCharacter?: () => void;
    onImproveText?: (text: string, context?: string, purpose?: 'story_description' | 'regeneration_instruction' | 'backstory') => Promise<string>;
    /** Callback to revert to a previous attempt's image */
    onRevert?: (imageUrl: string, entry: RerollHistoryEntry) => void;
    /** Previous page image URL for scene continuity option */
    prevPageImageUrl?: string;
    /** Next page image URL for scene continuity option */
    nextPageImageUrl?: string;
    /** Current panel base64 image — used as preservation reference when characters are locked */
    currentPageImageUrl?: string;
}

export const RerollModal: React.FC<RerollModalProps> = ({
    pageIndex,
    outline,
    allRefImages,
    availableProfiles,
    fullProfiles,
    originalPrompt,
    currentImageUrl,
    currentCaption,
    initialSelectedProfileIds,
    onProfileSelectionChange,
    onSubmit,
    onClose,
    onUploadRef,
    onDeleteRef,
    onProfileUpdate,
    onAnalyzeProfile,
    onAddNewCharacter,
    onImproveText,
    onRevert,
    prevPageImageUrl,
    nextPageImageUrl,
    currentPageImageUrl,
}) => {
    // === HISTORY HOOK (2.3.x) ===
    const pageHistory = usePageHistory(pageIndex);

    // Feature F: Read character lock state for consistency preview and handleSubmit injection
    const characterLocks = useCharacterStore((state) => state.characterLocks);
    // Ref for scrolling to submit button
    const submitRef = useRef<HTMLButtonElement>(null);
    // Track initial mount to avoid calling onProfileSelectionChange on first render
    const isInitialMount = useRef(true);

    // === INSTRUCTION STATE ===
    const [instruction, setInstruction] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [isImprovingInstruction, setIsImprovingInstruction] = useState(false);
    const [isImprovingNegative, setIsImprovingNegative] = useState(false);

    // === PHASE 1 NEW STATE (V2 Batch Plan) ===
    const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
    const [strengthValue, setStrengthValue] = useState(1.0); // Full by default

    // === SELECTION STATE ===
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(allRefImages.map(r => r.id)));
    const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(() => {
        if (initialSelectedProfileIds && initialSelectedProfileIds.length > 0) {
            return new Set(initialSelectedProfileIds);
        }
        return new Set(availableProfiles.map(p => p.id));
    });
    const [deleteMode, setDeleteMode] = useState(false);

    // === REGENERATION MODE STATE ===
    const [regenerationModes, setRegenerationModes] = useState<Set<RegenerationMode>>(new Set(['full']));
    /**
     * Rewrite the page's words as well as its art.
     *
     * Off by default. Rerolling used to always regenerate the beat, so asking for
     * a better drawing silently rewrote the story — and a beat regenerated for a
     * redraw sometimes came back with no dialogue, leaving the page with no
     * speech bubbles at all.
     */
    const [regenerateNarrative, setRegenerateNarrative] = useState(false);

    // === REFERENCE IMAGE OPTIONS ===
    // Simplified: Gallery selection directly controls what gets sent
    // - Selected refs = refs sent to AI
    // - No selection = no refs sent (implicit off)

    // === LOCATION AND POSE ===
    const [selectedLocationId, setSelectedLocationId] = useState<string>('');
    const [selectedPoseId, setSelectedPoseId] = useState<string>('');

    // === COMIC FUNDAMENTALS OVERRIDES ===
    const [shotTypeOverride, setShotTypeOverride] = useState<ShotType | undefined>(undefined);
    const [balloonShapeOverride, setBalloonShapeOverride] = useState<BalloonShape | undefined>(undefined);
    const [applyFlashbackStyle, setApplyFlashbackStyle] = useState(false);

    // === SCENE CONTINUITY STATE ===
    // Phase 2.3: Auto-enable prev-page continuity when a previous page exists
    const [usePrevPage, setUsePrevPage] = useState(!!prevPageImageUrl);
    const [useNextPage, setUseNextPage] = useState(false);

    // === CHARACTER PRESERVE STATE ===
    const [preserveCharacterIds, setPreserveCharacterIds] = useState<string[]>([]);

    // === UI STATE ===
    const [showTips, setShowTips] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [copied, setCopied] = useState(false);

    // === SMART BEHAVIOR: Auto-select all refs when preset uses them (1.3.1) ===
    useEffect(() => {
        if (selectedPresetIds.length > 0) {
            const anyUsesRefs = selectedPresetIds.some(id => QUICK_PRESETS.find(p => p.id === id)?.useRefs);
            if (anyUsesRefs && selectedIds.size === 0) {
                setSelectedIds(new Set(allRefImages.map(r => r.id)));
            }
        }
    }, [selectedPresetIds, allRefImages]);

    // === HANDLERS ===

    const toggleImage = (id: string) => {
        if (deleteMode) return;
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleProfile = (id: string) => {
        setSelectedProfileIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // Sync profile selection changes to parent (separate from setState to avoid update loop)
    useEffect(() => {
        // Skip initial mount to prevent triggering parent re-render loop
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        // Only notify parent when user actually changes selection
        if (onProfileSelectionChange) {
            onProfileSelectionChange(Array.from(selectedProfileIds));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedProfileIds]);

    const handlePresetSelect = (preset: QuickPreset) => {
        // Toggle off if clicking an already-selected preset
        if (selectedPresetIds.includes(preset.id)) {
            setSelectedPresetIds(prev => prev.filter(id => id !== preset.id));
            return;
        }
        // Toggle on: add to selection
        setSelectedPresetIds(prev => [...prev, preset.id]);
        // Smart behavior: Auto-scroll to submit when first preset selected
        if (selectedPresetIds.length === 0) {
            setTimeout(() => {
                submitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    };

    const handleSubmit = () => {
        const selectedRefImages = allRefImages
            .filter(r => selectedIds.has(r.id))
            .map(r => r.base64);

        // Build final instruction with strength and focus area prompts
        let finalInstruction = instruction;

        // Combine all selected preset instructions (multi-preset support)
        const presetInstructions = selectedPresetIds
            .map(id => QUICK_PRESETS.find(p => p.id === id)?.prompt ?? '')
            .filter(Boolean)
            .join(' ');
        if (presetInstructions) {
            finalInstruction = presetInstructions + (finalInstruction ? ' ' + finalInstruction : '');
        }

        // Prepend strength modifier if not full
        if (strengthValue < 1.0) {
            const strengthPrompt = getStrengthPrompt(strengthValue);
            finalInstruction = `${strengthPrompt} the following: ${finalInstruction}`;
        }

        // Feature F: Prepend locked character attribute constraints to the instruction.
        // This ensures locked attributes are enforced even when using custom instructions.
        const lockedLines: string[] = [];
        characterLocks.forEach((lock, charId) => {
            const anyLocked = lock.lockFace || lock.lockOutfit || lock.lockWeapon || lock.lockEmblem;
            if (!anyLocked) return;
            const profile = fullProfiles.find(p => p.id === charId);
            const charName = profile?.name ?? charId;
            const lockedParts: string[] = [];
            if (lock.lockFace) lockedParts.push('face');
            if (lock.lockOutfit) lockedParts.push('outfit');
            if (lock.lockEmblem) lockedParts.push('emblem');
            if (lock.lockWeapon) lockedParts.push('weapon');
            lockedLines.push(`[LOCKED — ${charName.toUpperCase()}: keep ${lockedParts.join(', ')} EXACTLY as reference]`);
        });
        if (lockedLines.length > 0) {
            finalInstruction = `${lockedLines.join(' ')} ${finalInstruction}`.trim();
        }

        const isConsistencyMode = selectedPresetIds.includes('consistency-mode');

        const allPresetModes: RegenerationMode[] = selectedPresetIds.flatMap(
            id => (QUICK_PRESETS.find(p => p.id === id)?.modes ?? []) as RegenerationMode[]
        );
        const combinedPresetModes: RegenerationMode[] = allPresetModes.filter((m, i) => allPresetModes.indexOf(m) === i);
        const finalModes: RegenerationMode[] | undefined = combinedPresetModes.length > 0 ? combinedPresetModes : (regenerationModes.size > 0 ? Array.from(regenerationModes) : undefined);

        const options: RerollOptions = {
            regenerationModes: finalModes,
            regenerateNarrative: regenerateNarrative || undefined,
            instruction: finalInstruction.trim(),
            negativePrompt: negativePrompt.trim() || undefined,
            selectedRefImages,
            selectedProfileIds: Array.from(selectedProfileIds),
            shotTypeOverride,
            balloonShapeOverride,
            applyFlashbackStyle: applyFlashbackStyle || undefined,
            // Simplified: selection IS the control
            reinforceWithReferenceImages: selectedIds.size > 0 || undefined,
            useSelectedRefsOnly: selectedIds.size > 0 || undefined, // Always use only selected
            prevPageImageUrl: usePrevPage ? prevPageImageUrl : undefined,
            nextPageImageUrl: useNextPage ? nextPageImageUrl : undefined,
            consistencyMode: isConsistencyMode || lockedLines.length > 0 || undefined,
            preserveCharacterIds: preserveCharacterIds.length > 0 ? preserveCharacterIds : undefined,
            currentPageImageUrl: preserveCharacterIds.length > 0 ? currentPageImageUrl : undefined,
        };

        onSubmit(options);
    };

    const handleDownloadOutline = () => {
        const blob = new Blob([outline], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'comic-outline.txt';
        a.click();
        URL.revokeObjectURL(url);
    };

    const selectAllImages = () => setSelectedIds(new Set(allRefImages.map(r => r.id)));
    const selectNoneImages = () => setSelectedIds(new Set());
    const selectAllProfiles = () => setSelectedProfileIds(new Set(availableProfiles.map(p => p.id)));
    const selectNoneProfiles = () => setSelectedProfileIds(new Set());

    const handleImproveInstruction = async () => {
        if (!onImproveText || !instruction.trim()) return;
        setIsImprovingInstruction(true);
        try {
            const improved = await onImproveText(instruction, undefined, 'regeneration_instruction');
            setInstruction(improved);
        } catch (e) {
            console.error('Failed to improve instruction:', e);
        } finally {
            setIsImprovingInstruction(false);
        }
    };

    const handleImproveNegative = async () => {
        if (!onImproveText || !negativePrompt.trim()) return;
        setIsImprovingNegative(true);
        try {
            const improved = await onImproveText(
                `Convert this to a concise negative prompt list (comma-separated items to EXCLUDE from image): ${negativePrompt}`,
                undefined,
                'regeneration_instruction'
            );
            setNegativePrompt(improved);
        } catch (e) {
            console.error('Failed to improve negative prompt:', e);
        } finally {
            setIsImprovingNegative(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="reroll-modal-title">
            <div
                className="bg-white border-0 sm:border-[6px] border-black shadow-none sm:shadow-[8px_8px_0px_rgba(0,0,0,1)] max-w-[750px] w-full max-h-[100dvh] sm:max-h-[90vh] overflow-hidden m-0 sm:m-4 rounded-none sm:rounded-lg relative flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header - sticky */}
                <div className="bg-yellow-400 border-b-[4px] border-black px-3 sm:px-6 py-3 sm:py-4 flex justify-between items-center sticky top-0 z-10 flex-shrink-0">
                    <h2 id="reroll-modal-title" className="font-comic text-base sm:text-lg md:text-2xl font-bold uppercase tracking-wider text-black">
                        🎲 Reroll #{pageIndex}
                    </h2>
                    <div className="flex items-center gap-1 sm:gap-2">
                        {/* History Toggle */}
                        {pageHistory.length > 0 && (
                            <button
                                onClick={() => setShowHistory(!showHistory)}
                                className={`comic-btn ${showHistory ? 'bg-amber-600' : 'bg-amber-500'} text-white min-w-[48px] min-h-[48px] px-2 sm:px-3 py-2 flex items-center justify-center gap-1 font-bold text-xs sm:text-sm border-[3px] border-black hover:opacity-90 touch-manipulation relative`}
                                title={`${pageHistory.length} previous attempts`}
                                aria-label={showHistory ? "Hide history" : "Show history"}
                            >
                                <span className="hidden sm:inline">📜 History</span>
                                <span className="sm:hidden">📜</span>
                                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center border border-black">
                                    {pageHistory.length}
                                </span>
                            </button>
                        )}
                        {/* Tips Toggle */}
                        <button
                            onClick={() => setShowTips(!showTips)}
                            className={`comic-btn ${showTips ? 'bg-green-600' : 'bg-blue-600'} text-white min-w-[48px] min-h-[48px] px-2 sm:px-3 py-2 flex items-center justify-center gap-1 font-bold text-xs sm:text-sm border-[3px] border-black hover:opacity-90 touch-manipulation`}
                            title="Show regeneration tips"
                            aria-label={showTips ? "Hide tips" : "Show tips"}
                        >
                            <span className="hidden sm:inline">💡 Tips</span>
                            <span className="sm:hidden">💡</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="comic-btn bg-red-600 text-white min-w-[48px] min-h-[48px] w-11 h-11 sm:w-10 sm:h-10 flex items-center justify-center font-bold text-xl border-[3px] border-black hover:bg-red-500 touch-manipulation"
                            aria-label="Close reroll modal"
                        >✕</button>
                    </div>
                </div>

                {/* Tips Panel */}
                {showTips && <TipsPanel onClose={() => setShowTips(false)} />}

                {/* History Panel (2.3.2) */}
                {showHistory && pageHistory.length > 0 && (
                    <div className="border-b-4 border-amber-400 bg-amber-50 p-3 sm:p-4">
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="font-comic text-sm sm:text-base font-bold uppercase text-amber-900">
                                📜 Previous Attempts ({pageHistory.length})
                            </h3>
                            <button
                                onClick={() => setShowHistory(false)}
                                className="text-amber-700 hover:text-amber-900 text-xl"
                                aria-label="Close history panel"
                                title="Close history panel"
                            >✕</button>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-2 -webkit-overflow-scrolling-touch">
                            {pageHistory.map((entry, index) => (
                                <div
                                    key={entry.id}
                                    className="flex-shrink-0 border-2 border-amber-400 bg-white rounded overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                                    style={{ width: '100px' }}
                                >
                                    <img
                                        src={entry.imageUrl}
                                        alt={`Attempt ${pageHistory.length - index}`}
                                        className="w-full h-[130px] object-cover"
                                    />
                                    <div className="p-1.5 text-center">
                                        <p className="font-comic text-[10px] text-gray-600 truncate" title={entry.instruction}>
                                            {entry.instruction || 'Full regen'}
                                        </p>
                                        <button
                                            onClick={() => {
                                                onRevert?.(entry.imageUrl, entry);
                                                setShowHistory(false);
                                            }}
                                            disabled={!onRevert}
                                            className="mt-1 w-full comic-btn bg-amber-500 text-white text-[10px] py-1 px-2 border border-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
                                        >
                                            ↩️ Revert
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="mt-2 font-comic text-[10px] text-amber-700 text-center">
                            Click "Revert" to restore a previous version. Max 10 attempts stored.
                        </p>
                    </div>
                )}

                {/* Scrollable content area - 3-ZONE LAYOUT */}
                <div className="flex-1 overflow-y-auto pb-24 sm:pb-5 flex flex-col">

                    {/* CONTEXT PREVIEWS (above zones — display only) */}
                    <div className="p-3 sm:p-4 md:p-5 flex flex-col gap-4">
                        {currentImageUrl && (
                            <CurrentImagePreview
                                imageUrl={currentImageUrl}
                                pageIndex={pageIndex}
                                caption={currentCaption}
                            />
                        )}
                        <ConsistencyPreview
                            characterLocks={characterLocks}
                            profiles={fullProfiles}
                        />
                    </div>

                    {/* ═══ ZONE 1 — Sticky "What to fix?" strip ═══ */}
                    <div className="sticky top-0 z-10 bg-white border-b-[3px] border-black shadow-[0_2px_0px_rgba(0,0,0,0.15)] px-3 sm:px-4 md:px-5 pb-3 pt-1 flex flex-col gap-3">
                        {/* Character Fix Targeting */}
                        {availableProfiles.length >= 2 && (
                            <CharacterFocusSelector
                                characters={availableProfiles}
                                preserveIds={preserveCharacterIds}
                                onToggle={(id) => {
                                    setPreserveCharacterIds(prev =>
                                        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                                    );
                                }}
                            />
                        )}
                        {/* Quick Presets */}
                        <QuickPresets
                            selectedPresetIds={selectedPresetIds}
                            onSelectPreset={handlePresetSelect}
                        />
                    </div>

                    {/* ═══ ZONE 2 — Instruction + Subtle toggle + Submit ═══ */}
                    <div className="p-3 sm:p-4 md:p-5 flex flex-col gap-3">
                        {/* Redrawing and rewriting are different requests. Rerolling used to
                            do both, which silently changed the story and sometimes returned a
                            beat with no dialogue, leaving the page with no speech bubbles. */}
                        <label className="flex items-start gap-2 border-2 border-black bg-amber-50 p-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={regenerateNarrative}
                                onChange={(e) => setRegenerateNarrative(e.target.checked)}
                                className="mt-0.5 w-4 h-4 accent-amber-600"
                            />
                            <span>
                                <span className="font-comic text-xs uppercase text-amber-900 block">Rewrite the words too</span>
                                <span className="font-ui text-[11px] text-gray-700">
                                    Off keeps this page’s caption, dialogue, and choices exactly as they are and only redraws the art. Turn on to generate new text as well.
                                </span>
                            </span>
                        </label>

                        <InstructionInput
                            instruction={instruction}
                            negativePrompt={negativePrompt}
                            selectedLocationId={selectedLocationId}
                            selectedPoseId={selectedPoseId}
                            isImprovingInstruction={isImprovingInstruction}
                            isImprovingNegative={isImprovingNegative}
                            onInstructionChange={setInstruction}
                            onNegativePromptChange={setNegativePrompt}
                            onLocationChange={setSelectedLocationId}
                            onPoseChange={setSelectedPoseId}
                            onImproveInstruction={onImproveText ? handleImproveInstruction : undefined}
                            onImproveNegative={onImproveText ? handleImproveNegative : undefined}
                            hideAdvanced={true}
                        />

                        {/* Subtle change toggle */}
                        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none px-1">
                            <input
                                type="checkbox"
                                checked={strengthValue < 1.0}
                                onChange={e => setStrengthValue(e.target.checked ? 0.4 : 1.0)}
                                className="w-4 h-4 accent-gray-700"
                            />
                            <span className="font-comic">Subtle change <span className="text-gray-400">(keep most of the image)</span></span>
                        </label>

                        {/* Desktop Submit Button */}
                        <button
                            ref={submitRef}
                            onClick={handleSubmit}
                            className="hidden sm:block comic-btn w-full bg-yellow-400 text-black py-4 text-xl md:text-2xl font-bold uppercase tracking-wider border-[4px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:bg-yellow-300 hover:-translate-y-1 transition-transform"
                            aria-label={`Reroll panel ${pageIndex}`}
                        >
                            🎲 Reroll Panel #{pageIndex}
                        </button>
                    </div>

                    {/* ═══ ZONE 3 — ⚙ More options (collapsed) ═══ */}
                    <div className="px-3 sm:px-4 md:px-5 pb-3 sm:pb-5">
                        <details className="border-[3px] border-gray-300 bg-gray-50 group">
                            <summary className="p-3 sm:p-4 cursor-pointer flex justify-between items-center list-none touch-manipulation min-h-[48px]">
                                <p className="font-comic text-sm sm:text-base font-bold uppercase text-gray-700">
                                    ⚙ More Options
                                </p>
                                <span className="text-gray-500 group-open:rotate-180 transition-transform">▼</span>
                            </summary>
                            <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t-2 border-gray-200 flex flex-col gap-4 mt-3">

                                {/* Strength Slider (full control) */}
                                <StrengthSlider
                                    value={strengthValue}
                                    onChange={setStrengthValue}
                                />

                                {/* Negative Prompt + Pose/Location (via InstructionInput in advanced-only mode) */}
                                <InstructionInput
                                    instruction={instruction}
                                    negativePrompt={negativePrompt}
                                    selectedLocationId={selectedLocationId}
                                    selectedPoseId={selectedPoseId}
                                    isImprovingInstruction={false}
                                    isImprovingNegative={isImprovingNegative}
                                    onInstructionChange={setInstruction}
                                    onNegativePromptChange={setNegativePrompt}
                                    onLocationChange={setSelectedLocationId}
                                    onPoseChange={setSelectedPoseId}
                                    onImproveNegative={onImproveText ? handleImproveNegative : undefined}
                                    hideAdvanced={false}
                                />

                                {/* Reference Images */}
                                <ReferenceImageGallery
                                    allRefImages={allRefImages}
                                    selectedIds={selectedIds}
                                    deleteMode={deleteMode}
                                    onToggleImage={toggleImage}
                                    onToggleDeleteMode={() => setDeleteMode(!deleteMode)}
                                    onSelectAll={selectAllImages}
                                    onSelectNone={selectNoneImages}
                                    onDeleteRef={onDeleteRef}
                                    onUploadRef={onUploadRef}
                                />

                                {/* Scene Continuity */}
                                {(prevPageImageUrl || nextPageImageUrl) && (
                                    <div className="border-[3px] border-blue-400 p-3 bg-blue-50 shadow-[3px_3px_0px_rgba(0,0,0,1)]">
                                        <h3 className="font-comic text-sm font-bold uppercase mb-1 text-blue-900">📎 Scene Continuity</h3>
                                        <p className="text-xs text-gray-600 mb-2">
                                            Include adjacent pages as reference. Character faces always come from portraits — these images guide background &amp; setting continuity only.
                                        </p>
                                        <div className="flex flex-col gap-2">
                                            {prevPageImageUrl && (
                                                <label className="flex items-center gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={usePrevPage}
                                                        onChange={e => setUsePrevPage(e.target.checked)}
                                                        className="w-4 h-4 accent-blue-600"
                                                    />
                                                    <img src={prevPageImageUrl} alt="prev page" className="w-14 h-14 object-cover border-2 border-black rounded" />
                                                    <span className="text-sm font-semibold">Previous page (#{pageIndex - 1}) — background &amp; setting reference</span>
                                                </label>
                                            )}
                                            {nextPageImageUrl && (
                                                <label className="flex items-center gap-3 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={useNextPage}
                                                        onChange={e => setUseNextPage(e.target.checked)}
                                                        className="w-4 h-4 accent-blue-600"
                                                    />
                                                    <img src={nextPageImageUrl} alt="next page" className="w-14 h-14 object-cover border-2 border-black rounded" />
                                                    <span className="text-sm font-semibold">Next page (#{pageIndex + 1}) for continuity</span>
                                                </label>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Expert Options (nested in Zone 3) */}
                                <details className="border-[3px] border-purple-400 bg-purple-50 group/expert">
                                    <summary className="p-3 sm:p-4 cursor-pointer flex justify-between items-center list-none touch-manipulation min-h-[48px]">
                                        <p className="font-comic text-sm sm:text-base font-bold uppercase text-purple-800">
                                            🔧 Expert Options
                                        </p>
                                        <span className="text-purple-600 group-open/expert:rotate-180 transition-transform">▼</span>
                                    </summary>
                                    <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t-2 border-purple-200 space-y-4 mt-3">
                                        <ComicFundamentalsOverrides
                                            shotTypeOverride={shotTypeOverride}
                                            balloonShapeOverride={balloonShapeOverride}
                                            applyFlashbackStyle={applyFlashbackStyle}
                                            onShotTypeChange={setShotTypeOverride}
                                            onBalloonShapeChange={setBalloonShapeOverride}
                                            onFlashbackStyleChange={setApplyFlashbackStyle}
                                        />
                                        <ProfileSelector
                                            availableProfiles={availableProfiles}
                                            fullProfiles={fullProfiles}
                                            selectedProfileIds={selectedProfileIds}
                                            onToggleProfile={toggleProfile}
                                            onSelectAll={selectAllProfiles}
                                            onSelectNone={selectNoneProfiles}
                                            onProfileUpdate={onProfileUpdate}
                                            onAnalyzeProfile={onAnalyzeProfile}
                                            onAddNewCharacter={onAddNewCharacter}
                                            showLockToggles={true}
                                        />
                                    </div>
                                </details>

                                {/* Debug Info */}
                                {(outline || originalPrompt) && (
                                    <details className="border-[3px] border-black bg-gray-100 group/debug">
                                        <summary className="p-3 sm:p-4 cursor-pointer flex justify-between items-center list-none touch-manipulation min-h-[48px]">
                                            <p className="font-comic text-sm sm:text-base font-bold uppercase text-gray-600">
                                                🔍 Debug Info
                                            </p>
                                            <span className="text-gray-500 group-open/debug:rotate-180 transition-transform">▼</span>
                                        </summary>
                                        <div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t-2 border-gray-300 space-y-4 mt-3">
                                            {outline && (
                                                <div className="bg-blue-50 border-2 border-blue-200 p-3 rounded">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <p className="font-comic text-sm font-bold text-blue-900">📖 Story Outline</p>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => navigator.clipboard.writeText(outline)} className="text-xs px-2 py-1 bg-blue-500 text-white border border-black rounded hover:bg-blue-400" aria-label="Copy outline">📋</button>
                                                            <button onClick={handleDownloadOutline} className="text-xs px-2 py-1 bg-blue-600 text-white border border-black rounded hover:bg-blue-500" aria-label="Download outline">⬇</button>
                                                        </div>
                                                    </div>
                                                    <pre className="text-xs font-mono bg-white border border-gray-300 p-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-gray-700">{outline}</pre>
                                                </div>
                                            )}
                                            {originalPrompt && (
                                                <div className="bg-gray-50 border-2 border-gray-300 p-3 rounded">
                                                    <div className="flex justify-between items-center mb-2">
                                                        <p className="font-comic text-sm font-bold text-gray-700">🔧 Original Prompt</p>
                                                        <div className="flex gap-2">
                                                            <button
                                                                onClick={async () => {
                                                                    try { await navigator.clipboard.writeText(originalPrompt); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { console.warn('[RerollModal] Clipboard copy failed:', e); }
                                                                }}
                                                                className="comic-btn bg-gray-700 text-white px-2 py-1 text-xs border border-gray-500 hover:bg-gray-600"
                                                                aria-label="Copy original prompt"
                                                            >{copied ? '✓ Copied' : '📋 Copy'}</button>
                                                            <button
                                                                onClick={() => { const blob = new Blob([originalPrompt], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `page-${pageIndex}-prompt.txt`; a.click(); URL.revokeObjectURL(url); }}
                                                                className="text-xs px-2 py-1 bg-gray-600 text-white border border-black rounded hover:bg-gray-500"
                                                                aria-label="Download original prompt"
                                                            >⬇</button>
                                                        </div>
                                                    </div>
                                                    <pre className="text-[10px] font-mono bg-white border border-gray-300 p-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-gray-600">{originalPrompt}</pre>
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </div>
                        </details>
                    </div>
                </div>

                {/* Mobile Sticky Footer with Submit Button */}
                <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t-4 border-black p-3 shadow-[0_-4px_10px_rgba(0,0,0,0.2)] z-20">
                    <button
                        onClick={handleSubmit}
                        className="comic-btn w-full bg-yellow-400 text-black py-4 text-lg font-bold uppercase tracking-wider border-[4px] border-black shadow-[4px_4px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none transition-all touch-manipulation"
                        aria-label={`Reroll panel ${pageIndex}`}
                    >
                        🎲 Reroll #{pageIndex}
                    </button>
                </div>
            </div>
        </div>
    );
};
