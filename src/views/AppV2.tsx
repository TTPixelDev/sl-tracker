import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { slService } from '../services/slService';
import { SLVehicle, SLLineRoute, SLStop, HistoryPoint } from '../types';
import LiveMap from '../components/LiveMap';
import { NavbarV2 } from '../components/v2/NavbarV2';
import { LineChipsBar } from '../components/v2/LineChipsBar';
import { VehicleSidebar } from '../components/v2/VehicleSidebar';
import L from 'leaflet';

export default function AppV2() {
    const [loading, setLoading] = useState(true);

    // Map style: standard (detailed) or minimal (sleek). Default off/minimal unless saved
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

    // Agency: SL or WAAB
    const [agency, setAgency] = useState<'SL' | 'WAAB'>(() => {
        const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
        const a = params.get('agency');
        return a === 'WAAB' ? 'WAAB' : 'SL';
    });

    // Show all vehicles toggle (default off/false unless saved in localStorage)
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

    // Auto-follow vehicle (default off/false unless saved in localStorage)
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

    // Data state
    const [vehicles, setVehicles] = useState<SLVehicle[]>([]);
    const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const [selectedRoutes, setSelectedRoutes] = useState<SLLineRoute[]>([]);
    const [activeStop, setActiveStop] = useState<SLStop | null>(null);
    const [mapConfig, setMapConfig] = useState<any>({ center: [59.3293, 18.0686], zoom: 12 });
    const [routeManifest, setRouteManifest] = useState<Map<string, any>>(new Map());
    const [history, setHistory] = useState<HistoryPoint[]>([]);
    const [tripEvents, setTripEvents] = useState<any[]>([]);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const activeTripIdRef = useRef<string | null>(null);
    const lastHistoryFetchRef = useRef<number>(0);
    const currentTripIdRef = useRef<string | null>(null);

    // Initialize data and load URL parameters
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

    // Resolve short vehicleNumber from URL to full vehicle ID
    useEffect(() => {
        if (selectedVehicleId && vehicles.length > 0) {
            const matched = vehicles.find(v => v.vehicleNumber === selectedVehicleId || v.id === selectedVehicleId);
            if (matched && matched.id !== selectedVehicleId) {
                setSelectedVehicleId(matched.id);
            }
        }
    }, [vehicles, selectedVehicleId]);

    // Update document title
    useEffect(() => {
        let newTitle = 'SL Tracker';
        if (selectedRoutes.length > 0 && selectedVehicleId) {
            const linesStr = selectedRoutes.map(r => r.line || r.id).join(', ');
            const matchedVehicle = vehicles.find(v => v.id === selectedVehicleId);
            const vId = matchedVehicle ? matchedVehicle.vehicleNumber : selectedVehicleId;
            newTitle = `SL Tracker - Linje ${linesStr} Vagn ${vId}`;
        } else if (selectedRoutes.length > 0) {
            const linesStr = selectedRoutes.map(r => r.line || r.id).join(', ');
            newTitle = `SL Tracker - Linje ${linesStr}`;
        } else if (selectedVehicleId) {
            const matchedVehicle = vehicles.find(v => v.id === selectedVehicleId);
            const vId = matchedVehicle ? matchedVehicle.vehicleNumber : selectedVehicleId;
            newTitle = `SL Tracker - Vagn ${vId}`;
        }
        document.title = newTitle;
    }, [selectedRoutes, selectedVehicleId, vehicles]);

    // Sync state to URL query parameters
    useEffect(() => {
        if (loading) return;
        const params = new URLSearchParams(window.location.search);

        params.set('agency', agency);
        params.delete('view');

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

        params.delete('hDate');
        params.delete('hTime');
        params.delete('hLine');
        params.delete('hStop');

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, '', newUrl);
    }, [agency, selectedRoutes, activeStop, selectedVehicleId, vehicles, loading]);

    // Reset selection on agency switch
    const prevAgencyRef = useRef(agency);
    useEffect(() => {
        if (prevAgencyRef.current !== agency) {
            prevAgencyRef.current = agency;
            setSelectedVehicleId(null);
            setSelectedRoutes([]);
            setActiveStop(null);
            setHistory([]);
            setTripEvents([]);
            setMapConfig({
                center: agency === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686],
                zoom: agency === 'WAAB' ? 10 : 12
            });
        }
    }, [agency]);

    // Live vehicles poller (pure real-time from Trafiklab)
    useEffect(() => {
        if (loading) return;
        const fetchData = async () => {
            const v = await slService.getLiveVehicles(agency);
            setVehicles(v);
        };
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [loading, agency]);

    // Route auto-loader for selected vehicle
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
    useEffect(() => {
        if (!selectedVehicleId) {
            setHistory([]);
            setTripEvents([]);
            activeTripIdRef.current = null;
            return;
        }

        const vehicle = vehicles.find(x => x.id === selectedVehicleId);
        if (!vehicle || !vehicle.tripId) return;

        const tripId = vehicle.tripId;
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
                console.warn("Kunde inte hämta spår/händelser för vald buss:", err);
            }
        };

        fetchTrailAndEvents();
        const interval = setInterval(fetchTrailAndEvents, 3500);
        return () => {
            isMounted = false;
            clearInterval(interval);
        };
    }, [selectedVehicleId, vehicles]);

    // Calculated stop passages
    const stopPassages = useMemo(() => {
        if (!selectedVehicleId || selectedRoutes.length === 0 || (history.length === 0 && (!tripEvents || tripEvents.length === 0))) {
            return new Map();
        }
        const passages = new Map<string, { time: string, stopped: boolean, duration?: string, departureTime?: string, stopName?: string }>();

        selectedRoutes.forEach(route => {
            (route.stops || []).forEach(stop => {
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

                const getMeters = (p1lat: number, p1lng: number, p2lat: number, p2lng: number) => {
                    const R = 6371e3;
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

    // Helper to get default map config (restores panning to overview)
    const getDefaultMapConfig = useCallback(() => ({
        center: (agency === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686]) as [number, number],
        zoom: agency === 'WAAB' ? 10 : 12,
        bounds: undefined,
        timestamp: Date.now()
    }), [agency]);

    // Handler: Select a line from search
    const handleSelectRoute = async (routeId: string) => {
        setSelectedVehicleId(null);
        if (selectedRoutes.some(r => r.id === routeId)) return;

        const r = await slService.getLineRoute(routeId);
        if (r) {
            const newRoutes = [...selectedRoutes, r];
            setSelectedRoutes(newRoutes);
            setActiveStop(null);
            const b = L.latLngBounds(newRoutes.flatMap(route => route.path));
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
        }
    };

    // Handler: Select a stop from search (preserves vehicle marking!)
    const handleSelectStop = (stop: SLStop) => {
        setIsFollowingVehicle(false);
        setActiveStop(stop);
        setMapConfig({ center: [stop.lat, stop.lng], zoom: 16, bounds: undefined, timestamp: Date.now() });
    };

    // Handler: Deselect / remove active stop search (restores panning, preserves vehicle!)
    const handleRemoveStop = () => {
        setActiveStop(null);
        if (selectedVehicleId) {
            const v = vehicles.find(veh => veh.id === selectedVehicleId);
            if (v) {
                setIsFollowingVehicle(true);
                setMapConfig({ center: [v.lat, v.lng], zoom: 14, bounds: undefined, timestamp: Date.now() });
                return;
            }
        }
        if (selectedRoutes.length > 0) {
            const b = L.latLngBounds(selectedRoutes.flatMap(route => route.path));
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
        } else {
            setMapConfig(getDefaultMapConfig());
        }
    };

    // Handler: Select a vehicle (e.g. from 4-digit search or map click)
    const handleSelectVehicle = async (v: SLVehicle, routeId: string) => {
        setSelectedVehicleId(null);

        if (!selectedRoutes.some(r => r.id === routeId)) {
            const r = await slService.getLineRoute(routeId);
            if (r) {
                setSelectedRoutes(prev => [...prev, r]);
                const b = L.latLngBounds(r.path);
                setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
            }
        } else {
            setMapConfig({ center: [v.lat, v.lng], zoom: 14, bounds: undefined, timestamp: Date.now() });
        }

        setTimeout(() => setSelectedVehicleId(v.id), 50);
    };

    // Handler: Remove route (restores panning)
    const handleRemoveRoute = (routeId: string) => {
        const updated = selectedRoutes.filter(r => r.id !== routeId);
        setSelectedRoutes(updated);
        if (updated.length === 0) {
            setSelectedVehicleId(null);
            setActiveStop(null);
            activeTripIdRef.current = null;
            setMapConfig(getDefaultMapConfig());
        } else {
            const b = L.latLngBounds(updated.flatMap(route => route.path));
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
        }
    };

    // Handler: Clear all routes, stops, and vehicle selection (restores panning)
    const handleClearAll = () => {
        setSelectedRoutes([]);
        setSelectedVehicleId(null);
        setActiveStop(null);
        activeTripIdRef.current = null;
        setMapConfig(getDefaultMapConfig());
    };

    // Map click handler: Deselecting active stop or vehicle (restores panning)
    const handleMapClick = () => {
        if (activeStop) {
            // If a stop was active, clicking map deselects the stop and restores panning
            handleRemoveStop();
        } else if (selectedVehicleId) {
            setSelectedVehicleId(null);
            if (selectedRoutes.length > 0) {
                const b = L.latLngBounds(selectedRoutes.flatMap(route => route.path));
                setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b, timestamp: Date.now() });
            } else {
                setMapConfig(getDefaultMapConfig());
            }
        }
    };

    const selectedVehicleObj = useMemo(() => {
        if (!selectedVehicleId) return null;
        return vehicles.find(v => v.id === selectedVehicleId) || null;
    }, [selectedVehicleId, vehicles]);

    if (loading) {
        return (
            <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-white">
                <RefreshCw className="w-10 h-10 animate-spin text-blue-500 mb-4" />
                <span className="font-semibold text-sm">Laddar SL Tracker v2...</span>
            </div>
        );
    }

    return (
        <div className="relative w-full h-screen flex flex-col overflow-hidden bg-slate-950 text-white">
            {/* Top Navbar */}
            <NavbarV2
                agency={agency}
                onAgencyChange={setAgency}
                showAll={showAll}
                onToggleShowAll={setShowAll}
                mapStyle={mapStyle}
                onToggleMapStyle={setMapStyle}
                isFollowingVehicle={isFollowingVehicle}
                onToggleFollow={() => setIsFollowingVehicle(prev => !prev)}
                onSelectRoute={handleSelectRoute}
                onSelectStop={handleSelectStop}
                onSelectVehicle={handleSelectVehicle}
                selectedRoutes={selectedRoutes}
                vehicles={vehicles}
                lastUpdated={lastUpdated}
            />

            {/* Selected line chips bar directly below navbar */}
            <LineChipsBar
                selectedRoutes={selectedRoutes}
                onRemoveRoute={handleRemoveRoute}
                onClearAll={handleClearAll}
                vehicles={vehicles}
                activeStop={activeStop}
                onRemoveStop={handleRemoveStop}
            />

            {/* Docked Left Sidebar for Vehicle & Driven Stops */}
            {selectedVehicleObj && (
                <VehicleSidebar
                    vehicle={selectedVehicleObj}
                    lineShortName={routeManifest.get(selectedVehicleObj.line || '')?.line || '?'}
                    tripEvents={tripEvents}
                    onClose={() => {
                        setSelectedVehicleId(null);
                        if (selectedRoutes.length > 0) {
                            const b = L.latLngBounds(selectedRoutes.flatMap(route => route.path));
                            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b });
                        } else if (!activeStop) {
                            setMapConfig(getDefaultMapConfig());
                        }
                    }}
                    selectedRoutes={selectedRoutes}
                    isFollowingVehicle={isFollowingVehicle}
                    onToggleFollow={() => setIsFollowingVehicle(prev => !prev)}
                />
            )}

            {/* Interactive Live Map */}
            <div className="flex-1 w-full h-full pt-14">
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
                    onMapClick={handleMapClick}
                />
            </div>
        </div>
    );
}
