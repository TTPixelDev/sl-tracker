import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, MapPin, Hash, Ship, ArrowRight, AlertCircle } from 'lucide-react';
import { slService } from '../../services/slService';
import { SearchResult, SLLineRoute, SLStop, SLVehicle } from '../../types';
import { getLineColor, getTransportIcon } from '../../utils/mapUtils';
import { SHIP_NAMES } from '../../constants';

interface SmartSearchBarProps {
    onSelectRoute: (routeId: string) => Promise<void>;
    onSelectStop: (stop: SLStop) => void;
    onSelectVehicle: (vehicle: SLVehicle, routeId: string) => void;
    currentAgency: 'SL' | 'WAAB';
    selectedRoutes: SLLineRoute[];
    vehicles?: SLVehicle[];
}

export const SmartSearchBar: React.FC<SmartSearchBarProps> = ({
    onSelectRoute,
    onSelectStop,
    onSelectVehicle,
    currentAgency,
    selectedRoutes,
    vehicles = []
}) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [vehicleSuggestion, setVehicleSuggestion] = useState<{
        vNum: string;
        vehicle?: SLVehicle;
        status: 'found' | 'not_found' | 'checking';
    } | null>(null);
    const [shipSuggestions, setShipSuggestions] = useState<Array<{ code: string; name: string }>>([]);
    const [loading, setLoading] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [selectedIndex, setSelectedIndex] = useState<number>(-1);
    const containerRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Handle outside click to close dropdown
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setShowDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Check query changes
    useEffect(() => {
        const trimmed = query.trim();
        setErrorMessage(null);
        setSelectedIndex(-1);

        if (!trimmed) {
            setResults([]);
            setVehicleSuggestion(null);
            setShipSuggestions([]);
            setShowDropdown(false);
            setLoading(false);
            return;
        }

        const isFourDigits = /^\d{4}$/.test(trimmed);

        if (isFourDigits) {
            // 4 digits: search for vehicle number
            setResults([]);
            setShipSuggestions([]);
            setShowDropdown(true);

            const matchedLocal = vehicles.find(v => v.vehicleNumber === trimmed || v.id.endsWith(trimmed));
            if (matchedLocal) {
                setVehicleSuggestion({
                    vNum: trimmed,
                    vehicle: matchedLocal,
                    status: 'found'
                });
                setLoading(false);
            } else {
                setVehicleSuggestion({
                    vNum: trimmed,
                    status: 'checking'
                });
                setLoading(true);

                const timer = setTimeout(async () => {
                    try {
                        const found = await slService.findVehicle(trimmed);
                        if (found) {
                            setVehicleSuggestion({
                                vNum: trimmed,
                                vehicle: found.vehicle,
                                status: 'found'
                            });
                        } else {
                            setVehicleSuggestion({
                                vNum: trimmed,
                                status: 'not_found'
                            });
                        }
                    } catch (e) {
                        setVehicleSuggestion({
                            vNum: trimmed,
                            status: 'not_found'
                        });
                    } finally {
                        setLoading(false);
                    }
                }, 120);

                return () => clearTimeout(timer);
            }
        } else {
            // 1-3 digits or text: strictly separate Line Search vs Stop Search
            setVehicleSuggestion(null);

            // Check if query is a Line Search (numbers / "linje <num>")
            const isLineSearch = /^\d{1,3}[a-zA-Z]?$/i.test(trimmed) || /^(linje|line|l)\s*([0-9a-zA-Z]+)?$/i.test(trimmed);

            if (isLineSearch) {
                // LINE SEARCH: Show ONLY lines! Never show stops.
                setShipSuggestions([]);
                setLoading(true);

                const timer = setTimeout(async () => {
                    try {
                        const lines = await slService.search(trimmed, currentAgency, 'line');
                        setResults(lines);
                        setShowDropdown(true);
                    } catch (e) {
                        console.error('Line search error', e);
                    } finally {
                        setLoading(false);
                    }
                }, 100);

                return () => clearTimeout(timer);
            } else {
                // STOP SEARCH: Show ONLY stops! Never show lines.
                // Check WÅAB ship names if boat agency
                if (currentAgency === 'WAAB' && trimmed.length >= 1) {
                    const qLower = trimmed.toLowerCase();
                    const matchingShips = Object.entries(SHIP_NAMES)
                        .filter(([code, name]) => name.toLowerCase().includes(qLower) || code.toLowerCase().includes(qLower))
                        .map(([code, name]) => ({ code, name }))
                        .slice(0, 4);
                    setShipSuggestions(matchingShips);
                } else {
                    setShipSuggestions([]);
                }

                setLoading(true);
                const timer = setTimeout(async () => {
                    try {
                        const queryLower = trimmed.toLowerCase();
                        let finalStops: SearchResult[] = [];

                        if (selectedRoutes.length > 0) {
                            // Rule: "har jag sökt på en eller flera linjer så ska endast hållplatser som trafikeras av valda linjer visas."
                            const matchedStopsMap = new Map<string, { stop: SLStop; lines: string[] }>();

                            selectedRoutes.forEach(route => {
                                (route.stops || []).forEach(stop => {
                                    if (stop.name && stop.name.toLowerCase().includes(queryLower)) {
                                        const normName = stop.name.trim().toLowerCase();
                                        if (!matchedStopsMap.has(normName)) {
                                            matchedStopsMap.set(normName, {
                                                stop,
                                                lines: route.line ? [route.line] : []
                                            });
                                        } else {
                                            const entry = matchedStopsMap.get(normName)!;
                                            if (route.line && !entry.lines.includes(route.line)) {
                                                entry.lines.push(route.line);
                                            }
                                        }
                                    }
                                });
                            });

                            finalStops = Array.from(matchedStopsMap.values()).map(({ stop, lines }) => ({
                                type: 'stop' as const,
                                id: stop.id,
                                title: stop.name,
                                subtitle: lines.length > 0
                                    ? `Linje ${lines.join(', ')} · ${stop.agency === 'WAAB' ? 'Brygga' : 'Hållplats'}`
                                    : (stop.agency === 'WAAB' ? 'Brygga' : 'Hållplats'),
                                agency: stop.agency || 'SL',
                                lat: stop.lat,
                                lng: stop.lng
                            }));
                        } else {
                            // No lines selected: search all stops across the network
                            const stops = await slService.search(trimmed, currentAgency, 'stop');
                            finalStops = stops;
                        }

                        // Sort stops: exact match, then startsWith, then alphabetical
                        finalStops.sort((a, b) => {
                            const aLower = a.title.toLowerCase();
                            const bLower = b.title.toLowerCase();
                            if (aLower === queryLower && bLower !== queryLower) return -1;
                            if (bLower === queryLower && aLower !== queryLower) return 1;
                            const aStarts = aLower.startsWith(queryLower);
                            const bStarts = bLower.startsWith(queryLower);
                            if (aStarts && !bStarts) return -1;
                            if (!aStarts && bStarts) return 1;
                            return a.title.localeCompare(b.title);
                        });

                        setResults(finalStops.slice(0, 30));
                        setShowDropdown(true);
                    } catch (e) {
                        console.error('Stop search error', e);
                    } finally {
                        setLoading(false);
                    }
                }, 100);

                return () => clearTimeout(timer);
            }
        }
    }, [query, currentAgency, selectedRoutes, vehicles]);

    const handleSelectLineOrStop = async (item: SearchResult) => {
        if (item.type === 'line') {
            await onSelectRoute(item.id);
        } else {
            let stopInfo = await slService.getStopInfo(item.id);
            if (!stopInfo && item.lat && item.lng) {
                stopInfo = {
                    id: item.id,
                    name: item.title,
                    lat: item.lat,
                    lng: item.lng,
                    agency: item.agency
                };
            }
            if (!stopInfo) {
                for (const r of selectedRoutes) {
                    const s = (r.stops || []).find(st => String(st.id) === String(item.id) || st.name.toLowerCase() === item.title.toLowerCase());
                    if (s) {
                        stopInfo = s;
                        break;
                    }
                }
            }
            if (stopInfo) {
                onSelectStop(stopInfo);
            }
        }
        setQuery('');
        setShowDropdown(false);
        setResults([]);
    };

    const handleSelectVehicleByNum = async (vNum: string) => {
        setLoading(true);
        try {
            const res = await slService.findVehicle(vNum);
            if (res) {
                onSelectVehicle(res.vehicle, res.routeId);
                setQuery('');
                setShowDropdown(false);
            } else {
                setErrorMessage(`Vagn ${vNum} är inte i aktiv trafik just nu`);
                setTimeout(() => setErrorMessage(null), 4000);
            }
        } catch (err) {
            setErrorMessage(`Kunde inte söka vagn ${vNum}`);
            setTimeout(() => setErrorMessage(null), 3000);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setShowDropdown(false);
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            const trimmed = query.trim();
            if (!trimmed) return;

            if (/^\d{4}$/.test(trimmed)) {
                handleSelectVehicleByNum(trimmed);
                return;
            }

            if (results.length > 0) {
                const itemToSelect = selectedIndex >= 0 && selectedIndex < results.length
                    ? results[selectedIndex]
                    : results[0];
                handleSelectLineOrStop(itemToSelect);
            }
        }
    };

    const placeholderText = currentAgency === 'WAAB'
        ? 'Sök linje, brygga el. båt (SIL)...'
        : 'Sök linje/hållplats (1-3 siffror) el. vagn (4 siffror)...';

    return (
        <div ref={containerRef} className="relative w-full max-w-md">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all bg-slate-800/90 border-slate-700/80 text-white focus-within:border-blue-500 focus-within:bg-slate-800 focus-within:ring-2 focus-within:ring-blue-500/20">
                <Search className="w-4 h-4 shrink-0 text-slate-400" />

                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => {
                        if (query.trim()) setShowDropdown(true);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholderText}
                    className="w-full bg-transparent text-xs sm:text-sm outline-none placeholder:text-slate-400 font-medium text-white"
                />

                {loading && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-blue-500" />}

                {query && (
                    <button
                        type="button"
                        onClick={() => {
                            setQuery('');
                            setResults([]);
                            setVehicleSuggestion(null);
                            setErrorMessage(null);
                            inputRef.current?.focus();
                        }}
                        className="p-1 rounded-md transition-colors hover:bg-slate-700 text-slate-400 hover:text-white"
                        title="Rensa sökfält"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                )}
            </div>

            {/* Error message toast below input */}
            {errorMessage && (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-[2100] px-3 py-2 bg-red-600 text-white text-xs font-semibold rounded-xl shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                </div>
            )}

            {/* Autocomplete Dropdown */}
            {showDropdown && (vehicleSuggestion || results.length > 0 || shipSuggestions.length > 0 || (!loading && query.trim().length > 0)) && (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-[2000] rounded-2xl border shadow-2xl overflow-hidden max-h-[70vh] overflow-y-auto animate-in fade-in slide-in-from-top-1 bg-slate-900/95 border-slate-700/80 text-white backdrop-blur-xl">
                    {/* 4-digit Vehicle Result Card */}
                    {vehicleSuggestion && (
                        <div className="p-2 border-b border-white/5">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Fordonssökning (4 siffror)
                            </div>
                            <button
                                onClick={() => handleSelectVehicleByNum(vehicleSuggestion.vNum)}
                                className="w-full mt-1 p-2.5 rounded-xl text-left flex items-center justify-between transition-all bg-slate-800/80 hover:bg-blue-600/20 text-white border border-white/5"
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-500 flex items-center justify-center font-bold">
                                        <Hash className="w-4 h-4" />
                                    </div>
                                    <div>
                                        <div className="text-xs sm:text-sm font-bold flex items-center gap-2 text-white">
                                            <span>Vagn {vehicleSuggestion.vNum}</span>
                                            {vehicleSuggestion.status === 'found' && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                                                    I trafik
                                                </span>
                                            )}
                                            {vehicleSuggestion.status === 'not_found' && (
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                                                    Ej i realtidsflödet
                                                </span>
                                            )}
                                        </div>
                                        {vehicleSuggestion.vehicle && (
                                            <div className="text-[11px] mt-0.5 text-slate-400">
                                                {vehicleSuggestion.vehicle.destination
                                                    ? `Mot ${vehicleSuggestion.vehicle.destination}`
                                                    : `Linje ${vehicleSuggestion.vehicle.line || ''}`}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-blue-500 font-bold">
                                    <span>Visa på karta</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </div>
                            </button>
                        </div>
                    )}

                    {/* WÅAB Ship Suggestions */}
                    {shipSuggestions.length > 0 && (
                        <div className="p-2 border-b border-white/5">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Fartyg (WÅAB)
                            </div>
                            <div className="space-y-1 mt-1">
                                {shipSuggestions.map(ship => (
                                    <button
                                        key={ship.code}
                                        onClick={() => handleSelectVehicleByNum(ship.code)}
                                        className="w-full p-2 rounded-xl text-left flex items-center justify-between transition-colors hover:bg-slate-800 text-white"
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <Ship className="w-4 h-4 text-cyan-500" />
                                            <span className="text-xs sm:text-sm font-semibold">{ship.name}</span>
                                        </div>
                                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-300">
                                            {ship.code}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Empty state when no matches */}
                    {results.length === 0 && !loading && !vehicleSuggestion && shipSuggestions.length === 0 && query.trim().length > 0 && (
                        <div className="p-4 text-center text-xs text-slate-400">
                            {(/^\d{1,3}[a-zA-Z]?$/i.test(query.trim()) || /^(linje|line|l)\s*/i.test(query.trim()))
                                ? `Inga linjer matchar "${query.trim()}"`
                                : (selectedRoutes.length > 0
                                    ? `Inga hållplatser på valda linjer matchar "${query.trim()}"`
                                    : `Inga hållplatser matchar "${query.trim()}"`
                                )
                            }
                        </div>
                    )}

                    {/* Lines or Stops Results */}
                    {results.length > 0 && (
                        <div className="p-1">
                            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                {results[0]?.type === 'line'
                                    ? 'Linjer'
                                    : (selectedRoutes.length > 0
                                        ? (currentAgency === 'WAAB' ? 'Bryggor på valda linjer' : 'Hållplatser på valda linjer')
                                        : (currentAgency === 'WAAB' ? 'Bryggor' : 'Hållplatser')
                                    )
                                }
                            </div>
                            <div className="space-y-0.5">
                                {results.map((item, idx) => {
                                    if (item.type === 'line') {
                                        const lineNum = item.title.replace('Linje ', '');
                                        const TransportIcon = getTransportIcon(lineNum, item.agency);
                                        const color = getLineColor(lineNum, item.agency);

                                        return (
                                            <button
                                                key={`line-${item.id}-${idx}`}
                                                onClick={() => handleSelectLineOrStop(item)}
                                                className="w-full px-3 py-2 rounded-xl text-left flex items-center justify-between transition-colors hover:bg-slate-800 text-white"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <TransportIcon className="w-4 h-4 shrink-0" style={{ color }} />
                                                    <div>
                                                        <div className="text-xs sm:text-sm font-bold">{item.title}</div>
                                                        {item.subtitle && (
                                                            <div className="text-[11px] truncate max-w-xs text-slate-400">
                                                                {item.subtitle}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${item.agency === 'WAAB'
                                                        ? 'bg-cyan-500/20 text-cyan-400'
                                                        : 'bg-blue-500/20 text-blue-400'
                                                    }`}>
                                                    Linje
                                                </span>
                                            </button>
                                        );
                                    }

                                    // Stop item
                                    return (
                                        <button
                                            key={`stop-${item.id}-${idx}`}
                                            onClick={() => handleSelectLineOrStop(item)}
                                            className="w-full px-3 py-2 rounded-xl text-left flex items-center justify-between transition-colors hover:bg-slate-800 text-white"
                                        >
                                            <div className="flex items-center gap-3">
                                                <MapPin className="w-4 h-4 shrink-0 text-rose-500" />
                                                <div>
                                                    <div className="text-xs sm:text-sm font-bold">{item.title}</div>
                                                    <div className="text-[10px] text-slate-400">
                                                        {item.subtitle || 'Hållplats'}
                                                    </div>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-bold text-slate-500">
                                                {item.agency || 'SL'}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
export default SmartSearchBar;
