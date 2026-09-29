import React, { useState, useRef, useEffect } from 'react';
import { Settings, Layers, Radio, Crosshair, ArrowRight, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

interface SettingsDropdownProps {
    showAll: boolean;
    onToggleShowAll: (val: boolean) => void;
    mapStyle: 'standard' | 'minimal';
    onToggleMapStyle: (style: 'standard' | 'minimal') => void;
    isFollowingVehicle: boolean;
    onToggleFollow: () => void;
    lastUpdated: Date | null;
}

export const SettingsDropdown: React.FC<SettingsDropdownProps> = ({
    showAll,
    onToggleShowAll,
    mapStyle,
    onToggleMapStyle,
    isFollowingVehicle,
    onToggleFollow,
    lastUpdated
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div ref={dropdownRef} className="relative">
            <button
                onClick={() => setIsOpen(prev => !prev)}
                className={`p-2 rounded-xl border transition-all flex items-center justify-center ${isOpen
                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                        : 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white border-slate-700/80'
                    }`}
                title="Inställningar"
                aria-label="Inställningar"
            >
                <Settings className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
            </button>

            {isOpen && (
                <div
                    className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-slate-800 bg-slate-900/95 text-white backdrop-blur-xl shadow-2xl p-3 z-[3500] animate-in fade-in slide-in-from-top-2"
                >
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/5">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Inställningar
                        </span>
                    </div>

                    <div className="space-y-3">
                        {/* Visa all trafik Toggle */}
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                                <Radio className="w-4 h-4 text-blue-500" />
                                <div>
                                    <div className="text-xs font-bold text-white">Visa all trafik</div>
                                    <div className="text-[10px] text-slate-400">
                                        Visa alla fordon på kartan
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onToggleShowAll(!showAll)}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${showAll ? 'bg-blue-600' : 'bg-slate-800'
                                    }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${showAll ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Detaljerad karta Toggle */}
                        <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/5">
                            <div className="flex items-center gap-2">
                                <Layers className="w-4 h-4 text-emerald-500" />
                                <div>
                                    <div className="text-xs font-bold text-white">Detaljerad karta</div>
                                    <div className="text-[10px] text-slate-400">
                                        {mapStyle === 'standard' ? 'Standard (OSM)' : 'Minimal (Stilren)'}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => onToggleMapStyle(mapStyle === 'standard' ? 'minimal' : 'standard')}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${mapStyle === 'standard' ? 'bg-blue-600' : 'bg-slate-800'
                                    }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${mapStyle === 'standard' ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Följ valt fordon Toggle */}
                        <div className="flex items-center justify-between gap-4 pt-2 border-t border-white/5">
                            <div className="flex items-center gap-2">
                                <Crosshair className="w-4 h-4 text-cyan-500" />
                                <div>
                                    <div className="text-xs font-bold text-white">Följ fordon</div>
                                    <div className="text-[10px] text-slate-400">
                                        Centrera automatiskt vid förflyttning
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onToggleFollow}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isFollowingVehicle ? 'bg-blue-600' : 'bg-slate-800'
                                    }`}
                            >
                                <span
                                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${isFollowingVehicle ? 'translate-x-5' : 'translate-x-0'
                                        }`}
                                />
                            </button>
                        </div>

                        {/* Link to v1 */}
                        <div className="pt-2 border-t border-white/5">
                            <Link
                                to="/v1"
                                className="flex items-center justify-between p-2 rounded-xl text-xs font-semibold bg-slate-800/50 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <ExternalLink className="w-3.5 h-3.5 text-blue-500" />
                                    <span>Klassisk vy (v1)</span>
                                </div>
                                <ArrowRight className="w-3.5 h-3.5 opacity-60" />
                            </Link>
                        </div>

                        {/* Static Data update timestamp */}
                        {lastUpdated && (
                            <div className="pt-1 text-center">
                                <span className="text-[9px] text-slate-500">
                                    Statisk data: {lastUpdated.toISOString().split('T')[0]}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
export default SettingsDropdown;
