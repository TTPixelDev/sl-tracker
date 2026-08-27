import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, Tooltip, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { slService } from '../services/slService';
import { SLVehicle, SLLineRoute, SearchResult, SLStop, HistoryPoint } from '../types';
import { Ship, TrainFront, TramFront, Train, Bus, Clock } from 'lucide-react';
import { getLineColor, getTransportIcon } from '../utils/mapUtils';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface MapView {
  center: [number, number];
  zoom: number;
  bounds?: L.LatLngBoundsExpression;
}

const SL_DEFAULT_VIEW: MapView = {
  center: [59.3293, 18.0686],
  zoom: 12,
  bounds: undefined
};

const WAAB_DEFAULT_VIEW: MapView = {
  center: [59.35, 18.65],
  zoom: 10,
  bounds: undefined
};

const VehicleMarker: React.FC<any> = ({ vehicle, lineShortName, isSelected, onSelect, onDeselect }) => {
  const isNoBearing = ['7', '12', '21', '25', '26', '27', '28', '29', '30', '31'].includes(lineShortName);
  
  const icon = useMemo(() => {
    const color = getLineColor(lineShortName, vehicle.agency);
    
    let markerHtml = '';
    if (isNoBearing) {
      markerHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; position: relative;">' +
        '<div style="width: ' + (isSelected ? '28px' : '20px') + '; height: ' + (isSelected ? '28px' : '20px') + '; background: ' + color + '; border: ' + (isSelected ? '4px' : '3px') + ' solid white; border-radius: 50%; box-shadow: 0 ' + (isSelected ? '4px 12px rgba(0,0,0,0.8)' : '2px 8px rgba(0,0,0,0.5)') + '; transition: all 0.2s ease;"></div>' +
        '<div style="position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: ' + color + '; color: white; padding: 1px 6px; border-radius: 4px; font-size: ' + (isSelected ? '12px' : '10px') + '; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2); z-index: 10;">' +
        lineShortName +
        '</div>' +
        '</div>';
    } else {
      markerHtml = '<div style="width: ' + (isSelected ? '44px' : '34px') + '; height: ' + (isSelected ? '44px' : '34px') + '; display: flex; align-items: center; justify-content: center; position: relative; transition: all 0.2s ease;">' +
        '<div style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; transform: rotate(' + vehicle.bearing + 'deg);">' +
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; filter: drop-shadow(0 ' + (isSelected ? '4px 8px rgba(0,0,0,0.6)' : '2px 4px rgba(0,0,0,0.4)') + ');">' +
        '<path d="M12 2L4 21L12 17L20 21L12 2Z" fill="' + color + '" stroke="white" stroke-width="' + (isSelected ? '3' : '2') + '" stroke-linejoin="round"/>' +
        '</svg>' +
        '</div>' +
        '<div style="position: absolute; top: -15px; left: 50%; transform: translateX(-50%); background: ' + color + '; color: white; padding: 1px 5px; border-radius: 3px; font-size: ' + (isSelected ? '11px' : '9px') + '; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10;">' +
        lineShortName +
        '</div>' +
        '</div>';
    }

    return L.divIcon({
        className: 'custom-vehicle-icon ' + (isSelected ? 'z-[1000]' : ''),
        html: markerHtml,
        iconSize: isNoBearing ? (isSelected ? [48, 48] : [40, 40]) : (isSelected ? [44, 44] : [34, 34]),
        iconAnchor: isNoBearing ? (isSelected ? [24, 24] : [20, 20]) : (isSelected ? [22, 22] : [17, 17])
      });
  }, [vehicle.bearing, lineShortName, vehicle.agency, isSelected, isNoBearing]); 

  return (
    <Marker 
      position={[vehicle.lat, vehicle.lng]} 
      icon={icon} 
      eventHandlers={{ 
        click: (e: any) => {
          if (e.originalEvent) {
            L.DomEvent.stop(e.originalEvent);
          }
          isSelected ? onDeselect() : onSelect(vehicle.id);
        }
      }}
      zIndexOffset={isSelected ? 1000 : 0}
    />
  );
};

const StopContent = ({ s, routeLine, passage }: any) => {
  const lineStr = routeLine || (Array.isArray(s.lines) ? s.lines.join(', ') : s.lines);
  return (
    <div className="p-1 font-sans">
        <div className="text-xs font-bold text-slate-900 select-text">{s.name}</div>
        {lineStr && <div className="text-[10px] text-slate-500 font-semibold select-text">Linje {lineStr}</div>}
        {passage && (
            <div className="mt-1 flex flex-col gap-0.5">
                {passage.stopped ? (
                    <>
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                            <Clock className="w-3 h-3" />
                            Ankom: {passage.time} {passage.duration && `(${passage.duration})`}
                        </div>
                        {passage.departureTime && (
                            <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                                <Clock className="w-3 h-3 opacity-0" />
                                Avgick: {passage.departureTime}
                            </div>
                        )}
                    </>
                ) : (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-600">
                        <Clock className="w-3 h-3" />
                        Passerade {passage.time}
                    </div>
                )}
            </div>
        )}
    </div>
  );
};

const isSameStop = (a: any, b: any) => {
    if (!a || !b) return false;
    if (String(a.id) === String(b.id)) return true;
    if (a.name && b.name && a.name.trim().toLowerCase() === b.name.trim().toLowerCase()) return true;
    return false;
};

const getPassage = (s: any, stopPassages: Map<string, any>) => {
    if (!s || !stopPassages || stopPassages.size === 0) return undefined;
    let p = stopPassages.get(s.id) || stopPassages.get(String(s.id));
    if (p) return p;
    if (s.name) {
        const norm = s.name.trim().toLowerCase();
        for (const [, val] of stopPassages.entries()) {
            if (val && val.stopName && val.stopName.trim().toLowerCase() === norm) {
                return val;
            }
        }
    }
    return undefined;
};

const ActiveStopMarker = ({ activeStop, selectedRoutes, stopPassages }: any) => {
    if (!activeStop) return null;

    const isAlreadyRendered = selectedRoutes.some((r: any) => 
        r.stops?.some((s: any) => isSameStop(s, activeStop))
    );
    if (isAlreadyRendered) return null;

    const passage = getPassage(activeStop, stopPassages);
    
    let lineForColor = activeStop.lines;
    if (Array.isArray(lineForColor)) lineForColor = lineForColor[0];
    const standardColor = lineForColor ? getLineColor(String(lineForColor), 'SL') : "#3b82f6";

    return (
        <CircleMarker 
            key={"active-stop-standalone-" + activeStop.id}
            center={[activeStop.lat, activeStop.lng]} 
            radius={8}
            fillColor={passage ? (passage.stopped ? "#10b981" : "#f59e0b") : "#3b82f6"}
            fillOpacity={1} 
            color="#1d4ed8" 
            weight={4}
            eventHandlers={{
                click: (e: any) => {
                    if (e.originalEvent) {
                        L.DomEvent.stopPropagation(e.originalEvent);
                    }
                }
            }}
        >
            <Tooltip 
                key={"perm-standalone-" + activeStop.id}
                permanent 
                direction="top" 
                offset={[0, -10]} 
                opacity={1} 
                className="custom-tooltip"
            >
                <StopContent s={activeStop} routeLine={null} passage={passage} />
            </Tooltip>
        </CircleMarker>
    );
};

const MapController = ({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => {
    try {
      if (bounds) {
        map.fitBounds(bounds, { padding: [50, 50] });
      } else if (center && typeof center[0] === 'number' && typeof center[1] === 'number') {
        map.setView(center, zoom);
      }
    } catch (e) {}
  }, [center, zoom, bounds, map]);
  return null;
};

const SelectedVehicleTracker = ({ selectedVehicleId, vehicles, isFollowingVehicle }: { selectedVehicleId: string | null, vehicles: SLVehicle[], isFollowingVehicle?: boolean }) => {
  const map = useMap();
  useEffect(() => {
    if (isFollowingVehicle !== false && selectedVehicleId && Array.isArray(vehicles)) {
      const v = vehicles.find((v: any) => v && v.id === selectedVehicleId);
      if (v && typeof v.lat === 'number' && typeof v.lng === 'number' && !isNaN(v.lat) && !isNaN(v.lng)) {
        try {
          map.panTo([v.lat, v.lng], { animate: true });
        } catch (e) {
          try {
            map.setView([v.lat, v.lng]);
          } catch (err) {}
        }
      }
    }
  }, [selectedVehicleId, vehicles, map, isFollowingVehicle]);
  return null;
};

const EventController = ({ onMapClick }: { onMapClick: () => void }) => {
  useMapEvents({
    click(e: any) {
      const target = e.originalEvent?.target as HTMLElement | undefined;
      if (target) {
        if (
          target.tagName === 'path' ||
          target.tagName === 'circle' ||
          target.closest('.leaflet-marker-icon') ||
          target.closest('.leaflet-interactive') ||
          target.closest('.leaflet-tooltip') ||
          target.closest('.custom-tooltip')
        ) {
          return;
        }
      }
      onMapClick();
    }
  });
  return null;
};

export default function LiveMap({ vehicles, showAll, selectedRoutes, selectedVehicleId, setSelectedVehicleId, routeManifest, mapConfig, activeStop, setActiveStop, stopPassages, history, tripEvents, isFollowingVehicle }: any) {
  return (
      <MapContainer center={mapConfig.center} zoom={mapConfig.zoom} zoomControl={false} className="flex-1 w-full h-full z-0">
        <TileLayer 
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' 
        />
        <MapController center={mapConfig.center} zoom={mapConfig.zoom} bounds={mapConfig.bounds} />
        <SelectedVehicleTracker selectedVehicleId={selectedVehicleId} vehicles={vehicles} isFollowingVehicle={isFollowingVehicle} />
        <EventController onMapClick={() => { setSelectedVehicleId(null); setActiveStop(null); }} />
        
        {selectedRoutes.map((route: any) => {
            const standardColor = route.agency === 'WAAB' ? "#0891b2" : "#3b82f6";
            
            // Filter stops based on whether a vehicle is selected or not
            let stopsToRender = route.stops || [];
            const selectedVehicle = vehicles.find((v: any) => v.id === selectedVehicleId);
            const isThisVehicleSelected = selectedVehicle && selectedVehicle.line === route.id;

            if (isThisVehicleSelected) {
                const dirId = selectedVehicle.directionId;
                
                // 1. Initial filter based on direction
                let candidates = [];
                if (dirId !== undefined) {
                    candidates = (route.stops || []).filter((s: any) => s.directions && s.directions.includes(dirId));
                }
                
                // Fall back if no candidates found or direction was undefined
                if (candidates.length === 0) {
                    candidates = route.stops || [];
                }

                // 2. Clear any name duplicates from candidates to avoid opposite/dual platform circles
                const seenNames = new Set<string>();
                stopsToRender = [];
                for (const s of candidates) {
                    const normalizedName = s.name.trim().toLowerCase();
                    if (!seenNames.has(normalizedName)) {
                        seenNames.add(normalizedName);
                        stopsToRender.push(s);
                    }
                }
            } else {
                // Deduplicate stops by name to avoid overlapping/dual opposite platform points
                const seenNames = new Set<string>();
                stopsToRender = [];
                for (const s of (route.stops || [])) {
                    const normalizedName = s.name.trim().toLowerCase();
                    if (!seenNames.has(normalizedName)) {
                        seenNames.add(normalizedName);
                        stopsToRender.push(s);
                    }
                }
            }

            return (
            <React.Fragment key={route.id}>
                <Polyline positions={route.path} color={standardColor} weight={6} opacity={0.6} />
                {stopsToRender.map((s: any, stopIndex: number) => {
                    const passage = getPassage(s, stopPassages);
                    let markerFill = "#ffffff";
                    if (passage) markerFill = passage.stopped ? "#10b981" : "#f59e0b";
                    
                    const isActive = isSameStop(s, activeStop);

                    return (
                        <CircleMarker 
                            key={route.id + '-' + s.id + '-' + stopIndex + '-' + markerFill + '-' + (isActive ? 'active' : 'inactive')}
                            center={[s.lat, s.lng]} 
                            radius={isActive ? 8 : (passage ? 8 : 5)}
                            fillColor={isActive && !passage ? "#3b82f6" : markerFill}
                            fillOpacity={1} 
                            color={isActive ? "#1d4ed8" : standardColor} 
                            weight={isActive ? 4 : 2} 
                            eventHandlers={{
                                click: (e: any) => {
                                    if (e.originalEvent) {
                                        L.DomEvent.stopPropagation(e.originalEvent);
                                    }
                                    setActiveStop(s);
                                }
                            }}
                        >
                            <Tooltip 
                                key={isActive ? ('perm-' + s.id + '-' + route.id) : ('temp-' + s.id + '-' + route.id)}
                                permanent={isActive}
                                direction="top" 
                                offset={[0, -10]} 
                                opacity={isActive ? 1 : 0.9} 
                                className="custom-tooltip"
                            >
                                <StopContent s={s} routeLine={route.line} passage={passage} />
                            </Tooltip>
                        </CircleMarker>
                    );
                })}
            </React.Fragment>
            );
        })}

        <ActiveStopMarker activeStop={activeStop} selectedRoutes={selectedRoutes} stopPassages={stopPassages} />
        
        {history.length > 1 && (
            <Polyline positions={history.map((p: any) => [p.lat, p.lng])} color="#ef4444" weight={3} dashArray="5, 10" opacity={0.8} />
        )}
        
        {vehicles.filter((v: any) => showAll || selectedRoutes.some((r: any) => r.id === v.line) || selectedVehicleId === v.id).map((v: any) => {
            return (
              <VehicleMarker 
                  key={v.id} 
                  vehicle={v} 
                  lineShortName={routeManifest.get(v.line)?.line || '?'} 
                  isSelected={selectedVehicleId === v.id} 
                  onSelect={setSelectedVehicleId} 
                  onDeselect={() => setSelectedVehicleId((prev: any) => prev === v.id ? null : prev)} 
              />
            );
        })}
      </MapContainer>
  );
}