/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BubbleEditor Component
 *
 * A full-featured editor for creating and editing speech bubbles on comic panels.
 * Features:
 * - Add new bubbles with shape selector
 * - Click on panel to place bubble and set tail target
 * - Drag bubbles to reposition
 * - Resize handles for bubble size
 * - Tail direction control (click on panel to point tail)
 * - Text input for bubble content
 * - Font size adjustment
 * - Character assignment dropdown
 * - Delete button for each bubble
 * - Preview and save
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { SpeechBubble, createDefaultBubble, calculateOptimalPosition } from '../utils/bubbleRenderer';
import { BubbleShapeType, TailDirection, getAllBubbleShapes, BUBBLE_SHAPES } from '../data/bubbleShapes';
import { BubbleOverlay } from './BubbleOverlay';

/**
 * Props for BubbleEditor component
 */
export interface BubbleEditorProps {
  /** Base panel image URL or base64 */
  panelImage: string;
  /** Initial bubbles to edit */
  initialBubbles?: SpeechBubble[];
  /** Available characters for assignment */
  characters?: { id: string; name: string }[];
  /** Callback when bubbles change */
  onBubblesChange: (bubbles: SpeechBubble[]) => void;
  /** Callback to close the editor */
  onClose: () => void;
}

/**
 * Editing mode for the editor
 */
type EditMode = 'select' | 'place' | 'tail';

/**
 * State for dragging/resizing
 */
interface DragState {
  type: 'move' | 'resize';
  bubbleId: string;
  startX: number;
  startY: number;
  originalPosition: { x: number; y: number };
  originalSize?: { width: number; height: number };
  resizeHandle?: 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
}

/**
 * Generate unique ID for bubbles
 */
function generateBubbleId(): string {
  return `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * BubbleEditor Component
 */
export const BubbleEditor: React.FC<BubbleEditorProps> = ({
  panelImage,
  initialBubbles = [],
  characters = [],
  onBubblesChange,
  onClose,
}) => {
  // State
  const [bubbles, setBubbles] = useState<SpeechBubble[]>(initialBubbles);
  const [selectedBubbleId, setSelectedBubbleId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>('select');
  const [pendingShape, setPendingShape] = useState<BubbleShapeType>('oval');
  const [showShapeSelector, setShowShapeSelector] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [panelDimensions, setPanelDimensions] = useState({ width: 800, height: 600 });

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Get selected bubble
  const selectedBubble = useMemo(() => {
    return bubbles.find((b) => b.id === selectedBubbleId) || null;
  }, [bubbles, selectedBubbleId]);

  // Get all bubble shapes
  const allShapes = useMemo(() => getAllBubbleShapes(), []);

  // Update panel dimensions when image loads
  const handleImageLoad = useCallback(() => {
    if (imageRef.current) {
      setPanelDimensions({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
      });
    }
  }, []);

  // Update dimensions on resize
  useEffect(() => {
    const handleResize = () => {
      if (imageRef.current) {
        setPanelDimensions({
          width: imageRef.current.clientWidth,
          height: imageRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Handle panel click (place bubble or set tail target)
  const handlePanelClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;

      if (editMode === 'place') {
        // Create new bubble at click position
        const newBubble = createDefaultBubble(generateBubbleId(), 'Enter text...', {
          shape: pendingShape,
          position: { x: Math.max(5, Math.min(65, x - 15)), y: Math.max(5, Math.min(75, y - 10)) },
          size: { width: 30, height: 20 },
          tailDirection: 'bottom',
          tailTarget: { x, y: y + 25 },
          fontSize: 14,
          zIndex: bubbles.length + 1,
        });

        setBubbles((prev) => [...prev, newBubble]);
        setSelectedBubbleId(newBubble.id);
        setEditMode('select');
        setShowShapeSelector(false);
      } else if (editMode === 'tail' && selectedBubbleId) {
        // Set tail target for selected bubble
        setBubbles((prev) =>
          prev.map((b) =>
            b.id === selectedBubbleId
              ? { ...b, tailTarget: { x, y } }
              : b
          )
        );
        setEditMode('select');
      }
    },
    [editMode, pendingShape, selectedBubbleId, bubbles.length]
  );

  // Handle bubble selection
  const handleBubbleClick = useCallback((bubbleId: string) => {
    setSelectedBubbleId(bubbleId);
    setEditMode('select');
  }, []);

  // Update a bubble property
  const updateBubble = useCallback((bubbleId: string, updates: Partial<SpeechBubble>) => {
    setBubbles((prev) =>
      prev.map((b) => (b.id === bubbleId ? { ...b, ...updates } : b))
    );
  }, []);

  // Delete selected bubble
  const deleteBubble = useCallback((bubbleId: string) => {
    setBubbles((prev) => prev.filter((b) => b.id !== bubbleId));
    if (selectedBubbleId === bubbleId) {
      setSelectedBubbleId(null);
    }
  }, [selectedBubbleId]);

  // Handle mouse down for drag/resize
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, bubbleId: string, type: 'move' | 'resize', handle?: DragState['resizeHandle']) => {
      e.stopPropagation();
      e.preventDefault();

      const bubble = bubbles.find((b) => b.id === bubbleId);
      if (!bubble) return;

      setDragState({
        type,
        bubbleId,
        startX: e.clientX,
        startY: e.clientY,
        originalPosition: { ...bubble.position },
        originalSize: { ...bubble.size },
        resizeHandle: handle,
      });

      setSelectedBubbleId(bubbleId);
    },
    [bubbles]
  );

  // Handle mouse move for drag/resize
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const deltaX = ((e.clientX - dragState.startX) / rect.width) * 100;
      const deltaY = ((e.clientY - dragState.startY) / rect.height) * 100;

      if (dragState.type === 'move') {
        const newX = Math.max(0, Math.min(70, dragState.originalPosition.x + deltaX));
        const newY = Math.max(0, Math.min(80, dragState.originalPosition.y + deltaY));

        updateBubble(dragState.bubbleId, {
          position: { x: newX, y: newY },
        });
      } else if (dragState.type === 'resize' && dragState.originalSize) {
        let newWidth = dragState.originalSize.width;
        let newHeight = dragState.originalSize.height;
        let newX = dragState.originalPosition.x;
        let newY = dragState.originalPosition.y;

        const handle = dragState.resizeHandle || 'se';

        // Adjust based on which handle is being dragged
        if (handle.includes('e')) {
          newWidth = Math.max(15, Math.min(60, dragState.originalSize.width + deltaX));
        }
        if (handle.includes('w')) {
          const widthDelta = -deltaX;
          newWidth = Math.max(15, Math.min(60, dragState.originalSize.width + widthDelta));
          newX = Math.max(0, dragState.originalPosition.x - widthDelta);
        }
        if (handle.includes('s')) {
          newHeight = Math.max(10, Math.min(40, dragState.originalSize.height + deltaY));
        }
        if (handle.includes('n')) {
          const heightDelta = -deltaY;
          newHeight = Math.max(10, Math.min(40, dragState.originalSize.height + heightDelta));
          newY = Math.max(0, dragState.originalPosition.y - heightDelta);
        }

        updateBubble(dragState.bubbleId, {
          size: { width: newWidth, height: newHeight },
          position: { x: newX, y: newY },
        });
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, updateBubble]);

  // Handle save
  const handleSave = useCallback(() => {
    onBubblesChange(bubbles);
    onClose();
  }, [bubbles, onBubblesChange, onClose]);

  // Render resize handles for selected bubble
  const renderResizeHandles = useCallback((bubble: SpeechBubble) => {
    if (bubble.id !== selectedBubbleId || editMode !== 'select') return null;

    const dims = {
      x: (bubble.position.x / 100) * panelDimensions.width,
      y: (bubble.position.y / 100) * panelDimensions.height,
      width: (bubble.size.width / 100) * panelDimensions.width,
      height: (bubble.size.height / 100) * panelDimensions.height,
    };

    const handleSize = 10;
    const handles: Array<{ position: DragState['resizeHandle']; style: React.CSSProperties }> = [
      { position: 'nw', style: { left: -handleSize / 2, top: -handleSize / 2, cursor: 'nwse-resize' } },
      { position: 'ne', style: { right: -handleSize / 2, top: -handleSize / 2, cursor: 'nesw-resize' } },
      { position: 'sw', style: { left: -handleSize / 2, bottom: -handleSize / 2, cursor: 'nesw-resize' } },
      { position: 'se', style: { right: -handleSize / 2, bottom: -handleSize / 2, cursor: 'nwse-resize' } },
      { position: 'n', style: { left: '50%', top: -handleSize / 2, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { position: 's', style: { left: '50%', bottom: -handleSize / 2, transform: 'translateX(-50%)', cursor: 'ns-resize' } },
      { position: 'e', style: { right: -handleSize / 2, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
      { position: 'w', style: { left: -handleSize / 2, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' } },
    ];

    return (
      <div
        className="absolute pointer-events-auto"
        style={{
          left: dims.x,
          top: dims.y,
          width: dims.width,
          height: dims.height,
        }}
      >
        {/* Selection border */}
        <div className="absolute inset-0 border-2 border-blue-500 border-dashed pointer-events-none" />

        {/* Drag handle (center) */}
        <div
          className="absolute inset-0 cursor-move"
          onMouseDown={(e) => handleMouseDown(e, bubble.id, 'move')}
        />

        {/* Resize handles */}
        {handles.map((handle) => (
          <div
            key={handle.position}
            className="absolute bg-blue-500 hover:bg-blue-600 rounded-sm"
            style={{
              width: handleSize,
              height: handleSize,
              ...handle.style,
            }}
            onMouseDown={(e) => handleMouseDown(e, bubble.id, 'resize', handle.position)}
          />
        ))}
      </div>
    );
  }, [selectedBubbleId, editMode, panelDimensions, handleMouseDown]);

  // Render bubble property panel
  const renderPropertyPanel = () => {
    if (!selectedBubble) {
      return (
        <div className="text-gray-400 text-center py-8">
          Select a bubble to edit its properties, or add a new one.
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Text Content */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Text Content
          </label>
          <textarea
            value={selectedBubble.text}
            onChange={(e) => updateBubble(selectedBubble.id, { text: e.target.value })}
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
            placeholder="Enter dialogue..."
          />
        </div>

        {/* Shape Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Bubble Shape
          </label>
          <div className="grid grid-cols-3 gap-2">
            {allShapes.map((shape) => (
              <button
                key={shape.id}
                onClick={() => updateBubble(selectedBubble.id, { shape: shape.id })}
                className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedBubble.shape === shape.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title={shape.description}
              >
                {shape.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tail Direction */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Tail Direction
          </label>
          <div className="flex gap-2">
            {(['left', 'bottom', 'right', 'none'] as TailDirection[]).map((dir) => (
              <button
                key={dir}
                onClick={() => updateBubble(selectedBubble.id, { tailDirection: dir })}
                className={`flex-1 px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
                  selectedBubble.tailDirection === dir
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {dir === 'none' ? 'None' : dir}
              </button>
            ))}
          </div>
          {selectedBubble.tailDirection !== 'none' && (
            <button
              onClick={() => setEditMode('tail')}
              className={`mt-2 w-full px-3 py-2 rounded-lg text-sm transition-colors ${
                editMode === 'tail'
                  ? 'bg-yellow-600 text-white'
                  : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              }`}
            >
              {editMode === 'tail' ? 'Click on panel to set tail target...' : 'Set Tail Target Point'}
            </button>
          )}
        </div>

        {/* Font Size */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Font Size: {selectedBubble.fontSize}px
          </label>
          <input
            type="range"
            min={10}
            max={24}
            value={selectedBubble.fontSize}
            onChange={(e) => updateBubble(selectedBubble.id, { fontSize: parseInt(e.target.value) })}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
          />
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>10px</span>
            <span>24px</span>
          </div>
        </div>

        {/* Character Assignment */}
        {characters.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Character
            </label>
            <select
              value={selectedBubble.characterId || ''}
              onChange={(e) =>
                updateBubble(selectedBubble.id, {
                  characterId: e.target.value || undefined,
                })
              }
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">No character assigned</option>
              {characters.map((char) => (
                <option key={char.id} value={char.id}>
                  {char.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Size Controls */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Width: {selectedBubble.size.width.toFixed(0)}%
            </label>
            <input
              type="range"
              min={15}
              max={60}
              value={selectedBubble.size.width}
              onChange={(e) =>
                updateBubble(selectedBubble.id, {
                  size: { ...selectedBubble.size, width: parseFloat(e.target.value) },
                })
              }
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Height: {selectedBubble.size.height.toFixed(0)}%
            </label>
            <input
              type="range"
              min={10}
              max={40}
              value={selectedBubble.size.height}
              onChange={(e) =>
                updateBubble(selectedBubble.id, {
                  size: { ...selectedBubble.size, height: parseFloat(e.target.value) },
                })
              }
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
          </div>
        </div>

        {/* Z-Index Control */}
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">
            Layer Order
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => {
                const maxZ = Math.max(...bubbles.map((b) => b.zIndex || 0));
                updateBubble(selectedBubble.id, { zIndex: maxZ + 1 });
              }}
              className="flex-1 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors"
            >
              Bring to Front
            </button>
            <button
              onClick={() => {
                const minZ = Math.min(...bubbles.map((b) => b.zIndex || 0));
                updateBubble(selectedBubble.id, { zIndex: minZ - 1 });
              }}
              className="flex-1 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors"
            >
              Send to Back
            </button>
          </div>
        </div>

        {/* Delete Button */}
        <button
          onClick={() => deleteBubble(selectedBubble.id)}
          className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Delete Bubble
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[700] p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Speech Bubble Editor</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">
              {bubbles.length} bubble{bubbles.length !== 1 ? 's' : ''}
            </span>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-white transition-colors"
              aria-label="Close editor"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Panel - Image & Bubbles */}
          <div className="flex-1 flex flex-col p-4 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-4">
              {/* Add Bubble Button */}
              <div className="relative">
                <button
                  onClick={() => setShowShapeSelector(!showShapeSelector)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    showShapeSelector || editMode === 'place'
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  + Add Bubble
                </button>

                {/* Shape Selector Dropdown */}
                {showShapeSelector && (
                  <div className="absolute top-full left-0 mt-2 bg-gray-700 rounded-lg shadow-xl border border-gray-600 p-2 z-10 min-w-[200px]">
                    <div className="text-xs text-gray-400 px-2 py-1 mb-1">Select bubble shape:</div>
                    {allShapes.map((shape) => (
                      <button
                        key={shape.id}
                        onClick={() => {
                          setPendingShape(shape.id);
                          setEditMode('place');
                          setShowShapeSelector(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-gray-600 transition-colors ${
                          pendingShape === shape.id ? 'bg-gray-600' : ''
                        }`}
                      >
                        <div className="font-medium text-white">{shape.label}</div>
                        <div className="text-xs text-gray-400">{shape.useCase}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Mode Indicator */}
              {editMode === 'place' && (
                <div className="px-3 py-1 bg-green-600/20 text-green-400 rounded-lg text-sm">
                  Click on panel to place bubble
                </div>
              )}
              {editMode === 'tail' && (
                <div className="px-3 py-1 bg-yellow-600/20 text-yellow-400 rounded-lg text-sm">
                  Click on panel to set tail target
                </div>
              )}

              {/* Cancel Button */}
              {(editMode === 'place' || editMode === 'tail') && (
                <button
                  onClick={() => {
                    setEditMode('select');
                    setShowShapeSelector(false);
                  }}
                  className="px-3 py-1 bg-gray-600 text-gray-300 rounded-lg text-sm hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              )}
            </div>

            {/* Panel Container */}
            <div
              ref={containerRef}
              className="relative flex-1 bg-gray-900 rounded-lg overflow-hidden cursor-crosshair"
              onClick={handlePanelClick}
              style={{
                cursor: editMode === 'place' || editMode === 'tail' ? 'crosshair' : 'default',
              }}
            >
              {/* Panel Image */}
              <img
                ref={imageRef}
                src={panelImage}
                alt="Comic panel"
                className="w-full h-full object-contain"
                onLoad={handleImageLoad}
                draggable={false}
              />

              {/* Bubble Overlay */}
              <BubbleOverlay
                bubbles={bubbles}
                panelWidth={panelDimensions.width}
                panelHeight={panelDimensions.height}
                editable={true}
                onBubbleClick={handleBubbleClick}
              />

              {/* Resize Handles Overlay */}
              <div className="absolute inset-0 pointer-events-none">
                {bubbles.map((bubble) => renderResizeHandles(bubble))}
              </div>

              {/* Tail Target Indicator */}
              {selectedBubble?.tailTarget && editMode !== 'tail' && (
                <div
                  className="absolute w-4 h-4 bg-yellow-500 rounded-full transform -translate-x-1/2 -translate-y-1/2 pointer-events-none border-2 border-white shadow-lg"
                  style={{
                    left: `${selectedBubble.tailTarget.x}%`,
                    top: `${selectedBubble.tailTarget.y}%`,
                  }}
                />
              )}
            </div>
          </div>

          {/* Right Panel - Properties */}
          <div className="w-80 border-l border-gray-700 p-4 overflow-y-auto">
            <h3 className="text-lg font-semibold text-white mb-4">Bubble Properties</h3>
            {renderPropertyPanel()}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setBubbles([])}
              className="px-4 py-2 text-gray-400 hover:text-red-400 transition-colors"
              disabled={bubbles.length === 0}
            >
              Clear All
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Bubbles
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BubbleEditor;
