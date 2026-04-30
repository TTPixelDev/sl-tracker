import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, CircleMarker, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { slService } from '../services/slService';
import { SLVehicle, SLLineRoute, SearchResult, SLStop, HistoryPoint } from '../types';
import { Ship, TrainFront, TramFront, Train, Bus, Clock } from 'lucide-react';
import VehiclePopup from './VehiclePopup';

// Fix Leaflet icons
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

export const getLineColor = (lineString: string, agency?: string) => {
    if (agency === 'WAAB') return '#0891b2'; 
    const lineName = lineString.replace('Linje ', '').trim();
    const num = parseInt(lineName);
    const blueBusLines = [1, 2, 3, 4, 5, 6, 172, 173, 176, 177, 178, 179, 471, 474, 670, 676, 677, 873, 875];
    
    if (!isNaN(num)) {
        if (blueBusLines.includes(num)) return '#2563eb'; 
        if ([10, 11].includes(num)) return '#1d4ed8'; 
        if ([13, 14].includes(num)) return '#dc2626'; 
        if ([17, 18, 19].includes(num)) return '#16a34a'; 
        if ([40, 41, 42, 43, 44, 48].includes(num)) return '#ec4899'; 
        if (num === 7) return '#4b5563'; 
        if (num === 12) return '#475569'; 
        if (num === 21) return '#b45309'; 
        if ([30, 31].includes(num)) return '#ea580c'; 
        if ([25, 26].includes(num)) return '#0d9488'; 
        if ([27, 28, 29].includes(num)) return '#9333ea'; 
        if ([80, 82, 83, 84, 89].includes(num)) return '#0891b2'; 
        const isRedBus = ![10, 11, 13, 14, 17, 18, 19, 7, 12, 30, 31, 21, 25, 26, 27, 28, 29, 40, 41, 42, 43, 44, 48, 80, 82, 83, 84, 89].includes(num);
        if (isRedBus) return '#dc2626'; 
    }
    return '#2563eb'; 
};

export const getTransportIcon = (lineString: string, agency?: string) => {
    if (agency === 'WAAB') return Ship;
    const lineName = lineString.replace('Linje ', '').trim();
    const num = parseInt(lineName);
    
    if (isNaN(num)) return Bus;
    if ([10, 11, 13, 14, 17, 18, 19].includes(num)) return TrainFront;
    if ([7, 12, 21, 30, 31].includes(num)) return TramFront;
    if ([25, 26, 27, 28, 29, 40, 41, 42, 43, 44, 48].includes(num)) return Train;
    if ([80, 82, 83, 84, 89].includes(num)) return Ship;
    return Bus;
};

const VehicleMarker: React.FC<any> = ({ vehicle, lineShortName, isSelected, onSelect, onDeselect }) => {
  const markerRef = useRef<L.Marker>(null);
  
  const icon = useMemo(() => {
    const color = getLineColor(lineShortName, vehicle.agency);
    const isNoBearing = ['7', '12', '21', '25', '26', '27', '28', '29', '30', '31'].includes(lineShortName);
    
    let markerHtml = '';
    if (isNoBearing) {
      markerHtml = '<div style="width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; position: relative;">' +
        '<div style="width: 20px; height: 20px; background: ' + color + '; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(0,0,0,0.5);"></div>' +
        '<div style="position: absolute; top: -14px; left: 50%; transform: translateX(-50%); background: ' + color + '; color: white; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.2);">' +
        lineShortName +
        '</div>' +
        '</div>';
    } else {
      markerHtml = '<div style="transform: rotate(' + vehicle.bearing + 'deg); width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; position: relative;">' +
        '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width: 100%; height: 100%; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">' +
        '<path d="M12 2L4 21L12 17L20 21L12 2Z" fill="' + color + '" stroke="white" stroke-width="2" stroke-linejoin="round"/>' +
        '</svg>' +
        '<div style="position: absolute; top: -15px; left: 50%; transform: translateX(-50%) rotate(' + (-vehicle.bearing) + 'deg); background: ' + color + '; color: white; padding: 1px 5px; border-radius: 3px; font-size: 9px; font-weight: 800; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">' +
        lineShortName +
        '</div>' +
        '</div>';
    }

    return L.divIcon({
        className: 'custom-vehicle-icon',
        html: markerHtml,
        iconSize: isNoBearing ? [40, 40] : [34, 34],
        iconAnchor: isNoBearing ? [20, 20] : [17, 17]
      });
  }, [vehicle.bearing, lineShortName, vehicle.agency]); 

  useEffect(() => {
    if (markerRef.current) {
        if (isSelected) {
            if (!markerRef.current.isPopupOpen()) markerRef.current.openPopup();
        } else {
            if (markerRef.current.isPopupOpen()) markerRef.current.closePopup();
        }
    }
  }, [isSelected, vehicle.lat, vehicle.lng]);

  return (
    <Marker 
      ref={markerRef} 
      position={[vehicle.lat, vehicle.lng]} 
      icon={icon} 
      eventHandlers={{ 
        click: () => onSelect(vehicle.id), 
        popupclose: () => { if (isSelected) onDeselect(); }
      }}
    >
      <Popup className="custom-popup" autoPan={false} closeButton={true}>
        <VehiclePopup vehicle={vehicle} lineShortName={lineShortName} />
      </Popup>
    </Marker>
  );
};

const MapController = ({ center, zoom, bounds }: { center: [number, number]; zoom: number; bounds?: L.LatLngBoundsExpression }) => {
  const map = useMap();
  useEffect(() => { if (bounds) map.fitBounds(bounds, { padding: [50, 50] }); else map.setView(center, zoom); }, [center, zoom, bounds, map]);
  return null;
};

export default function LiveMap({ vehicles, showAll, selectedRoutes, selectedVehicleId, setSelectedVehicleId, routeManifest, mapConfig, activeStop, setActiveStop, stopPassages, history }: any) {
  return (
      <MapContainer center={mapConfig.center} zoom={mapConfig.zoom} zoomControl={false} className="flex-1 w-full h-full z-0">
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController center={mapConfig.center} zoom={mapConfig.zoom} bounds={mapConfig.bounds} />
        
        {selectedRoutes.map((route: any) => {
            const standardColor = route.agency === 'WAAB' ? "#0891b2" : "#3b82f6";
            return (
            <React.Fragment key={route.id}>
                <Polyline positions={route.path} color={standardColor} weight={6} opacity={0.6} />
                {route.stops.map((s: any, stopIndex: number) => {
                    const passage = stopPassages.get(s.id);
                    let markerFill = "#ffffff";
                    if (passage) markerFill = passage.stopped ? "#10b981" : "#f59e0b";
                    
                    return (
                        <CircleMarker 
                            key={route.id + '-' + s.id + '-' + stopIndex + '-' + markerFill}
                            center={[s.lat, s.lng]} 
                            radius={passage ? 8 : 5}
                            fillColor={markerFill}
                            fillOpacity={1} 
                            color={standardColor} 
                            weight={2} 
                            eventHandlers={{ click: () => setActiveStop(s) }}
                        >
                            <Tooltip direction="top" offset={[0, -10]} opacity={0.9} className="custom-tooltip">
                                <div className="p-1 font-sans">
                                    <div className="text-xs font-bold text-slate-900">{s.name}</div>
                                    <div className="text-[10px] text-slate-500 font-semibold">Linje {route.line}</div>
                                    {passage && (
                                        <div className="mt-1 flex flex-col gap-0.5">
                                            {passage.stopped ? (
                                                <>
                                                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-600">
                                                        <Clock className="w-3 h-3" />
                                                        Ankom: {passage.time} ({passage.duration})
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
                            </Tooltip>
                        </CircleMarker>
                    );
                })}
            </React.Fragment>
            );
        })}

        {activeStop && <Marker position={[activeStop.lat, activeStop.lng]}><Popup>{activeStop.name}</Popup></Marker>}
        
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
                  onDeselect={() => setSelectedVehicleId(null)} 
              />
            );
        })}
      </MapContainer>
  );
}

// bust cache
