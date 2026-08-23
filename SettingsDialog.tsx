import React, { useState, useEffect } from 'react';
import { galleryDeleteAll } from './hooks/useGalleryDB';
import { useMetricsStore, formatCost } from './stores/useMetricsStore';
import { useSettingsStore } from './stores/useSettingsStore';

interface Props {
    serverKeyExists: boolean;
    anthropicServerKeyExists: boolean;
    adminPasswordHash: string; // The compiled ADMIN_PASSWORD from .env
    onClose: () => void;
    onKeyChange: (geminiKey: string | null, anthropicKey: string | null, isAdmin: boolean) => void;
    onOpenHelp?: () => void;
    onOpenFullGuide?: () => void;
}

export const SettingsDialog: React.FC<Props> = ({ serverKeyExists, anthropicServerKeyExists, adminPasswordHash, onClose, onKeyChange, onOpenHelp, onOpenFullGuide }) => {
    const [userKey, setUserKey] = useState(localStorage.getItem('user_api_key') || '');
    const [anthropicKey, setAnthropicKey] = useState(localStorage.getItem('user_anthropic_api_key') || '');
    const [adminPassword, setAdminPassword] = useState('');
    const [isAdmin, setIsAdmin] = useState(localStorage.getItem('is_admin') === 'true');
    const [showKey, setShowKey] = useState(false);
    const [showAnthropicKey, setShowAnthropicKey] = useState(false);
    const [saveMsg, setSaveMsg] = useState('');
    const [geminiStatus, setGeminiStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [claudeStatus, setClaudeStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [geminiError, setGeminiError] = useState('');
    const [claudeError, setClaudeError] = useState('');

    const handleSaveGeminiKey = async () => {
        const trimmed = userKey.trim();
        setGeminiError('');

        if (!trimmed) {
            localStorage.removeItem('user_api_key');
            onKeyChange(null, anthropicKey.trim() || null, false);
            setGeminiStatus('success');
            setSaveMsg('Gemini key cleared.');
            setTimeout(() => { setSaveMsg(''); setGeminiStatus('idle'); }, 2000);
            return;
        }

        // Basic format validation
        if (!trimmed.startsWith('AIza') || trimmed.length < 30) {
            setGeminiStatus('error');
            setGeminiError('Invalid format. Gemini keys start with "AIza" and are ~39 characters.');
            setTimeout(() => setGeminiStatus('idle'), 4000);
            return;
        }

        // Test the key with a minimal API call
        setGeminiStatus('saving');
        try {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${trimmed}`);
            if (response.ok) {
                localStorage.setItem('user_api_key', trimmed);
                onKeyChange(trimmed, anthropicKey.trim() || null, false);
                setGeminiStatus('success');
                setSaveMsg('✓ Gemini key verified and saved!');
                setTimeout(() => { setSaveMsg(''); setGeminiStatus('idle'); }, 3000);
            } else {
                const data = await response.json().catch(() => ({}));
                setGeminiStatus('error');
                setGeminiError(data?.error?.message || `API error: ${response.status}`);
                setTimeout(() => setGeminiStatus('idle'), 5000);
            }
        } catch (e: any) {
            setGeminiStatus('error');
            setGeminiError('Network error. Key saved locally but not verified.');
            localStorage.setItem('user_api_key', trimmed);
            onKeyChange(trimmed, anthropicKey.trim() || null, false);
            setTimeout(() => setGeminiStatus('idle'), 4000);
        }
    };

    const handleSaveAnthropicKey = async () => {
        const trimmed = anthropicKey.trim();
        setClaudeError('');

        if (!trimmed) {
            localStorage.removeItem('user_anthropic_api_key');
            onKeyChange(userKey.trim() || null, null, false);
            setClaudeStatus('success');
            setSaveMsg('Claude key cleared.');
            setTimeout(() => { setSaveMsg(''); setClaudeStatus('idle'); }, 2000);
            return;
        }

        // Basic format validation
        if (!trimmed.startsWith('sk-ant-') || trimmed.length < 40) {
            setClaudeStatus('error');
            setClaudeError('Invalid format. Claude keys start with "sk-ant-" and are longer.');
            setTimeout(() => setClaudeStatus('idle'), 4000);
            return;
        }

        // Test the key with a minimal API call
        setClaudeStatus('saving');
        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': trimmed,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 1,
                    messages: [{ role: 'user', content: 'Hi' }]
                })
            });

            if (response.ok || response.status === 200) {
                localStorage.setItem('user_anthropic_api_key', trimmed);
                onKeyChange(userKey.trim() || null, trimmed, false);
                setClaudeStatus('success');
                setSaveMsg('✓ Claude key verified and saved!');
                setTimeout(() => { setSaveMsg(''); setClaudeStatus('idle'); }, 3000);
            } else {
                const data = await response.json().catch(() => ({ error: { message: '' } }));
                if (response.status === 401) {
                    setClaudeStatus('error');
                    setClaudeError(data?.error?.message || 'Invalid API key. Please check and try again.');
                } else {
                    // Other errors might mean the key is valid but there's a usage issue
                    localStorage.setItem('user_anthropic_api_key', trimmed);
                    onKeyChange(userKey.trim() || null, trimmed, false);
                    setClaudeStatus('success');
                    setSaveMsg('✓ Claude key saved! (Could not fully verify)');
                    setTimeout(() => { setSaveMsg(''); setClaudeStatus('idle'); }, 3000);
                }
                if (response.status === 401) {
                    setTimeout(() => setClaudeStatus('idle'), 5000);
                }
            }
        } catch (e: any) {
            // CORS or network error - save anyway since we can't test from browser
            localStorage.setItem('user_anthropic_api_key', trimmed);
            onKeyChange(userKey.trim() || null, trimmed, false);
            setClaudeStatus('success');
            setSaveMsg('✓ Claude key saved! (Browser cannot verify)');
            setTimeout(() => { setSaveMsg(''); setClaudeStatus('idle'); }, 3000);
        }
    };

    const handleAdminLogin = () => {
        if (!adminPasswordHash) {
            setSaveMsg('No admin password configured.');
            setTimeout(() => setSaveMsg(''), 2000);
            return;
        }
        if (adminPassword === adminPasswordHash) {
            localStorage.setItem('is_admin', 'true');
            setIsAdmin(true);
            onKeyChange(null, null, true);
            setSaveMsg('Admin access granted!');
        } else {
            setSaveMsg('Wrong password.');
        }
        setTimeout(() => setSaveMsg(''), 2000);
        setAdminPassword('');
    };

    const handleAdminLogout = () => {
        localStorage.removeItem('is_admin');
        setIsAdmin(false);
        onKeyChange(userKey.trim() || null, anthropicKey.trim() || null, false);
        setSaveMsg('Admin signed out.');
        setTimeout(() => setSaveMsg(''), 2000);
    };

    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const [consistencyOpen, setConsistencyOpen] = useState(false);

    // Consistency Settings (Feature E)
    const consistencyStrength = useSettingsStore(s => s.consistencyStrength);
    const reAnchorEveryN = useSettingsStore(s => s.reAnchorEveryN);
    const autoCharacterAnalysis = useSettingsStore(s => s.autoCharacterAnalysis);
    const referenceImagePriority = useSettingsStore(s => s.referenceImagePriority);
    const setConsistencyStrength = useSettingsStore(s => s.setConsistencyStrength);

    // Consistency and generation settings added alongside the model-sheet work.
    // These shipped without controls and could only be changed by editing
    // localStorage, which meant their defaults were the only values in use.
    const useModelSheets = useSettingsStore(s => s.useModelSheets);
    const setUseModelSheets = useSettingsStore(s => s.setUseModelSheets);
    const sceneContinuityImages = useSettingsStore(s => s.sceneContinuityImages);
    const setSceneContinuityImages = useSettingsStore(s => s.setSceneContinuityImages);
    const useCoverAsStyleReference = useSettingsStore(s => s.useCoverAsStyleReference);
    const setUseCoverAsStyleReference = useSettingsStore(s => s.setUseCoverAsStyleReference);
    const qaAutoReroll = useSettingsStore(s => s.qaAutoReroll);
    const setQaAutoReroll = useSettingsStore(s => s.setQaAutoReroll);
    const qaThreshold = useSettingsStore(s => s.qaThreshold);
    const setQaThreshold = useSettingsStore(s => s.setQaThreshold);
    const imageResolution = useSettingsStore(s => s.imageResolution);
    const setImageResolution = useSettingsStore(s => s.setImageResolution);
    const maxConcurrentPages = useSettingsStore(s => s.maxConcurrentPages);
    const setMaxConcurrentPages = useSettingsStore(s => s.setMaxConcurrentPages);
    const promptMode = useSettingsStore(s => s.promptMode);
    const setPromptMode = useSettingsStore(s => s.setPromptMode);
    const [generationOpen, setGenerationOpen] = useState(false);
    const setReAnchorEveryN = useSettingsStore(s => s.setReAnchorEveryN);
    const setAutoCharacterAnalysis = useSettingsStore(s => s.setAutoCharacterAnalysis);
    const setReferenceImagePriority = useSettingsStore(s => s.setReferenceImagePriority);

    const STRENGTH_LEVELS = [
        { value: 0.3, label: 'Minimal', desc: 'Allow creative drift' },
        { value: 0.5, label: 'Moderate', desc: 'Balanced' },
        { value: 0.7, label: 'Strong', desc: 'Enforce details' },
        { value: 1.0, label: 'Maximum', desc: 'Lock everything' },
    ];
    const currentStrengthLevel = STRENGTH_LEVELS.reduce((prev, curr) =>
        Math.abs(curr.value - consistencyStrength) < Math.abs(prev.value - consistencyStrength) ? curr : prev
    );

    // Live metrics
    const totalGenerations = useMetricsStore(s => s.totalGenerations);
    const liveCost = useMetricsStore(s => s.getEstimatedCost());
    const generationsByType = useMetricsStore(s => s.generationsByType);
    const isLive = totalGenerations > 0;

    const handleResetApp = async () => {
        setIsResetting(true);
        try {
            // Clear all localStorage keys
            localStorage.clear();
            // Clear IndexedDB gallery
            await galleryDeleteAll();
            // Reload the app cleanly
            window.location.reload();
        } catch (e) {
            console.error('Reset failed:', e);
            localStorage.clear();
            window.location.reload();
        }
    };

    return (
        <div className="fixed inset-0 z-[600] bg-black/85 backdrop-blur-md flex items-center justify-center p-4" onClick={onClose}>
            <div 
                className="max-w-[500px] w-full bg-white border-[6px] border-black shadow-[10px_10px_0px_rgba(0,0,0,0.6)] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gray-900 border-b-[4px] border-black px-6 py-3 flex justify-between items-center">
                    <h2 className="font-comic text-2xl text-white uppercase tracking-wider">⚙️ Settings</h2>
                    <button
                        onClick={onClose}
                        className="comic-btn bg-red-600 text-white w-10 h-10 flex items-center justify-center font-bold text-xl border-[3px] border-black hover:bg-red-500"
                        aria-label="Close settings"
                        title="Close settings"
                    >✕</button>
                </div>

                <div className="p-5 flex flex-col gap-5">
                    {/* Status Banner */}
                    {isAdmin && (
                        <div className="bg-green-100 border-[3px] border-green-600 p-3 flex items-center justify-between">
                            <span className="font-comic text-green-800 font-bold text-sm">🔓 ADMIN MODE ACTIVE — Using server API key</span>
                            <button 
                                onClick={handleAdminLogout}
                                className="comic-btn bg-red-500 text-white text-xs px-3 py-1 border-[2px] border-black hover:bg-red-400 font-bold"
                            >Sign Out</button>
                        </div>
                    )}

                    {/* User API Key */}
                    <div className="border-[3px] border-black bg-blue-50 p-4">
                        <p className="font-comic text-sm font-bold uppercase text-blue-900 mb-2">🔑 Your Gemini API Key</p>
                        <p className="font-comic text-xs text-gray-600 mb-3">
                            Get a free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">Google AI Studio</a>
                        </p>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    value={userKey}
                                    onChange={e => { setUserKey(e.target.value); setGeminiStatus('idle'); setGeminiError(''); }}
                                    placeholder="AIzaSy..."
                                    className={`w-full px-3 py-2 border-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 pr-10 ${
                                        geminiStatus === 'error' ? 'border-red-500 bg-red-50' :
                                        geminiStatus === 'success' ? 'border-green-500 bg-green-50' : 'border-black'
                                    }`}
                                />
                                <button
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black text-sm"
                                    type="button"
                                >{showKey ? '🙈' : '👁️'}</button>
                            </div>
                            <button
                                onClick={handleSaveGeminiKey}
                                disabled={geminiStatus === 'saving'}
                                className={`comic-btn text-white px-4 py-2 font-bold text-sm border-[2px] border-black min-w-[70px] ${
                                    geminiStatus === 'saving' ? 'bg-gray-400 cursor-wait' :
                                    geminiStatus === 'success' ? 'bg-green-600 hover:bg-green-500' :
                                    geminiStatus === 'error' ? 'bg-red-600 hover:bg-red-500' :
                                    'bg-blue-600 hover:bg-blue-500'
                                }`}
                            >
                                {geminiStatus === 'saving' ? '...' :
                                 geminiStatus === 'success' ? '✓' :
                                 geminiStatus === 'error' ? '✗' : 'SAVE'}
                            </button>
                        </div>
                        {geminiError && (
                            <p className="font-comic text-xs text-red-600 mt-2 bg-red-100 border border-red-300 p-2 rounded">
                                ⚠️ {geminiError}
                            </p>
                        )}
                    </div>

                    {/* Anthropic/Claude API Key */}
                    <div className="border-[3px] border-black bg-amber-50 p-4">
                        <p className="font-comic text-sm font-bold uppercase text-amber-900 mb-2">🤖 Claude API Key (Anthropic)</p>
                        <p className="font-comic text-xs text-gray-600 mb-3">
                            Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-amber-600 underline">Anthropic Console</a>
                            {' '}<span className="text-gray-400">(Optional - used for text analysis)</span>
                        </p>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    type={showAnthropicKey ? 'text' : 'password'}
                                    value={anthropicKey}
                                    onChange={e => { setAnthropicKey(e.target.value); setClaudeStatus('idle'); setClaudeError(''); }}
                                    placeholder="sk-ant-api03-..."
                                    className={`w-full px-3 py-2 border-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 pr-10 ${
                                        claudeStatus === 'error' ? 'border-red-500 bg-red-50' :
                                        claudeStatus === 'success' ? 'border-green-500 bg-green-50' : 'border-black'
                                    }`}
                                />
                                <button
                                    onClick={() => setShowAnthropicKey(!showAnthropicKey)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black text-sm"
                                    type="button"
                                >{showAnthropicKey ? '🙈' : '👁️'}</button>
                            </div>
                            <button
                                onClick={handleSaveAnthropicKey}
                                disabled={claudeStatus === 'saving'}
                                className={`comic-btn text-white px-4 py-2 font-bold text-sm border-[2px] border-black min-w-[70px] ${
                                    claudeStatus === 'saving' ? 'bg-gray-400 cursor-wait' :
                                    claudeStatus === 'success' ? 'bg-green-600 hover:bg-green-500' :
                                    claudeStatus === 'error' ? 'bg-red-600 hover:bg-red-500' :
                                    'bg-amber-600 hover:bg-amber-500'
                                }`}
                            >
                                {claudeStatus === 'saving' ? '...' :
                                 claudeStatus === 'success' ? '✓' :
                                 claudeStatus === 'error' ? '✗' : 'SAVE'}
                            </button>
                        </div>
                        {claudeError && (
                            <p className="font-comic text-xs text-red-600 mt-2 bg-red-100 border border-red-300 p-2 rounded">
                                ⚠️ {claudeError}
                            </p>
                        )}
                        <p className="font-comic text-[10px] text-gray-500 mt-2">
                            Claude handles: character profiles, outlines, story beats. Gemini handles: image generation.
                        </p>
                    </div>

                    {/* Admin Sign-In */}
                    {!isAdmin && (
                        <div className="border-[3px] border-black bg-purple-50 p-4">
                            <p className="font-comic text-sm font-bold uppercase text-purple-900 mb-2">🛡️ Admin Sign-In</p>
                            <p className="font-comic text-xs text-gray-600 mb-3">
                                Sign in to use the server's built-in API key automatically.
                            </p>
                            <div className="flex gap-2">
                                <input 
                                    type="password"
                                    value={adminPassword}
                                    onChange={e => setAdminPassword(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
                                    placeholder="Enter admin password..."
                                    className="flex-1 px-3 py-2 border-2 border-black font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                                />
                                <button 
                                    onClick={handleAdminLogin}
                                    className="comic-btn bg-purple-600 text-white px-4 py-2 font-bold text-sm border-[2px] border-black hover:bg-purple-500"
                                >LOGIN</button>
                            </div>
                        </div>
                    )}

                    {/* Live API Cost */}
                    <div className="border-[3px] border-purple-400 bg-purple-50 p-4">
                        <div className="flex items-center justify-between mb-1">
                            <p className="font-comic text-sm font-bold uppercase text-purple-800">💰 API Cost This Session</p>
                            {isLive && (
                                <span className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">
                                    <span className="animate-pulse">●</span> LIVE
                                </span>
                            )}
                        </div>
                        {isLive ? (
                            <>
                                <p className="font-comic text-2xl font-bold text-purple-700 mb-2"
                                   style={{ fontFamily: "'Bangers', cursive" }}>
                                    {formatCost(liveCost)}
                                </p>
                                <div className="grid grid-cols-2 gap-1 text-xs font-comic text-gray-600">
                                    {generationsByType.image.total > 0 && (
                                        <span>🖼️ {generationsByType.image.total} images: {formatCost(generationsByType.image.total * 0.00025)}</span>
                                    )}
                                    {generationsByType.beat.total > 0 && (
                                        <span>📝 {generationsByType.beat.total} beats: {formatCost(generationsByType.beat.total * 0.0045)}</span>
                                    )}
                                    {generationsByType.profile.total > 0 && (
                                        <span>👤 {generationsByType.profile.total} profiles: {formatCost(generationsByType.profile.total * 0.002)}</span>
                                    )}
                                    {generationsByType.outline.total > 0 && (
                                        <span>📋 {generationsByType.outline.total} outline: {formatCost(generationsByType.outline.total * 0.01)}</span>
                                    )}
                                </div>
                                <p className="font-comic text-xs text-gray-400 italic mt-2">* Approximate — based on typical token usage.</p>
                            </>
                        ) : (
                            <p className="font-comic text-xs text-gray-500">No API calls made yet this session.</p>
                        )}
                    </div>

                    {/* Consistency Settings (Feature E) */}
                    <div className="border-[3px] border-blue-400 bg-blue-50">
                        <button
                            onClick={() => setConsistencyOpen(o => !o)}
                            className="w-full flex items-center justify-between p-4 cursor-pointer hover:bg-blue-100 transition-colors touch-manipulation"
                            aria-expanded={consistencyOpen}
                        >
                            <p className="font-comic text-sm font-bold uppercase text-blue-900">🎯 Character Consistency</p>
                            <span className="font-comic text-blue-600 text-lg leading-none select-none">
                                {consistencyOpen ? '▲' : '▼'}
                            </span>
                        </button>

                        {consistencyOpen && (
                            <div className="px-4 pb-4">
                                {/* Consistency Strength */}
                                <div className="mb-4">
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="font-comic text-xs font-bold text-blue-800 uppercase">Strength</label>
                                        <span className="font-comic text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 border border-blue-300 rounded">
                                            {currentStrengthLevel.label}
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max="3"
                                        step="1"
                                        value={STRENGTH_LEVELS.findIndex(l => l.value === currentStrengthLevel.value)}
                                        onChange={e => setConsistencyStrength(STRENGTH_LEVELS[parseInt(e.target.value)].value)}
                                        className="w-full accent-blue-600"
                                        aria-label="Consistency strength"
                                    />
                                    <div className="flex justify-between mt-0.5">
                                        {STRENGTH_LEVELS.map(l => (
                                            <span key={l.value} className="font-comic text-[9px] text-blue-500">{l.label}</span>
                                        ))}
                                    </div>
                                    <p className="font-comic text-[10px] text-gray-500 mt-1">{currentStrengthLevel.desc} — controls how strictly character reference data is enforced in prompts.</p>
                                </div>

                                {/* Re-anchor Every N */}
                                <div className="mb-4">
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="font-comic text-xs font-bold text-blue-800 uppercase">Re-Anchor Every</label>
                                        <span className="font-comic text-xs font-bold text-blue-700">{reAnchorEveryN} page{reAnchorEveryN !== 1 ? 's' : ''}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1"
                                        max="5"
                                        step="1"
                                        value={reAnchorEveryN}
                                        onChange={e => setReAnchorEveryN(parseInt(e.target.value))}
                                        className="w-full accent-blue-600"
                                        aria-label="Re-anchor character reference every N pages"
                                    />
                                    <p className="font-comic text-[10px] text-gray-500 mt-1">Re-inject full character references every {reAnchorEveryN} pages to prevent long-run drift. Lower = more reminders, higher = fewer.</p>
                                </div>

                                {/* Toggles */}
                                <div className="space-y-2">
                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={autoCharacterAnalysis}
                                            onChange={e => setAutoCharacterAnalysis(e.target.checked)}
                                            className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            aria-label="Auto character analysis"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-blue-800 uppercase group-hover:text-blue-600">Auto Character Analysis</span>
                                            <p className="font-comic text-[10px] text-gray-500">Automatically run AI visual analysis when starting generation. Disable for faster start.</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={referenceImagePriority}
                                            onChange={e => setReferenceImagePriority(e.target.checked)}
                                            className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            aria-label="Reference image priority"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-blue-800 uppercase group-hover:text-blue-600">Portrait-First Priority</span>
                                            <p className="font-comic text-[10px] text-gray-500">Place character portraits last in prompt (highest AI weight). Disable to prioritize scene continuity instead.</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={useModelSheets}
                                            onChange={e => setUseModelSheets(e.target.checked)}
                                            className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            aria-label="Use character model sheets"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-blue-800 uppercase group-hover:text-blue-600">Use Model Sheets</span>
                                            <p className="font-comic text-[10px] text-gray-500">Draw from each character&rsquo;s model sheet instead of their raw photo. This is the single biggest factor in keeping faces consistent. Turn off only to compare.</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={useCoverAsStyleReference}
                                            onChange={e => setUseCoverAsStyleReference(e.target.checked)}
                                            className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            aria-label="Use the cover as a style reference"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-blue-800 uppercase group-hover:text-blue-600">Cover As Style Anchor</span>
                                            <p className="font-comic text-[10px] text-gray-500">Send your cover to every page as a style and colour reference (never for faces). Costs one extra image per page. Worth it when the cover is exactly the look you want.</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={sceneContinuityImages}
                                            onChange={e => setSceneContinuityImages(e.target.checked)}
                                            className="w-5 h-5 accent-amber-600 cursor-pointer"
                                            aria-label="Send the previous page as a continuity reference"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-amber-800 uppercase group-hover:text-amber-600">Previous-Page Continuity ⚠️</span>
                                            <p className="font-comic text-[10px] text-gray-500">Send the previous page&rsquo;s art for background matching. Improves scene flow but compounds drift: once one page is off-model, later pages copy it. Off is recommended.</p>
                                        </div>
                                    </label>

                                    <label className="flex items-center gap-3 cursor-pointer group">
                                        <input
                                            type="checkbox"
                                            checked={qaAutoReroll}
                                            onChange={e => setQaAutoReroll(e.target.checked)}
                                            className="w-5 h-5 accent-blue-600 cursor-pointer"
                                            aria-label="Automatically reroll pages that drift"
                                        />
                                        <div>
                                            <span className="font-comic text-xs font-bold text-blue-800 uppercase group-hover:text-blue-600">Auto-Fix Drifted Pages</span>
                                            <p className="font-comic text-[10px] text-gray-500">Score every page against its references and reroll once if the characters drifted. Adds one vision call per page, and roughly 40% to generation time.</p>
                                        </div>
                                    </label>

                                    {qaAutoReroll && (
                                        <div className="pl-8">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="font-comic text-[10px] text-gray-600 uppercase">Reroll below</span>
                                                <span className="font-comic text-xs font-bold text-blue-700">{qaThreshold} / 10</span>
                                            </div>
                                            <input
                                                type="range"
                                                min={3}
                                                max={9}
                                                step={1}
                                                value={qaThreshold}
                                                onChange={e => setQaThreshold(parseInt(e.target.value))}
                                                className="w-full accent-blue-600 cursor-pointer"
                                                aria-label="Quality threshold for automatic reroll"
                                            />
                                            <p className="font-comic text-[10px] text-gray-500 mt-1">Higher rerolls more often and costs more. 7 is a reasonable default.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Generation — cost, speed, and output size */}
                    <div className="border-[3px] border-purple-400 bg-purple-50">
                        <button
                            onClick={() => setGenerationOpen(o => !o)}
                            className="w-full flex justify-between items-center p-4 text-left"
                            aria-expanded={generationOpen}
                        >
                            <p className="font-comic text-sm font-bold uppercase text-purple-900">⚙️ Generation</p>
                            <span className="font-comic text-purple-700">{generationOpen ? '▼' : '▶'}</span>
                        </button>
                        {generationOpen && (
                            <div className="px-4 pb-4">
                                <div className="flex flex-col gap-4">
                                    <div>
                                        <span className="font-comic text-xs font-bold text-purple-800 uppercase block mb-1">Image Quality</span>
                                        <div className="flex gap-2">
                                            {([
                                                ['1k', 'Draft'],
                                                ['2k', 'Print'],
                                                ['4k', 'Max'],
                                            ] as const).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    onClick={() => setImageResolution(value)}
                                                    className={`comic-btn flex-1 font-comic text-xs uppercase px-2 py-1.5 border-2 border-black ${
                                                        imageResolution === value ? 'bg-purple-600 text-white' : 'bg-white text-black hover:bg-purple-100'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="font-comic text-[10px] text-gray-500 mt-1">Draft (1K) is about 130 DPI at comic trim size — fine on screen, too low to print. Choose Print or Max if you intend to export a physical issue. Higher costs more per page.</p>
                                    </div>

                                    <div>
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="font-comic text-xs font-bold text-purple-800 uppercase">Pages At Once</span>
                                            <span className="font-comic text-xs font-bold text-purple-700">{maxConcurrentPages}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={1}
                                            max={4}
                                            step={1}
                                            value={maxConcurrentPages}
                                            onChange={e => setMaxConcurrentPages(parseInt(e.target.value))}
                                            className="w-full accent-purple-600 cursor-pointer"
                                            aria-label="Pages generated at once"
                                        />
                                        <p className="font-comic text-[10px] text-gray-500 mt-1">Generating several pages at once is faster, but pages cannot see each other — backgrounds and lighting match less well between them. Character likeness is unaffected.</p>
                                    </div>

                                    <div>
                                        <span className="font-comic text-xs font-bold text-purple-800 uppercase block mb-1">Prompt Engine</span>
                                        <div className="flex gap-2">
                                            {([
                                                ['v2', 'Current'],
                                                ['legacy', 'Legacy'],
                                            ] as const).map(([value, label]) => (
                                                <button
                                                    key={value}
                                                    onClick={() => setPromptMode(value)}
                                                    className={`comic-btn flex-1 font-comic text-xs uppercase px-2 py-1.5 border-2 border-black ${
                                                        promptMode === value ? 'bg-purple-600 text-white' : 'bg-white text-black hover:bg-purple-100'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                        <p className="font-comic text-[10px] text-gray-500 mt-1">Diagnostic. Legacy is the older prompt builder, kept only for comparing results. Leave on Current unless you are testing.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Help & Resources */}
                    <div className="border-[3px] border-gray-400 bg-gray-50 p-4">
                        <p className="font-comic text-sm font-bold uppercase text-gray-800 mb-2">📖 Help & Resources</p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => { onClose(); onOpenHelp?.(); }}
                                className="comic-btn flex-1 bg-blue-600 text-white px-3 py-2 font-bold text-sm border-[2px] border-black hover:bg-blue-500 font-comic"
                            >
                                ❓ Quick Help
                            </button>
                            <button
                                onClick={() => { onClose(); onOpenFullGuide?.(); }}
                                className="comic-btn flex-1 bg-purple-600 text-white px-3 py-2 font-bold text-sm border-[2px] border-black hover:bg-purple-500 font-comic"
                            >
                                📖 Full Tutorial
                            </button>
                        </div>
                    </div>

                    {/* Reset App */}
                    <div className="border-[3px] border-red-400 bg-red-50 p-4">
                        <p className="font-comic text-sm font-bold uppercase text-red-800 mb-1">🗑️ Reset App</p>
                        <p className="font-comic text-xs text-gray-600 mb-3">
                            Clears all saved data: API keys, characters, presets, session history, and the image gallery. The app will reload.
                        </p>
                        <button
                            onClick={() => setShowResetConfirm(true)}
                            className="comic-btn bg-red-600 text-white px-4 py-2 font-bold text-sm border-[2px] border-black hover:bg-red-500"
                        >
                            Reset Everything
                        </button>
                    </div>

                    {/* Feedback */}
                    {saveMsg && (
                        <p className="font-comic text-center text-sm font-bold animate-pulse">{saveMsg}</p>
                    )}
                </div>
            </div>

            {/* Reset confirmation modal — z-[750] ensures it renders above the parent dialog (z-[600]) */}
            {showResetConfirm && (
                <div className="fixed inset-0 z-[750] bg-black/80 flex items-center justify-center p-4">
                    <div className="bg-white border-[6px] border-red-600 max-w-sm w-full mx-auto max-h-screen overflow-y-auto p-6 text-center shadow-[8px_8px_0_rgba(0,0,0,0.5)]">
                        <div className="text-5xl mb-3">⚠️</div>
                        <h3 className="font-comic text-2xl font-bold text-red-700 mb-2 uppercase">Reset Everything?</h3>
                        <p className="font-comic text-sm text-gray-700 mb-2">
                            This will permanently delete:
                        </p>
                        <ul className="text-left font-comic text-xs text-gray-600 mb-4 space-y-1 list-disc list-inside">
                            <li>All API keys</li>
                            <li>All saved characters &amp; presets</li>
                            <li>All session history</li>
                            <li>The entire image gallery</li>
                            <li>All app settings</li>
                        </ul>
                        <p className="font-comic text-sm font-bold text-red-700 mb-4">This cannot be undone.</p>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={handleResetApp}
                                disabled={isResetting}
                                className="comic-btn bg-red-600 text-white px-5 py-2.5 font-bold border-[3px] border-black hover:bg-red-500 disabled:opacity-60"
                            >
                                {isResetting ? 'Resetting...' : 'Yes, Reset Everything'}
                            </button>
                            <button
                                onClick={() => setShowResetConfirm(false)}
                                disabled={isResetting}
                                className="comic-btn bg-gray-400 text-white px-5 py-2.5 font-bold border-[3px] border-black hover:bg-gray-300"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
