/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useId } from 'react';

export interface HelpTooltipProps {
    /** The help text to display in the tooltip */
    text: string;
    /** Optional title for the tooltip (shown in bold) */
    title?: string;
    /** Position of the tooltip relative to the icon */
    position?: 'top' | 'bottom' | 'left' | 'right';
    /** Additional CSS classes for the container */
    className?: string;
}

/**
 * HelpTooltip component - A contextual help icon that shows explanatory text on hover/click.
 * Styled to match the comic book theme with indigo/purple colors.
 * Accessible: keyboard focusable with aria-describedby for screen readers.
 */
export const HelpTooltip: React.FC<HelpTooltipProps> = ({
    text,
    title,
    position = 'right',
    className = ''
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const tooltipId = useId();
    const containerRef = useRef<HTMLSpanElement>(null);

    // Close tooltip when clicking outside
    useEffect(() => {
        if (!isVisible) return;

        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsVisible(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isVisible]);

    // Close on Escape key
    useEffect(() => {
        if (!isVisible) return;

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsVisible(false);
            }
        };

        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isVisible]);

    // Position styles for the tooltip
    const getPositionStyles = (): React.CSSProperties => {
        switch (position) {
            case 'top':
                return {
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginBottom: '8px'
                };
            case 'bottom':
                return {
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    marginTop: '8px'
                };
            case 'left':
                return {
                    right: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    marginRight: '8px'
                };
            case 'right':
            default:
                return {
                    left: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    marginLeft: '8px'
                };
        }
    };

    // Arrow position styles
    const getArrowStyles = (): React.CSSProperties => {
        const baseArrow: React.CSSProperties = {
            position: 'absolute',
            width: 0,
            height: 0,
            border: '6px solid transparent'
        };

        switch (position) {
            case 'top':
                return {
                    ...baseArrow,
                    top: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    borderTopColor: 'black'
                };
            case 'bottom':
                return {
                    ...baseArrow,
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    borderBottomColor: 'black'
                };
            case 'left':
                return {
                    ...baseArrow,
                    left: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    borderLeftColor: 'black'
                };
            case 'right':
            default:
                return {
                    ...baseArrow,
                    right: '100%',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    borderRightColor: 'black'
                };
        }
    };

    return (
        <span
            ref={containerRef}
            className={`relative inline-flex items-center ml-1 ${className}`}
        >
            <button
                type="button"
                onClick={() => setIsVisible(!isVisible)}
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
                onFocus={() => setIsVisible(true)}
                onBlur={() => setIsVisible(false)}
                aria-describedby={isVisible ? tooltipId : undefined}
                aria-label={title ? `Help: ${title}` : 'Help'}
                className="font-comic text-[10px] bg-indigo-600 text-white rounded-full w-4 h-4 flex items-center justify-center font-bold border border-black hover:bg-indigo-500 hover:scale-110 transition-all cursor-help focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-1"
            >
                ?
            </button>

            {isVisible && (
                <span
                    id={tooltipId}
                    role="tooltip"
                    style={getPositionStyles()}
                    className="absolute block w-56 p-2.5 bg-white text-black text-xs font-comic border-2 border-black drop-shadow-[3px_3px_0px_rgba(0,0,0,0.3)] z-[500]"
                >
                    {title && (
                        <span className="block font-bold text-indigo-700 mb-1 uppercase text-[10px]">
                            {title}
                        </span>
                    )}
                    <span className="block" style={{ textTransform: 'none' }}>{text}</span>
                    <span className="block" style={getArrowStyles()} />
                </span>
            )}
        </span>
    );
};

export default HelpTooltip;
