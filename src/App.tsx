import React, { useState, useEffect, useRef, useMemo } from 'react';
import { RefreshCw, Map as MapIcon, History as HistoryIcon, Trash2 } from 'lucide-react';
import { slService } from './services/slService';
import { SLVehicle, SLLineRoute, SLStop, HistoryPoint } from './types';
import LiveMap, { getLineColor, getTransportIcon } from './components/LiveMap';
import SearchBar from './components/SearchBar';
import VehicleSearch from './components/VehicleSearch';
import HistoryView from './components/HistoryView';
import L from 'leaflet';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: any[]) {
    return twMerge(clsx(inputs));
}

export default function App() {
  const [view, setView] = useState<'live' | 'history'>('live');
  const [loading, setLoading] = useState(true);
  
  // Live state
  const [agency, setAgency] = useState<'SL' | 'WAAB'>('SL');
  const [vehicles, setVehicles] = useState<SLVehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [selectedRoutes, setSelectedRoutes] = useState<SLLineRoute[]>([]);
  const [activeStop, setActiveStop] = useState<SLStop | null>(null);
  const [mapConfig, setMapConfig] = useState<any>({ center: [59.3293, 18.0686], zoom: 12 });
  const [routeManifest, setRouteManifest] = useState<Map<string, any>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  
  const activeTripIdRef = useRef<string | null>(null);
  const lastHistoryFetchRef = useRef<number>(0);
  const currentTripIdRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      await slService.initialize();
      const m = await slService.getManifest();
      setRouteManifest(new Map(m.map((x: any) => [x.id, x])));
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (loading || view !== 'live') return;
    const fetchData = async () => {
      const v = await slService.getLiveVehicles(agency);
      setVehicles(v);
    };
    fetchData();
    const i = setInterval(fetchData, 3000);
    return () => clearInterval(i);
  }, [loading, agency, view]);

  useEffect(() => {
    if (view !== 'live') return;
    if (selectedVehicleId) {
        const v = vehicles.find(x => x.id === selectedVehicleId);
        if (v) {
            currentTripIdRef.current = v.tripId;
            const now = Date.now();
            
            if (activeTripIdRef.current !== v.tripId || now - lastHistoryFetchRef.current >= 5000) {
                activeTripIdRef.current = v.tripId;
                lastHistoryFetchRef.current = now;
                
                slService.getVehicleHistory(v.tripId).then((h: any) => {
                    if (currentTripIdRef.current === v.tripId) {
                        setHistory(h);
                    }
                });
            }
            
            if (!selectedRoutes.some(r => r.id === v.line)) {
                slService.getLineRoute(v.line).then((r: any) => {
                    if (currentTripIdRef.current === v.tripId && r) {
                        setSelectedRoutes(prev => prev.some(pr => pr.id === r.id) ? prev : [...prev, r]);
                    }
                });
            }
        }
    } else {
        currentTripIdRef.current = null;
        activeTripIdRef.current = null;
        lastHistoryFetchRef.current = 0;
        setHistory([]);
    }
  }, [selectedVehicleId, vehicles, view]); 

  const stopPassages = useMemo(() => {
    if (selectedRoutes.length === 0 || history.length === 0) return new Map();
    const passages = new Map<string, { time: string, stopped: boolean, duration?: string, departureTime?: string }>();
    
    selectedRoutes.forEach(route => {
        route.stops.forEach(stop => {
            const getDistance = (l1:any, n1:any, l2:any, n2:any) => {
              const R = 6371e3, p1 = l1*Math.PI/180, p2 = l2*Math.PI/180, dp = (l2-l1)*Math.PI/180, dn = (n2-n1)*Math.PI/180;
              const a = Math.sin(dp/2)*Math.sin(dp/2) + Math.cos(p1)*Math.cos(p2)*Math.sin(dn/2)*Math.sin(dn/2);
              return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            };
            const anyNearbyPoints = history.filter(p => getDistance(p.lat, p.lng, stop.lat, stop.lng) < 100);
            
            if (anyNearbyPoints.length > 0) {
                anyNearbyPoints.sort((a, b) => a.ts - b.ts);
                let arrivalTime = new Date(anyNearbyPoints[0].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                
                const strictPoints = anyNearbyPoints.filter(p => getDistance(p.lat, p.lng, stop.lat, stop.lng) < 35);
                let isActuallyStopped = false;
                let durationStr = "";
                let departureTimeStr = "";

                if (strictPoints.length >= 2) {
                    const durationSec = Math.round((strictPoints[strictPoints.length - 1].ts - strictPoints[0].ts) / 1000);
                    if (durationSec > 10) {
                        isActuallyStopped = true;
                        arrivalTime = new Date(strictPoints[0].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        const mins = Math.floor(durationSec / 60);
                        const secs = durationSec % 60;
                        durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                        departureTimeStr = new Date(strictPoints[strictPoints.length - 1].ts).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    }
                }

                passages.set(stop.id, {
                    time: arrivalTime,
                    stopped: isActuallyStopped,
                    duration: durationStr,
                    departureTime: departureTimeStr
                });
            }
        });
    });
    return passages;
  }, [selectedRoutes, history]);

  const handleClear = () => { 
    setSelectedRoutes([]); setActiveStop(null); setSelectedVehicleId(null); setHistory([]);
    setMapConfig({ center: agency === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686], zoom: agency === 'WAAB' ? 10 : 12}); 
    setSearchQuery(''); 
  };

  const handleRemoveRoute = (routeId: string) => {
      const newRoutes = selectedRoutes.filter(r => r.id !== routeId);
      setSelectedRoutes(newRoutes);
      if (newRoutes.length === 0) handleClear();
      else {
          const allPoints = newRoutes.flatMap(r => r.path);
          if (allPoints.length > 0) {
              const b = L.latLngBounds(allPoints);
              setMapConfig((prev: any) => ({ ...prev, bounds: b }));
          }
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
            setMapConfig({ center: [b.getCenter().lat, b.getCenter().lng], zoom: 12, bounds: b }); 
        }
    } else {
        setSelectedVehicleId(null); setHistory([]);
        const s = await slService.getStopInfo(res.id);
        if (s) { 
            setActiveStop(s); 
            setMapConfig({ center: [s.lat, s.lng], zoom: 16 }); 
        }
    }
  };

  if (loading) return <div className="h-screen flex flex-col items-center justify-center bg-slate-900 text-white"><RefreshCw className="w-12 h-12 animate-spin text-blue-500 mb-4" />Laddar trafikdata...</div>;

  return (
    <div className="relative w-full h-screen flex flex-col overflow-hidden bg-slate-900">
      
      {/* Top Toggle Switch & Global Header */}
      <div className="absolute top-4 right-4 z-[3000] pointer-events-auto">
         <div className="bg-slate-800/90 backdrop-blur-xl p-1 rounded-xl flex border border-white/10 shadow-2xl">
            <button 
              onClick={() => setView('live')} 
              className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all", view === 'live' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white')}
            >
              <MapIcon className="w-4 h-4" /> Live
            </button>
            <button 
              onClick={() => setView('history')} 
              className={cn("flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all", view === 'history' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:text-white')}
            >
              <HistoryIcon className="w-4 h-4" /> Historik
            </button>
         </div>
      </div>

      {view === 'live' ? (
        <>
            <div className="absolute top-4 left-0 right-0 z-[2000] px-4 pointer-events-none flex flex-col items-center gap-2">
                <div className="w-full max-w-lg pointer-events-auto mr-auto ml-10">
                    {/* Padding so it doesn't overlap left menu if we add one, or the toggle */}
                    <div className="pr-32 max-w-sm rounded-xl">
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
                </div>

                {selectedRoutes.length > 0 && (
                    <div className="flex flex-wrap justify-start gap-2 pointer-events-auto max-w-3xl mr-auto ml-10 mt-2">
                        {selectedRoutes.map(route => {
                            const lineColorHex = getLineColor(route.line, route.agency);
                            const TransportIcon = getTransportIcon(route.line, route.agency);
                            return (
                                <div key={route.id} className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-md text-white pl-3 pr-2 py-1.5 rounded-xl shadow-lg border border-white/10 group hover:bg-slate-800 transition-colors">
                                    <TransportIcon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: lineColorHex }} />
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs font-bold whitespace-nowrap leading-none">Linje {route.line}</span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); handleRemoveRoute(route.id); }} className="p-1 hover:bg-white/10 rounded-full transition-colors ml-1">
                                        <Trash2 className="w-3.5 h-3.5 text-slate-400 group-hover:text-red-400" />
                                    </button>
                                </div>
                            );
                        })}
                        <button onClick={handleClear} className="flex items-center gap-2 bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-1.5 rounded-xl shadow-lg border border-white/10 backdrop-blur-md transition-all text-xs font-bold active:scale-95 group h-full">
                            <Trash2 className="w-3.5 h-3.5" /> <span>Rensa alla</span>
                        </button>
                    </div>
                )}
            </div>

            <div className="absolute bottom-6 left-6 right-6 z-[1000] flex flex-col sm:flex-row justify-between items-end gap-4 pointer-events-none">
                <div className="bg-slate-900/90 backdrop-blur-xl p-4 rounded-2xl shadow-2xl border border-white/10 pointer-events-auto w-full sm:w-auto sm:min-w-[280px]">
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-4 flex items-center justify-between border-b border-white/5 pb-2">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Live Status
                        </div>
                    </div>
                    <div className="space-y-4">
                        <div className="flex items-center justify-between gap-4 px-1">
                            <span className="text-xs text-slate-300 font-bold">{selectedRoutes.length > 0 ? `Fordon på valda linjer` : 'Fordon i trafik'}</span>
                            <span className="text-xs text-white font-bold bg-slate-800/50 px-2.5 py-1.5 rounded-xl border border-white/5 shadow-inner">
                                {selectedRoutes.length > 0 ? vehicles.filter(v => selectedRoutes.some(r => r.id === v.line)).length : vehicles.length}
                            </span>
                        </div>
                        <div className="flex items-center justify-between gap-8 pt-3 border-t border-white/5 px-1">
                            <span className="text-xs text-slate-300 font-bold">Visa all trafik</span>
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} className="sr-only peer" />
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
                        setMapConfig({ center: a === 'WAAB' ? [59.35, 18.65] : [59.3293, 18.0686], zoom: a === 'WAAB' ? 10 : 12});
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
                    />
                </div>
            </div>
            
            <LiveMap 
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
            />
        </>
      ) : (
          <HistoryView />
      )}
    </div>
  );
}
