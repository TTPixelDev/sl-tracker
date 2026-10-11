import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Map as MapIcon, Trash2, X, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { slService } from '../services/slService';
import { SLVehicle, SLLineRoute, SLStop, HistoryPoint } from '../types';
import LiveMap from '../components/LiveMap';
import { getLineColor, getTransportIcon } from '../utils/mapUtils';
import SearchBar from '../components/SearchBar';
import VehicleSearch from '../components/VehicleSearch';
import LiveVehicleStatus from '../components/LiveVehicleStatus';
import L from 'leaflet';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
    return twMerge(clsx(inputs));
}

export default function AppV1() {
    const [loading, setLoading] = useState(true);
    const [mapStyle, setMapStyle] = useState<'standard' | 'minimal'>(() => {
        try {
            const saved = localStorage.getItem('sl_mapStyle');
            if (saved === 'standard' || saved === 'minimal') return saved;
        } catch (e) { }
        return 'minimal';
    });

    useEffect(() => {
        try {
            localStorage.setItem('sl_mapStyle', mapStyle);
        } catch (e) { }
    }, [mapStyle]);

    // Live state
    const [agency, setAgency] = useState<'SL' | 'WAAB'>(() => {
        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const a = params.get('agency');
        return a === 'WAAB' ? 'WAAB' : 'SL';
    });
    const [vehicles, setVehicles] = useState<SLVehicle[]>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const [selectedRoutes, setSelectedRoutes] = useState<SLLineRoute[]>([]);
    const [activeStop, setActiveStop] = useState<SLStop | null>(null);
    const [mapConfig, setMapConfig] = useState<any>({ center: [59.3293, 18.0686], zoom: 12 });
    const [routeManifest, setRouteManifest] = useState<Map<string, any>>(new Map());
    const [searchQuery, setSearchQuery] = useState('');
    const [showAll, setShowAll] = useState(() => {
        try {
            const saved = localStorage.getItem('sl_showAll');
            if (saved !== null) return saved === 'true';
        } catch (e) { }
        return false;
    });

    useEffect(() => {
        try {
            localStorage.setItem('sl_showAll', String(showAll));
        } catch (e) { }
    }, [showAll]);
    const [history, setHistory] = useState<HistoryPoint[]>([]);
    const [tripEvents, setTripEvents] = useState<any[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isFollowingVehicle, setIsFollowingVehicle] = useState(() => {
        try {
            const saved = localStorage.getItem('sl_isFollowingVehicle');
            if (saved !== null) return saved === 'true';
        } catch (e) { }
        return false;
    });

    useEffect(() => {
        try {
            localStorage.setItem('sl_isFollowingVehicle', String(isFollowingVehicle));
        } catch (e) { }
    }, [isFollowingVehicle]);

    const activeTripIdRef = useRef<string | null>(null);
    const lastHistoryFetchRef = useRef<number>(0);
    const currentTripIdRef = useRef<string | null>(null);

    useEffect(() => {
        (async () => {
            await slService.initialize();
            const m = await slService.getManifest();
            setRouteManifest(new Map(m.map((x: any) => [x.id, x])));

            const updatedDate = await slService.getLastUpdated();
            if (updatedDate) setLastUpdated(updatedDate);

            const params = new URLSearchParams(window.location.search);
            const linesParam = params.get('lines');
            const stopParam = params.get('stop');
            const vehicleParam = params.get('vehicle');
            const urlAgency = params.get('agency') || 'SL';

            if (linesParam) {
                const lineNamesOrIds = linesParam.split(',');
                const loadedRoutes: SLLineRoute[] = [];
                for (const item of lineNamesOrIds) {
                    let targetRouteId = item;
                    const matched = m.find((x: any) => x.line === item && x.agency === urlAgency) ||
                        m.find((x: any) => x.line === item);
                    if (matched) {
                        targetRouteId = matched.id;
                    }
                    const r = await slService.getLineRoute(targetRouteId);
                    if (r) loadedRoutes.push(r);
                }
                if (loadedRoutes.length > 0) {
                    setSelectedRoutes(loadedRoutes);
                    const b = L.latLngBounds(loadedRoutes.flatMap(route => route.path));
                    setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b });
                }
            }

            if (stopParam) {
                const s = await slService.getStopInfo(stopParam);
                if (s) {
                    setActiveStop(s);
                    if (!linesParam) {
                        setMapConfig({ center: [s.lat, s.lng], zoom: 16 });
                    }
                }
            }

            if (vehicleParam) {
                setSelectedVehicleId(vehicleParam);
            }

            setLoading(false);
        })();
    }, []);

    // Resolve short vehicleNumber/ID from URL to full ID when vehicles populate
    useEffect(() => {
        if (selectedVehicleId && vehicles.length > 0) {
            const matched = vehicles.find(v => v.vehicleNumber === selectedVehicleId || v.id === selectedVehicleId);
            if (matched && matched.id !== selectedVehicleId) {
                setSelectedVehicleId(matched.id);
            }
        }
    }, [vehicles, selectedVehicleId]);

    // Update document.title
    useEffect(() => {
        let newTitle = 'SL-Tracker (v1)';
        if (selectedRoutes.length > 0 && selectedVehicleId) {
            const linesStr = selectedRoutes.map(r => r.line || r.id).join(', ');
            const matchedVehicle = vehicles.find(v => v.id === selectedVehicleId);
            const vId = matchedVehicle ? matchedVehicle.vehicleNumber : selectedVehicleId;
            newTitle = `SL-Tracker v1 - Linje ${linesStr} Vagn ${vId}`;
        } else if (selectedRoutes.length > 0) {
            const linesStr = selectedRoutes.map(r => r.line || r.id).join(', ');
            newTitle = `SL-Tracker v1 - Linje ${linesStr}`;
        } else if (selectedVehicleId) {
            const matchedVehicle = vehicles.find(v => v.id === selectedVehicleId);
            const vId = matchedVehicle ? matchedVehicle.vehicleNumber : selectedVehicleId;
            newTitle = `SL-Tracker v1 - Vagn ${vId}`;
        }
        document.title = newTitle;
    }, [selectedRoutes, selectedVehicleId, vehicles]);

    // Sync state changes to browser URL query parameters
    useEffect(() => {
        if (loading) return;
        const params = new URLSearchParams(window.location.search);

        params.set('agency', agency);

        if (selectedRoutes.length > 0) {
            params.set('lines', selectedRoutes.map(r => r.line || r.id).join(','));
        } else {
            params.delete('lines');
        }

        if (activeStop) {
            params.set('stop', activeStop.id);
        } else {
            params.delete('stop');
        }

        if (selectedVehicleId) {
            const matchedVehicle = vehicles.find(v => v.id === selectedVehicleId);
            const displayVehicleId = matchedVehicle ? matchedVehicle.vehicleNumber : selectedVehicleId;
            params.set('vehicle', displayVehicleId);
        } else {
            params.delete('vehicle');
        }

        params.delete('view');
        params.delete('hDate');
        params.delete('hTime');
        params.delete('hLine');
        params.delete('hStop');

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
    }, [agency, selectedRoutes, activeStop, selectedVehicleId, vehicles, loading]);

    const prevAgencyRef = useRef(agency);
    useEffect(() => {
        if (prevAgencyRef.current !== agency) {
            prevAgencyRef.current = agency;
            setSelectedVehicleId(null);
            setSelectedRoutes([]);
            setActiveStop(null);
            setHistory([]);
            setTripEvents([]);
        }
    }, [agency]);

    useEffect(() => {
        if (loading) return;
        const fetchData = async () => {
            const v = await slService.getLiveVehicles(agency);
            setVehicles(v);
        };
        fetchData();
        const i = setInterval(fetchData, 3000);
        return () => clearInterval(i);
    }, [loading, agency]);

    useEffect(() => {
        if (selectedVehicleId) {
            const v = vehicles.find(x => x.id === selectedVehicleId);
            if (v && v.line && !selectedRoutes.some(r => r.id === v.line)) {
                slService.getLineRoute(v.line).then((r: any) => {
                    if (r) {
                        setSelectedRoutes(prev => prev.some(pr => pr.id === r.id) ? prev : [...prev, r]);
                    }
                });
            }
        }
    }, [selectedVehicleId, vehicles, selectedRoutes]);

    // Poll vehicle trail and stop events for currently selected vehicle
    const selectedVehicleTripId = useMemo(() => {
        if (!selectedVehicleId) return null;
        return vehicles.find(x => x.id === selectedVehicleId)?.tripId || null;
    }, [selectedVehicleId, vehicles]);

    useEffect(() => {
        if (!selectedVehicleId || !selectedVehicleTripId) {
            setHistory([]);
            setTripEvents([]);
            activeTripIdRef.current = null;
            return;
        }

        const tripId = selectedVehicleTripId;
        activeTripIdRef.current = tripId;

        let isMounted = true;
        const fetchTrailAndEvents = async () => {
            try {
                const [hist, events] = await Promise.all([
                    slService.getVehicleHistory(tripId),
                    slService.getTripEvents(tripId)
                ]);
                if (isMounted) {
                    setHistory(hist);
                    setTripEvents(events);
                }
            } catch (err) {
                console.warn("Kunde inte hämta spår/händelser för vald buss (v1):", err);
            }
        };

        fetchTrailAndEvents();
        const interval = setInterval(fetchTrailAndEvents, 3500);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [selectedVehicleId, selectedVehicleTripId]);

    const stopPassages = useMemo(() => {
        if (!selectedVehicleId || selectedRoutes.length === 0 || (history.length === 0 && (!tripEvents || tripEvents.length === 0))) return new Map();
        const passages = new Map<string, { time: string, stopped: boolean, duration?: string, departureTime?: string, stopName?: string }>();

        selectedRoutes.forEach(route => {
            route.stops.forEach(stop => {
                const ev = tripEvents?.find(e => String(e.stopId) === String(stop.id));
                if (ev) {
                    const toSec = (t: string | number) => {
                        if (typeof t === "number") return t;
                        if (typeof t !== "string") return 0;
                        const parts = t.split(":");
                        return (Number(parts[0]) >= 24 ? Number(parts[0]) - 24 : Number(parts[0])) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0);
                    };

                    const formatTimeString = (t: string | number) => {
                        if (typeof t === "string") return t;
                        let h = Math.floor(t / 3600);
                        if (h >= 24) h -= 24;
                        const m = Math.floor((t % 3600) / 60);
                        const sec = t % 60;
                        return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
                    };

                    let isStopped = !!ev.stopped;
                    let durationStr = "";
                    if (ev.actualDeparture && ev.actualArrival) {
                        const depSec = toSec(ev.actualDeparture);
                        const arrSec = toSec(ev.actualArrival);
                        let durationSec = depSec - arrSec;
                        if (durationSec < -43200) durationSec += 86400;
                        if (durationSec >= 25) {
                            isStopped = true;
                        }
                        if (isStopped && durationSec > 0) {
                            const mins = Math.floor(durationSec / 60);
                            const secs = durationSec % 60;
                            durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                        }
                    }

                    const passageObj = {
                        time: ev.actualArrival ? formatTimeString(ev.actualArrival) : "",
                        stopped: isStopped,
                        duration: durationStr,
                        departureTime: ev.actualDeparture ? formatTimeString(ev.actualDeparture) : undefined,
                        stopName: stop.name
                    };
                    passages.set(stop.id, passageObj);
                    passages.set(String(stop.id), passageObj);

                    return;
                }

                const getDistance = (l1: any, n1: any, l2: any, n2: any) => {
                    const R = 6371e3, p1 = l1 * Math.PI / 180, p2 = l2 * Math.PI / 180, dp = (l2 - l1) * Math.PI / 180, dn = (n2 - n1) * Math.PI / 180;
                    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dn / 2) * Math.sin(dn / 2);
                    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                };

                const R = 6371e3;
                const getMeters = (p1lat: number, p1lng: number, p2lat: number, p2lng: number) => {
                    const dLat = (p2lat - p1lat) * Math.PI / 180;
                    const dLon = (p2lng - p1lng) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(p1lat * Math.PI / 180) * Math.cos(p2lat * Math.PI / 180) *
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
                    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                };

                const threshold = route.agency === 'WAAB' ? 120 : 65;
                let closestPt: any = null;
                let minDist = Infinity;

                const insidePoints = [];
                for (const pt of history) {
                    const d = getMeters(pt.lat, pt.lng, stop.lat, stop.lng);
                    if (d <= threshold) {
                        insidePoints.push(pt);
                    }
                    if (d < minDist) {
                        minDist = d;
                        closestPt = pt;
                    }
                }

                if (insidePoints.length > 0) {
                    let stopped = false;
                    let durationStr = "";
                    const firstPt = insidePoints[0];
                    const lastPt = insidePoints[insidePoints.length - 1];
                    let passageTime = firstPt.time || (firstPt.ts ? new Date(firstPt.ts).toLocaleTimeString('sv-SE') : "");
                    let departureTime: string | undefined = undefined;

                    if (insidePoints.length >= 2) {
                        const firstT = firstPt.time ? new Date(firstPt.time).getTime() : firstPt.ts;
                        const lastT = lastPt.time ? new Date(lastPt.time).getTime() : lastPt.ts;
                        const diffSeconds = Math.abs(Math.round((lastT - firstT) / 1000));

                        if (diffSeconds >= 25) {
                            stopped = true;
                            departureTime = lastPt.time || (lastPt.ts ? new Date(lastPt.ts).toLocaleTimeString('sv-SE') : undefined);
                            const mins = Math.floor(diffSeconds / 60);
                            const secs = diffSeconds % 60;
                            durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                        }
                    }

                    if (!stopped) {
                        stopped = insidePoints.some(pt => (pt.speed != null ? pt.speed < 2.0 : false));
                    }

                    passages.set(stop.id, {
                        time: passageTime,
                        stopped,
                        duration: durationStr,
                        departureTime,
                        stopName: stop.name
                    });
                } else if (minDist < threshold + 15 && closestPt) {
                    passages.set(stop.id, {
                        time: closestPt.time || (closestPt.ts ? new Date(closestPt.ts).toLocaleTimeString('sv-SE') : ""),
                        stopped: closestPt.speed != null ? closestPt.speed < 2.0 : false,
                        stopName: stop.name
                    });
                }
            });
        });

        return passages;
    }, [history, selectedRoutes, selectedVehicleId, tripEvents]);

    const handleClear = () => {
        setSelectedRoutes([]);
        setSelectedVehicleId(null);
        setActiveStop(null);
        setSearchQuery('');
        setHistory([]);
        setTripEvents([]);
        activeTripIdRef.current = null;
        setMapConfig({
            center: agency === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686],
            zoom: agency === 'WAAB' ? 10 : 12,
            bounds: undefined,
            timestamp: Date.now()
        });
    };

    const handleRemoveRoute = (routeId: string) => {
        const updated = selectedRoutes.filter(r => r.id !== routeId);
        setSelectedRoutes(updated);
        if (updated.length === 0) {
            setSelectedVehicleId(null);
            setActiveStop(null);
            setHistory([]);
            setTripEvents([]);
            activeTripIdRef.current = null;
            setMapConfig({
                center: agency === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686],
                zoom: agency === 'WAAB' ? 10 : 12,
                bounds: undefined,
                timestamp: Date.now()
            });
        } else {
            const b = L.latLngBounds(updated.flatMap(route => route.path));
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
        }
    };

    const handleSelect = async (res: any) => {
        if (res.type === 'line') {
            setSelectedVehicleId(null); setHistory([]);
            if (selectedRoutes.some(r => r.id === res.id)) return;
            const r = await slService.getLineRoute(res.id);
            if (r) {
                const newRoutes = [...selectedRoutes, r];
                setSelectedRoutes(newRoutes); setActiveStop(null);
                const b = L.latLngBounds(newRoutes.flatMap(route => route.path));
                setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
            }
        } else {
            setIsFollowingVehicle(false);
            const s = await slService.getStopInfo(res.id);
            if (s) {
                setActiveStop(s);
                setMapConfig({ center: [s.lat, s.lng], zoom: 16, bounds: undefined, timestamp: Date.now() });
            }
        }
    };

    if (loading) return <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-white"><RefreshCw className="w-12 h-12 animate-spin text-blue-500 mb-4" />Laddar trafikdata...</div>;

    return (
        <div className="relative w-full h-screen flex flex-col overflow-hidden bg-slate-900">

            {/* Top Toggle Switch & Global Header */}
            <div className="absolute top-6 right-6 z-[3000] pointer-events-auto flex items-center gap-3">
                <Link
                    to="/v2"
                    className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3.5 py-2.5 rounded-xl flex items-center gap-1.5 shadow-xl transition-all border border-blue-400/30 active:scale-95"
                    title="Gå till det nya v2-gränssnittet"
                >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Gå till v2</span>
                </Link>
            </div>
            <div className="absolute top-6 left-6 right-6 z-[2000] pointer-events-none flex flex-col items-start gap-2">
                <div className="w-full max-w-sm pointer-events-auto">
                    <SearchBar
                        onSelect={handleSelect}
                        onClear={handleClear}
                        activeRoute={null}
                        selectedRoutes={selectedRoutes}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        currentAgency={agency}
                        stopPassages={stopPassages}
                    />
                </div>

                {selectedRoutes.length > 0 && (
                    <div className="flex flex-wrap justify-start gap-2 pointer-events-auto max-w-3xl mt-1">
                        {selectedRoutes.map(route => {
                            const lineColorHex = getLineColor(route.line, route.agency);
                            const TransportIcon = getTransportIcon(route.line, route.agency);

                            const firstStop = route.stops && route.stops.length > 0 ? route.stops[0].name : '';
                            const lastStop = route.stops && route.stops.length > 0 ? route.stops[route.stops.length - 1].name : '';

                            const routeVehicles = vehicles.filter((v: any) => v.line === route.line);
                            const contractor = slService.getLineContractorSync(route.line);
                            let operator = "OKÄND";

                            if (route.agency === 'WAAB') operator = 'WAXHOLMSBOLAGET';
                            else if (contractor) operator = contractor.toUpperCase();
                            else operator = routeVehicles.length > 0 ? routeVehicles[0].operator.toUpperCase() : 'NOBINA';

                            return (
                                <div key={route.id} className="flex items-center bg-[#2b3343] text-white rounded-xl shadow-lg border border-[#3b4455] group h-[44px]">
                                    <div className="flex items-center gap-2 pl-3 pr-3">
                                        <TransportIcon className="w-[18px] h-[18px] shrink-0" style={{ color: lineColorHex }} />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-[13px] font-bold whitespace-nowrap leading-tight">Linje {route.line}</span>
                                            <span className="text-[9px] font-bold tracking-wider text-slate-400 leading-none uppercase mt-0.5">{operator}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-col min-w-0 pl-3 py-1 pr-1 border-l border-[#3b4455] h-full justify-center gap-0.5">
                                        <span className="text-[10px] text-slate-300 leading-none truncate w-24">{(firstStop || '').replace(/\s*\(.*\)/, '')}</span>
                                        <span className="text-[10px] text-slate-300 leading-none truncate w-24">{(lastStop || '').replace(/\s*\(.*\)/, '')}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); handleRemoveRoute(route.id); }} className="px-3 hover:bg-white/10 h-full rounded-r-xl transition-colors flex items-center justify-center">
                                        <X className="w-[14px] h-[14px] text-slate-400 group-hover:text-white" />
                                    </button>
                                </div>
                            );
                        })}
                        <button onClick={handleClear} className="flex items-center gap-2 bg-[#4a5568] hover:bg-[#3f4859] text-white px-3 py-1.5 h-[44px] rounded-xl shadow-lg border border-[#5a677d] transition-all text-[13px] font-semibold active:scale-95 group">
                            <Trash2 className="w-[14px] h-[14px]" /> <span>Rensa alla</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="absolute bottom-6 left-6 right-6 z-[1000] flex flex-col sm:flex-row justify-between items-end gap-4 pointer-events-none">
                <div className="bg-slate-900/90 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 pointer-events-auto w-full sm:w-[280px] max-h-[70vh] flex flex-col overflow-hidden">
                    {selectedVehicleId && vehicles.some(v => v.id === selectedVehicleId) ? (
                        <LiveVehicleStatus
                            vehicle={vehicles.find(v => v.id === selectedVehicleId)!}
                            lineShortName={routeManifest.get(vehicles.find(v => v.id === selectedVehicleId)?.line || '')?.line || '?'}
                            tripEvents={tripEvents}
                            onClose={() => setSelectedVehicleId(null)}
                            selectedRoutes={selectedRoutes}
                            isFollowingVehicle={isFollowingVehicle}
                            onToggleFollow={() => setIsFollowingVehicle(prev => !prev)}
                        />
                    ) : (
                        <div className="p-3">
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-3 flex items-center justify-between border-b border-white/5 pb-2">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Live Status
                                </div>
                            </div>
                            <div className="flex items-center justify-between gap-4 px-1 py-0.5">
                                <span className="text-xs text-slate-300 font-bold">{selectedRoutes.length > 0 ? `Fordon på valda linjer` : 'Fordon i trafik'}</span>
                                <span className="text-xs text-white font-bold bg-slate-800/50 px-2.5 py-1.5 rounded-xl border border-white/5 shadow-inner">
                                    {selectedRoutes.length > 0 ? vehicles.filter(v => selectedRoutes.some(r => r.id === v.line)).length : vehicles.length}
                                </span>
                            </div>
                        </div>
                    )}

                    <div className="p-3 border-t border-white/5 space-y-3 shrink-0 bg-slate-900/40">
                        <div className="flex items-center justify-between gap-8 px-1">
                            <span className="text-xs text-slate-300 font-bold">Visa all trafik</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 border border-white/5 shadow-inner"></div>
                            </label>
                        </div>
                        <div className="flex items-center justify-between gap-8 pt-3 border-t border-white/5 px-1">
                            <span className="text-xs text-slate-300 font-bold">Detaljerad karta</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={mapStyle === 'standard'} onChange={e => setMapStyle(e.target.checked ? 'standard' : 'minimal')} className="sr-only peer" />
                                <div className="w-11 h-6 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 border border-white/5 shadow-inner"></div>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="pointer-events-auto w-full sm:w-auto">
                    <VehicleSearch
                        currentAgency={agency}
                        onAgencyChange={(a) => {
                            setAgency(a);
                            setMapConfig({ center: a === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686], zoom: a === 'WAAB' ? 10 : 12 });
                        }}
                        onVehicleFound={async (v, routeId) => {
                            setSelectedVehicleId(null);
                            setHistory([]);
                            if (!selectedRoutes.some(r => r.id === routeId)) {
                                const r = await slService.getLineRoute(routeId);
                                if (r) {
                                    setSelectedRoutes(prev => [...prev, r]);
                                    const b = L.latLngBounds(r.path);
                                    setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b });
                                }
                            }
                            setTimeout(() => setSelectedVehicleId(v.id), 50);
                        }}
                        lastUpdated={lastUpdated}
                    />
                </div>
            </div>

            <LiveMap
                mapStyle={mapStyle}
                vehicles={vehicles}
                showAll={showAll}
                selectedRoutes={selectedRoutes}
                selectedVehicleId={selectedVehicleId}
                setSelectedVehicleId={setSelectedVehicleId}
                routeManifest={routeManifest}
                mapConfig={mapConfig}
                activeStop={activeStop}
                setActiveStop={setActiveStop}
                stopPassages={stopPassages}
                history={history}
                tripEvents={tripEvents}
                isFollowingVehicle={isFollowingVehicle}
            />
        </div>
    );
}
