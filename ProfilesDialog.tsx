import React, { useRef, useState } from 'react';
import { CharacterProfile, Persona } from './types';
import { ModelSheetStrip, type ModelSheetState } from './components/ModelSheetStrip';
import { validateProfileCompleteness } from './utils/profileValidation';
import { ProfileQualityIndicator } from './components/ProfileQualityIndicator';
import { useCharacterStore } from './stores/useCharacterStore';
import { isProfileOutdated } from './utils/characterFingerprint';

// Bulk import match result
interface BulkMatch {
    uploadedProfile: CharacterProfile;
    localIndex: number | null; // index in profiles[] if matched, null if unmatched
    localName: string | null;
    selected: boolean;
}

interface Props {
    profiles: CharacterProfile[];
    onUpdate: (index: number, updated: CharacterProfile) => void;
    onAnalyze?: (index: number) => Promise<void>;
    onConfirm: () => void;
    onCancel: () => void;
    /**
     * Optional casting step. When supplied, the dialog shows the model-sheet
     * strip so the user can lock in each character's look before generating.
     */
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

const getProfileScore = (profile: CharacterProfile): 'complete' | 'partial' | 'sparse' => {
  const fields = [
    profile.faceDescription,
    profile.bodyType,
    profile.clothing,
    profile.colorPalette,
    profile.distinguishingFeatures,
    profile.identityHeader,
    profile.extractedColors,
    profile.hardNegatives?.length ? profile.hardNegatives : null,
  ];
  const populated = fields.filter(Boolean).length;
  if (populated >= 7) return 'complete';
  if (populated >= 4) return 'partial';
  return 'sparse';
};

export const ProfilesDialog: React.FC<Props> = ({ profiles, onUpdate, onAnalyze, onConfirm, onCancel, modelSheetProps }) => {
    const [analyzingIdx, setAnalyzingIdx] = useState<number | null>(null);
    const [bulkMatches, setBulkMatches] = useState<BulkMatch[] | null>(null);
    const [bulkError, setBulkError] = useState<string | null>(null);
    const bulkFileRef = useRef<HTMLInputElement>(null);

    // Feature D: Character lock state
    const characterLocks = useCharacterStore((state) => state.characterLocks);
    const updateCharacterLock = useCharacterStore((state) => state.updateCharacterLock);

    // The character each profile describes, to tell whether the profile still
    // matches it (see utils/characterFingerprint.ts).
    const hero = useCharacterStore((state) => state.hero);
    const friend = useCharacterStore((state) => state.friend);
    const additionalCharacters = useCharacterStore((state) => state.additionalCharacters);
    const personaFor = (id: string) => [hero, friend, ...additionalCharacters].find(c => c?.id === id) ?? undefined;

    const getLock = (id: string) =>
        characterLocks.get(id) ?? { characterId: id, lockFace: false, lockOutfit: false, lockWeapon: false, lockEmblem: false };

    const handleLockToggle = (id: string, field: 'lockFace' | 'lockOutfit' | 'lockWeapon' | 'lockEmblem') => {
        const current = getLock(id);
        updateCharacterLock(id, { [field]: !current[field] });
    };
    
    const handleDownloadIndividual = (profile: CharacterProfile) => {
        const data = JSON.stringify(profile, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Profile-${profile.name.replace(/\s+/g, '-') || 'Unknown'}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleUploadIndividual = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as CharacterProfile | CharacterProfile[];
                
                // If they uploaded an array (legacy global export) by accident, just grab the first one
                const incoming = Array.isArray(parsed) ? parsed[0] : parsed;
                
                if (incoming && typeof incoming === 'object') {
                    onUpdate(idx, { ...profiles[idx], ...incoming, id: profiles[idx].id, name: profiles[idx].name });
                } else {
                    console.warn('Invalid JSON format. Expected a single character profile.');
                }
            } catch (err) {
                console.error('Failed to parse JSON file.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
    const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBulkError(null);
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string);
                // Support both: { profiles: [...] } and raw array [...]
                const uploaded: CharacterProfile[] = Array.isArray(parsed)
                    ? parsed
                    : Array.isArray(parsed.profiles)
                        ? parsed.profiles
                        : null;

                if (!uploaded || uploaded.length === 0) {
                    setBulkError('No profiles found in the uploaded file.');
                    return;
                }

                // Try to match uploaded profiles to current profiles by name
                const normalize = (n: string) => String(n || '').toLowerCase().trim();
                const matches: BulkMatch[] = uploaded.map(up => {
                    const localIdx = profiles.findIndex(p => normalize(p.name) === normalize(up.name));
                    return {
                        uploadedProfile: up,
                        localIndex: localIdx >= 0 ? localIdx : null,
                        localName: localIdx >= 0 ? profiles[localIdx].name : null,
                        selected: localIdx >= 0 // auto-select matched ones
                    };
                });
                setBulkMatches(matches);
            } catch {
                setBulkError('Invalid JSON file. Please upload a valid profiles export.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const applyBulkImport = () => {
        if (!bulkMatches) return;
        bulkMatches.forEach(match => {
            if (!match.selected) return;
            if (match.localIndex !== null) {
                // Matched: update existing profile, preserve id and name
                onUpdate(match.localIndex, {
                    ...profiles[match.localIndex],
                    ...match.uploadedProfile,
                    id: profiles[match.localIndex].id,
                    name: profiles[match.localIndex].name
                });
            }
            // Unmatched profiles (localIndex === null) cannot be applied since there's no target slot
        });
        setBulkMatches(null);
    };

    return (
        <div className="fixed inset-0 z-[500] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
            <div className="max-w-[800px] w-full max-h-[90vh] bg-white border-[6px] border-black p-6 shadow-[12px_12px_0px_rgba(0,0,0,0.5)] flex flex-col">
                <div className="flex justify-between items-end mb-4 border-b-4 border-black pb-2">
                    <div>
                        <h2 className="font-comic text-4xl text-purple-600 uppercase tracking-tighter">Character Profiles</h2>
                        <p className="font-comic text-sm text-gray-600 mt-1">Review and heavily edit the AI's understanding of your characters before generating!</p>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* Import All */}
                        <label
                            className="comic-btn bg-blue-600 text-white text-xs px-3 py-2 font-bold border-2 border-black hover:bg-blue-500 uppercase flex items-center gap-1 shrink-0 cursor-pointer"
                            title="Import all profiles from a previously exported JSON file"
                            aria-label="Import all character profiles from JSON file"
                        >
                            ⬆️ Import All
                            <input
                                ref={bulkFileRef}
                                type="file"
                                accept=".json,application/json"
                                className="hidden"
                                onChange={handleBulkUpload}
                            />
                        </label>

                        {/* Export All */}
                        <button
                            onClick={() => {
                                const exportData = {
                                    exportDate: new Date().toISOString(),
                                    profiles: profiles.map(p => ({
                                        ...p,
                                        referenceImages: undefined
                                    }))
                                };
                                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                                const url = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `character-profiles-debug-${Date.now()}.json`;
                                a.click();
                                URL.revokeObjectURL(url);
                            }}
                            className="comic-btn bg-gray-700 text-white text-xs px-3 py-2 font-bold border-2 border-black hover:bg-gray-600 uppercase flex items-center gap-1 shrink-0"
                            title="Export all profiles as JSON"
                            aria-label="Export all character profiles as JSON"
                        >
                            <span>⬇️ Export All</span>
                        </button>
                    </div>
                </div>

                {profiles.some(p => validateProfileCompleteness(p).score < 50) && (
                    <div className="bg-yellow-100 border-2 border-yellow-600 rounded p-3 mb-4">
                        <p className="text-yellow-800 text-sm font-comic">
                            <span className="font-bold">Warning:</span> Some character profiles are incomplete. This may cause inconsistent character appearance across pages.
                        </p>
                    </div>
                )}

                {modelSheetProps && <ModelSheetStrip {...modelSheetProps} />}

                <div className="overflow-y-auto flex-1 pr-2 space-y-6">
                    {profiles.map((p, idx) => {
                        const profileQuality = validateProfileCompleteness(p);
                        const isFilled = String(p.faceDescription || '').trim() !== '' || String(p.clothing || '').trim() !== '';
                        const btnText = isFilled ? "REANALYZE" : "ANALYZE";

                        if (profileQuality.score < 80) {
                            console.debug('[ProfilesDialog] Low quality profile:', p.name, 'score:', profileQuality.score, 'missing:', profileQuality.missingFields);
                        }

                        return (
                        <div key={p.id} className="border-4 border-black p-4 bg-gray-50 flex flex-col gap-3">
                            {p.analysisFailed ? (
                                <div className="bg-red-100 border-2 border-red-400 px-3 py-2 mb-2 text-sm text-red-800 rounded flex items-center gap-2 font-comic" role="alert">
                                    Analysis failed for this character. Press ANALYZE to retry, or fill in the profile yourself.
                                </div>
                            ) : (() => {
                                const persona = personaFor(p.id);
                                return persona && isProfileOutdated(p, persona);
                            })() && (
                                <div className="bg-yellow-100 border-2 border-yellow-400 px-3 py-2 mb-2 text-sm text-yellow-800 rounded flex items-center gap-2 font-comic">
                                    This character changed since the profile was made. Re-analyze to refresh it.
                                </div>
                            )}

                            {/* Profile Quality Warning Banner */}
                            {profileQuality.score < 80 && (
                                <div className={`border-2 rounded p-3 ${profileQuality.score < 50 ? 'bg-yellow-100 border-yellow-500' : 'bg-blue-50 border-blue-300'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2">
                                            <span className={`text-lg ${profileQuality.score < 50 ? 'text-yellow-600' : 'text-blue-500'}`}>
                                                {profileQuality.score < 50 ? '!' : 'ℹ'}
                                            </span>
                                            <div>
                                                <p className={`font-comic text-sm font-bold mb-1 ${profileQuality.score < 50 ? 'text-yellow-800' : 'text-blue-800'}`}>
                                                    Profile Completeness: {profileQuality.score}%
                                                    {profileQuality.score >= 50 && ' — fill in missing fields below to improve'}
                                                </p>
                                                <ul className={`text-xs space-y-0.5 ${profileQuality.score < 50 ? 'text-yellow-700' : 'text-blue-700'}`}>
                                                    {profileQuality.warnings.map((warning, i) => (
                                                        <li key={i}>- {warning}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                        {onAnalyze && (
                                            <button
                                                onClick={async () => {
                                                    setAnalyzingIdx(idx);
                                                    await onAnalyze(idx);
                                                    setAnalyzingIdx(null);
                                                }}
                                                disabled={analyzingIdx === idx}
                                                className="bg-yellow-600 hover:bg-yellow-500 px-3 py-1 rounded text-sm flex items-center gap-1 font-comic font-bold text-white border-2 border-black disabled:opacity-50 transition-colors shrink-0"
                                            >
                                                {analyzingIdx === idx ? 'Analyzing...' : 'Re-Analyze Profile'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="flex justify-between items-start border-b-2 border-black pb-1 mb-2">
                                <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-3">
                                        <h3 className="font-comic text-2xl font-bold uppercase text-blue-800">{p.name || 'Unknown'}</h3>
                                        {(() => {
                                          const score = getProfileScore(p);
                                          const dot = score === 'complete' ? '🟢' : score === 'partial' ? '🟡' : '🔴';
                                          const label = score === 'complete' ? 'Complete' : score === 'partial' ? 'Partial' : 'Sparse';
                                          return (
                                            <span className="ml-2 text-xs" title={`Profile: ${label}`}>{dot}</span>
                                          );
                                        })()}
                                        <ProfileQualityIndicator profile={p} />
                                        {profileQuality.score < 80 && (
                                            <span
                                                className="text-[10px] font-comic text-orange-600 font-bold cursor-default"
                                                title={`Profile could be improved. Missing: ${profileQuality.missingFields.join(', ')}`}
                                            >
                                                ↗ Improve
                                            </span>
                                        )}
                                    </div>
                                    {/* Feature D: Lock toggles */}
                                    {(() => {
                                        const lock = getLock(p.id);
                                        return (
                                            <div className="flex flex-wrap gap-1 items-center">
                                                <span className="font-comic text-[10px] text-gray-400 uppercase mr-1">Lock:</span>
                                                {[
                                                    { key: 'lockFace' as const, icon: '😊', label: 'Face' },
                                                    { key: 'lockOutfit' as const, icon: '⭐', label: 'Outfit' },
                                                    { key: 'lockEmblem' as const, icon: '🔰', label: 'Emblem' },
                                                    { key: 'lockWeapon' as const, icon: '⚔️', label: 'Weapon' },
                                                ].map(({ key, icon, label }) => (
                                                    <button
                                                        key={key}
                                                        onClick={() => handleLockToggle(p.id, key)}
                                                        className={`flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold font-comic border-2 rounded-sm touch-manipulation transition-colors ${
                                                            lock[key]
                                                                ? 'bg-blue-600 border-blue-800 text-white'
                                                                : 'bg-white border-gray-300 text-gray-400 hover:border-blue-400'
                                                        }`}
                                                        title={lock[key] ? `Unlock ${label} — allow changes` : `Lock ${label} — freeze as immutable constraint`}
                                                        aria-pressed={lock[key]}
                                                        aria-label={`${lock[key] ? 'Unlock' : 'Lock'} ${p.name}'s ${label}`}
                                                    >
                                                        <span>{icon}</span>
                                                        <span>{lock[key] ? '🔒' : '🔓'}</span>
                                                        <span>{label}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleDownloadIndividual(p)}
                                        className="comic-btn bg-yellow-400 text-black text-[10px] px-2 py-1 font-bold border-2 border-black hover:bg-yellow-300 uppercase hidden sm:block"
                                        title="Download this character's profile as JSON"
                                        aria-label={`Download ${p.name || 'character'} profile as JSON`}
                                    >⬇️ JSON</button>
                                    <label
                                        className="comic-btn bg-blue-500 text-white text-[10px] px-2 py-1 font-bold border-2 border-black hover:bg-blue-400 uppercase cursor-pointer hidden sm:block"
                                        title={`Upload ${p.name || 'character'} profile from JSON`}
                                        aria-label={`Upload ${p.name || 'character'} profile from JSON`}
                                    >
                                        ⬆️ JSON
                                        <input
                                            type="file"
                                            accept=".json,application/json"
                                            className="hidden"
                                            onChange={(e) => handleUploadIndividual(idx, e)}
                                        />
                                    </label>
                                    {onAnalyze && (
                                        <button 
                                            onClick={async () => {
                                               setAnalyzingIdx(idx); 
                                               await onAnalyze(idx); 
                                               setAnalyzingIdx(null);
                                            }}
                                            disabled={analyzingIdx === idx}
                                            className="bg-blue-600 text-white font-comic text-xs font-bold px-3 py-1 border-2 border-black hover:bg-blue-500 disabled:opacity-50 transition-colors"
                                        >
                                            {analyzingIdx === idx ? 'ANALYZING...' : btnText}
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase">Face Description</label>
                                    <textarea
                                        className="w-full p-2 border-2 border-black font-comic text-sm h-24 resize-none"
                                        value={p.faceDescription}
                                        onChange={e => onUpdate(idx, { ...p, faceDescription: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase">Body Type</label>
                                    <textarea
                                        className="w-full p-2 border-2 border-black font-comic text-sm h-24 resize-none"
                                        value={p.bodyType}
                                        onChange={e => onUpdate(idx, { ...p, bodyType: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase">Clothing & Armor</label>
                                    <textarea
                                        className="w-full p-2 border-2 border-black font-comic text-sm h-24 resize-none"
                                        value={p.clothing}
                                        onChange={e => onUpdate(idx, { ...p, clothing: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase">Color Palette</label>
                                    <textarea
                                        className="w-full p-2 border-2 border-black font-comic text-sm h-24 resize-none"
                                        value={p.colorPalette}
                                        onChange={e => onUpdate(idx, { ...p, colorPalette: e.target.value })}
                                    />
                                </div>
                                <div className="md:col-span-2">
                                    <label className="font-comic text-xs font-bold text-gray-700 uppercase">Distinguishing Features (Scars, Tattoos, Aura)</label>
                                    <textarea
                                        className="w-full p-2 border-2 border-black font-comic text-sm h-16 resize-none"
                                        value={p.distinguishingFeatures}
                                        onChange={e => onUpdate(idx, { ...p, distinguishingFeatures: e.target.value })}
                                    />
                                </div>

                                {/* Mask Description */}
                                <div>
                                    <label className="font-comic text-xs font-bold text-purple-700 uppercase flex items-center gap-1">
                                        🎭 Mask Description
                                        <span className="text-[9px] text-gray-500 font-normal normal-case">(if worn)</span>
                                    </label>
                                    <textarea
                                        className="w-full p-2 border-2 border-purple-400 font-comic text-sm h-20 resize-none bg-purple-50"
                                        value={p.maskDescription || ''}
                                        onChange={e => onUpdate(idx, { ...p, maskDescription: e.target.value })}
                                        placeholder="e.g., Full face mask with white eye lenses, black with web pattern..."
                                    />
                                </div>

                                {/* Emblem/Logo Description */}
                                <div>
                                    <label className="font-comic text-xs font-bold text-amber-700 uppercase flex items-center gap-1">
                                        ⭐ Emblem / Logo
                                        <span className="text-[9px] text-gray-500 font-normal normal-case">(chest symbol, etc.)</span>
                                    </label>
                                    <textarea
                                        className="w-full p-2 border-2 border-amber-400 font-comic text-sm h-20 resize-none bg-amber-50"
                                        value={p.emblemDescription || ''}
                                        onChange={e => onUpdate(idx, { ...p, emblemDescription: e.target.value })}
                                        placeholder="e.g., Red spider emblem on chest, golden S-shield on center of chest..."
                                    />
                                </div>

                                {/* Weapon Description */}
                                <div className="md:col-span-2">
                                    <label className="font-comic text-xs font-bold text-red-700 uppercase flex items-center gap-1">
                                        ⚔️ Signature Weapon
                                        <span className="text-[9px] text-gray-500 font-normal normal-case">(if any)</span>
                                    </label>
                                    <textarea
                                        className="w-full p-2 border-2 border-red-400 font-comic text-sm h-16 resize-none bg-red-50"
                                        value={p.weaponDescription || ''}
                                        onChange={e => onUpdate(idx, { ...p, weaponDescription: e.target.value })}
                                        placeholder="e.g., Glowing green energy sword, red and gold trident with ornate engravings..."
                                    />
                                </div>

                                {/* Hard Negatives / Things to Avoid */}
                                <div className="md:col-span-2">
                                    <label className="font-comic text-xs font-bold text-gray-600 uppercase flex items-center gap-1">
                                        🚫 Avoid in Generation
                                        <span className="text-[9px] text-gray-500 font-normal normal-case">(comma-separated)</span>
                                    </label>
                                    <textarea
                                        className="w-full p-2 border-2 border-gray-400 font-comic text-sm h-16 resize-none bg-gray-100"
                                        value={(p.hardNegatives || []).join(', ')}
                                        onChange={e => {
                                            const negatives = e.target.value
                                                .split(',')
                                                .map(s => s.trim())
                                                .filter(s => s.length > 0);
                                            onUpdate(idx, { ...p, hardNegatives: negatives });
                                        }}
                                        placeholder="e.g., no glasses, no beard, no cape, avoid purple color, never show without mask..."
                                    />
                                    <p className="text-[9px] text-gray-400 mt-1 font-comic">
                                        Specify things the AI should NEVER include when generating this character.
                                    </p>
                                </div>
                            </div>
                        </div>
                        );
                    })}
                    {profiles.length === 0 && (
                        <p className="font-comic text-center p-8 bg-gray-200 border-2 border-black">No characters found to parse.</p>
                    )}
                </div>

                <div className="mt-6 flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={onCancel}
                        className="comic-btn bg-red-600 text-white px-6 py-3 font-bold border-[3px] border-black hover:bg-red-500 uppercase flex-none"
                    >
                        CANCEL
                    </button>
                    <button
                        onClick={onConfirm}
                        className="comic-btn flex-1 bg-green-600 text-white px-6 py-3 font-bold border-[3px] border-black hover:bg-green-500 uppercase text-xl"
                    >
                        APPROVE & START BOOK
                    </button>
                </div>
            </div>

            {/* Bulk Import Selection Modal */}
            {bulkMatches && (
                <div className="fixed inset-0 z-[600] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white border-[6px] border-black max-w-lg w-full max-h-[80vh] flex flex-col shadow-[10px_10px_0px_rgba(0,0,0,0.5)]">
                        <div className="bg-blue-600 border-b-4 border-black px-4 py-3 flex items-center justify-between">
                            <div>
                                <h3 className="font-comic text-white text-xl font-bold uppercase">Import Profiles</h3>
                                <p className="font-comic text-blue-100 text-xs">Select which profiles to import. Matched profiles will overwrite existing data.</p>
                            </div>
                            <button onClick={() => setBulkMatches(null)} className="text-white hover:text-gray-200 text-xl font-bold ml-2" aria-label="Close import dialog" title="Close import dialog">✕</button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-4 space-y-3">
                            {bulkMatches.map((match, idx) => (
                                <div
                                    key={idx}
                                    className={`border-2 p-3 ${match.localIndex !== null ? 'border-green-400 bg-green-50' : 'border-orange-400 bg-orange-50'}`}
                                >
                                    <label className="flex items-start gap-3 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={match.selected}
                                            disabled={match.localIndex === null}
                                            onChange={e => {
                                                setBulkMatches(prev => prev!.map((m, i) =>
                                                    i === idx ? { ...m, selected: e.target.checked } : m
                                                ));
                                            }}
                                            className="w-5 h-5 mt-0.5 accent-blue-600 shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-comic text-sm font-bold">{match.uploadedProfile.name || 'Unnamed'}</span>
                                                {match.localIndex !== null ? (
                                                    <span className="text-[10px] font-comic bg-green-500 text-white px-1.5 py-0.5 rounded">
                                                        ✓ Matches &ldquo;{match.localName}&rdquo;
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] font-comic bg-orange-500 text-white px-1.5 py-0.5 rounded">
                                                        ⚠ No matching character
                                                    </span>
                                                )}
                                            </div>
                                            {match.uploadedProfile.faceDescription && (
                                                <p className="font-comic text-xs text-gray-500 mt-0.5 truncate">{match.uploadedProfile.faceDescription}</p>
                                            )}
                                            {match.localIndex === null && (
                                                <p className="font-comic text-xs text-orange-600 mt-0.5">
                                                    Cannot import — no character named &ldquo;{match.uploadedProfile.name}&rdquo; in the current session.
                                                </p>
                                            )}
                                        </div>
                                    </label>
                                </div>
                            ))}
                        </div>

                        <div className="border-t-2 border-gray-200 p-4 flex gap-3">
                            <button
                                onClick={applyBulkImport}
                                disabled={!bulkMatches.some(m => m.selected && m.localIndex !== null)}
                                className="flex-1 comic-btn bg-green-600 text-white px-4 py-2.5 font-bold border-[3px] border-black hover:bg-green-500 uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                ✓ Apply Selected ({bulkMatches.filter(m => m.selected && m.localIndex !== null).length})
                            </button>
                            <button
                                onClick={() => setBulkMatches(null)}
                                className="comic-btn bg-gray-400 text-white px-4 py-2.5 font-bold border-[3px] border-black hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Bulk upload error toast */}
            {bulkError && (
                <div className="fixed bottom-4 right-4 z-[700] bg-red-600 text-white font-comic text-sm px-4 py-3 border-2 border-black shadow-lg max-w-xs">
                    ❌ {bulkError}
                    <button onClick={() => setBulkError(null)} className="ml-2 font-bold hover:text-red-200" aria-label="Dismiss error" title="Dismiss error">✕</button>
                </div>
            )}
        </div>
    );
};
