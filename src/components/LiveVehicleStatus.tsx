import React, { useMemo } from 'react';
import { SLVehicle } from '../types';
import { Building2, Hash, Gauge, Activity, Bus, Train, Ship, TramFront, TrainFront as SubwayIcon, X, CheckCircle2, XCircle } from 'lucide-react';
import { SHIP_NAMES } from '../constants';
import { getLineColor, getTransportIcon } from '../utils/mapUtils';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LiveVehicleStatusProps {
  vehicle: SLVehicle;
  lineShortName: string;
  tripEvents: any[];
  onClose: () => void;
  selectedRoutes: any[];
}

const LiveVehicleStatus: React.FC<LiveVehicleStatusProps> = ({ vehicle, lineShortName, tripEvents, onClose, selectedRoutes }) => {
  if (!vehicle) return null;

  const match = vehicle.id ? /([0-9]{3})([0-9]{4})$/.exec(vehicle.id) : null;
  const companyCode = match ? match[1] : null;
  const vesselCode = match ? match[2] : vehicle.id.slice(-4);
  
  const getTransportType = (lineString: string) => {
    const lineName = lineString.replace('Linje ', '').trim();
    if (/[a-zA-Z]/.test(lineName)) return { type: 'Buss', icon: Bus };
    const num = parseInt(lineName);
    if (isNaN(num)) return { type: 'Buss', icon: Bus };
    if ([10, 11, 13, 14, 17, 18, 19].includes(num)) return { type: 'Tunnelbana', icon: SubwayIcon };
    if (num === 7) return { type: 'Spårväg City', icon: TramFront };
    if (num === 12) return { type: 'Nockebybanan', icon: TramFront };
    if (num === 21) return { type: 'Lidingöbanan', icon: TramFront };
    if ([30, 31].includes(num)) return { type: 'Tvärbanan', icon: TramFront };
    if ([25, 26].includes(num)) return { type: 'Saltsjöbanan', icon: Train };
    if ([27, 28, 29].includes(num)) return { type: 'Roslagsbanan', icon: Train };
    if ([40, 41, 42, 43, 44, 48].includes(num)) return { type: 'Pendeltåg', icon: Train };
    if ([80, 82, 83, 84, 89].includes(num)) return { type: 'Pendelbåt', icon: Ship };
    return { type: 'Buss', icon: Bus };
  };
  
  const transportInfo = getTransportType(lineShortName);
  const TransportIcon = transportInfo.icon;
  const lineColorHex = getLineColor(lineShortName, vehicle.agency);
  
  let company = "Okänd";
  switch (companyCode) {
    case "050": company = "Blidösundsbolaget"; break;
    case "070": case "151": case "152": case "700": case "701": case "702": case "705": case "706": case "707": case "709": company = "AB Stockholms Spårvägar"; break;
    case "100": company = "Keolis"; break;
    case "150": company = "VR Sverige"; break;
    case "250": case "251": case "252": company = "Connecting Stockholm"; break;
    case "300": company = "Nobina"; break;
    case "450": case "451": case "452": case "456": case "459": company = "Transdev"; break;
    case "650": company = "SJ Stockholmståg"; break;
    case "750": company = "Djurgårdens färjetrafik"; break;
    case "800": company = "Ballerina"; break;
    default: company = companyCode ? `Entreprenör ${companyCode}` : "Okänd";
  }

  const isBoat = vehicle.agency === 'WAAB' || transportInfo.type === 'Pendelbåt' || transportInfo.type === 'Färja';
  
  let vehicleDisplayName = vehicle.vehicleNumber || vesselCode;
  if (isBoat && SHIP_NAMES[vesselCode]) {
    vehicleDisplayName = SHIP_NAMES[vesselCode];
  }

  const roundedSpeed = Math.round(vehicle.speed);
  const hasDestination = vehicle.destination && vehicle.destination !== "Okänd";
  const isBus = transportInfo.type === 'Buss';

  const delayStatus = useMemo(() => {
    if (vehicle.delay === undefined) return { text: "Realtid", color: "text-slate-400", dot: "bg-slate-400" };
    const delayMin = Math.round(vehicle.delay / 60);
    if (Math.abs(delayMin) < 1) return { text: "I tid", color: "text-emerald-400", dot: "bg-emerald-400" };
    if (vehicle.delay > 0) return { text: `${delayMin} min sen`, color: "text-rose-400", dot: "bg-rose-400" };
    return { text: `${Math.abs(delayMin)} min tidig`, color: "text-sky-400", dot: "bg-sky-400" };
  }, [vehicle.delay]);

  const toSec = (t: string | number) => {
    if (typeof t === "number") return t;
    if (typeof t !== "string") return 0;
    const parts = t.split(":");
    return (Number(parts[0]) >= 24 ? Number(parts[0]) - 24 : Number(parts[0])) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0);
  };

  const getDiff = (sched?: string | number, act?: string | number) => {
    if (!sched || !act) return null;
    let diffSec = toSec(act) - toSec(sched);
    if (diffSec < -43200) diffSec += 86400;
    else if (diffSec > 43200) diffSec -= 86400;
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 1) return { text: "I tid", color: "text-emerald-400" };
    if (diffMin > 0) return { text: `+${diffMin}`, color: "text-rose-400" };
    return { text: `${diffMin}`, color: "text-sky-400" };
  };

  const formatActualTime = (t: any) => {
    if (!t) return "--:--";
    if (typeof t === "number") {
      let h = Math.floor(t / 3600);
      if (h >= 24) h -= 24;
      const m = Math.floor((t % 3600) / 60);
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    const parts = t.toString().split(":");
    let h = parseInt(parts[0], 10);
    if (h >= 24) h -= 24;
    return `${h.toString().padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}`;
  };

  return (
    <div className="bg-slate-900/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/10 pointer-events-auto flex flex-col w-full sm:w-[280px] max-h-[50vh] overflow-hidden">
      <div className="p-4 flex-shrink-0 relative">
        <button onClick={onClose} className="absolute top-4 right-4 p-1.5 bg-white/5 hover:bg-white/10 rounded-full text-slate-300 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3 pr-8">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 shadow-lg text-white" style={{ backgroundColor: lineColorHex }}>
                {lineShortName}
            </div>
            <div className="flex flex-col min-w-0">
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-0.5 flex items-center gap-1">
                    <TransportIcon className="w-3 h-3" />
                    {vehicle.agency === 'WAAB' ? 'Fartyg' : transportInfo.type}
                </div>
                <div className="text-sm font-bold text-white truncate leading-tight">
                    {hasDestination && `mot ${vehicle.destination}`}
                </div>
            </div>
        </div>
      </div>

      <div className="px-4 pb-4 flex-shrink-0">
        <div className={`grid gap-x-6 gap-y-4 ${isBus ? 'grid-cols-2' : 'grid-cols-1'} p-3 bg-white/5 rounded-xl border border-white/5`}>
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Entreprenör
                </div>
                <div className="text-xs font-bold text-slate-200 truncate" title={company}>{company}</div>
            </div>
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Hash className="w-3 h-3" /> {isBoat ? 'Fartyg' : 'Vagnsnr'}
                </div>
                <div className="text-xs font-bold text-slate-200 truncate">{vehicleDisplayName}</div>
            </div>
            {isBus && (
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Gauge className="w-3 h-3" /> Hastighet
                </div>
                <div className="text-xs font-bold text-slate-200">{roundedSpeed} km/h</div>
            </div>
            )}
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Punktlighet
                </div>
                <div className={`text-xs font-bold flex items-center gap-1.5 ${delayStatus.color}`}>
                    <div className={cn("w-1.5 h-1.5 rounded-full", delayStatus.dot)} />
                    {delayStatus.text}
                </div>
            </div>
        </div>
      </div>

      {tripEvents && tripEvents.length > 0 && (
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4 custom-scrollbar">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest border-b border-white/5 pb-2">
              Körda hållplatser
            </div>
            <div className="relative pl-4 space-y-4 before:absolute before:left-4 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-700">
                {[...tripEvents].reverse().map((te, i) => {
                    const stopDiff = getDiff(te.scheduledDeparture || te.sd, te.actualDeparture || te.ad);
                    const isTeStopped = (() => {
                        if (te.stopped !== undefined && te.stopped !== null) return Boolean(te.stopped);
                        if (te.st !== undefined && te.st !== null) return Boolean(te.st);
                        const arr = te.actualArrival || te.aa;
                        const dep = te.actualDeparture || te.ad;
                        if (!arr || !dep || typeof arr !== 'string' || typeof dep !== 'string') return false;
                        let duration = toSec(dep) - toSec(arr);
                        if (duration < -43200) duration += 86400;
                        return duration >= 25;
                    })();

                    let stopName = te.stopName;
                    if (!stopName) {
                        for (const route of selectedRoutes) {
                            const found = route.stops?.find((s: any) => String(s.id) === String(te.stopId || te.s));
                            if (found) {
                                stopName = found.name;
                                break;
                            }
                        }
                    }

                    const isLatest = i === 0;

                    return (
                        <div key={i} className="relative flex items-center gap-3">
                            <div className={cn("absolute -left-[21px] top-1.5 w-[11px] h-[11px] rounded-full border-2", isLatest ? "bg-blue-500 border-slate-900 ring-2 ring-blue-500/50" : "bg-slate-800 border-slate-500")} />
                            <div className="w-10 shrink-0 text-xs font-mono font-bold text-slate-400 mt-0.5">
                                {formatActualTime(te.actualDeparture || te.ad || te.actualArrival || te.aa)}
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                {isTeStopped ? (
                                    <span title="Stannade" className="shrink-0 flex items-center">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                    </span>
                                ) : (
                                    <span title="Passerade" className="shrink-0 flex items-center">
                                        <XCircle className="w-3.5 h-3.5 text-amber-500" />
                                    </span>
                                )}
                                <div className={cn("font-semibold text-xs truncate", isLatest ? "text-white font-bold" : "text-slate-300")}>
                                    {stopName || `Hållplats ${te.stopId || te.s}`}
                                </div>
                            </div>
                            {stopDiff && (
                                <div className={cn("text-xs font-mono font-bold shrink-0", stopDiff.color)}>
                                    {stopDiff.text}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
      )}
    </div>
  );
};

export default LiveVehicleStatus;
