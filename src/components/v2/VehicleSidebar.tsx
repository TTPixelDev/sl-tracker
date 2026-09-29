import React, { useMemo } from 'react';
import { SLVehicle, SLLineRoute } from '../../types';
import { Hash, Gauge, Bus, Train, Ship, TramFront, TrainFront as SubwayIcon, X, CheckCircle2, XCircle, LocateFixed, Locate, Clock } from 'lucide-react';
import { SHIP_NAMES } from '../../constants';
import { getLineColor } from '../../utils/mapUtils';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface VehicleSidebarProps {
    vehicle: SLVehicle;
    lineShortName: string;
    tripEvents: any[];
    onClose: () => void;
    selectedRoutes: SLLineRoute[];
    isFollowingVehicle?: boolean;
    onToggleFollow?: () => void;
}

export const VehicleSidebar: React.FC<VehicleSidebarProps> = ({
    vehicle,
    lineShortName,
    tripEvents,
    onClose,
    selectedRoutes,
    isFollowingVehicle = true,
    onToggleFollow
}) => {
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

    let company = 'Okänd';
    switch (companyCode) {
        case '050': company = 'Blidösundsbolaget'; break;
        case '070': case '151': case '152': case '700': case '701': case '702': case '705': case '706': case '707': case '709': company = 'AB Stockholms Spårvägar'; break;
        case '100': company = 'Keolis'; break;
        case '150': company = 'VR Sverige'; break;
        case '250': case '251': case '252': company = 'Connecting Stockholm'; break;
        case '300': company = 'Nobina'; break;
        case '450': case '451': case '452': case '456': case '459': company = 'Transdev'; break;
        case '650': company = 'SJ Stockholmståg'; break;
        case '750': company = 'Djurgårdens färjetrafik'; break;
        case '800': company = 'Ballerina'; break;
        default: company = companyCode ? `Entreprenör ${companyCode}` : 'Okänd';
    }

    const isBoat = vehicle.agency === 'WAAB' || transportInfo.type === 'Pendelbåt' || transportInfo.type === 'Färja';

    let vehicleDisplayName = vehicle.vehicleNumber || vesselCode;
    if (isBoat && SHIP_NAMES[vesselCode]) {
        vehicleDisplayName = SHIP_NAMES[vesselCode];
    }

    const roundedSpeed = Math.round(vehicle.speed);
    const hasDestination = vehicle.destination && vehicle.destination !== 'Okänd';

    const delayStatus = useMemo(() => {
        if (vehicle.delay === undefined) return { text: 'Realtid', color: 'text-slate-400' };
        const delayMin = Math.round(vehicle.delay / 60);
        if (Math.abs(delayMin) < 1) return { text: 'I tid', color: 'text-emerald-400 font-bold' };
        if (vehicle.delay > 0) return { text: `+${delayMin} min sen`, color: 'text-rose-400 font-bold' };
        return { text: `${Math.abs(delayMin)} min tidig`, color: 'text-sky-400 font-bold' };
    }, [vehicle.delay]);

    const toSec = (t: string | number) => {
        if (typeof t === 'number') return t;
        if (typeof t !== 'string') return 0;
        const parts = t.split(':');
        return (Number(parts[0]) >= 24 ? Number(parts[0]) - 24 : Number(parts[0])) * 3600 + (Number(parts[1]) || 0) * 60 + (Number(parts[2]) || 0);
    };

    const getDiff = (sched?: string | number, act?: string | number) => {
        if (!sched || !act) return null;
        let diffSec = toSec(act) - toSec(sched);
        if (diffSec < -43200) diffSec += 86400;
        else if (diffSec > 43200) diffSec -= 86400;
        const diffMin = Math.round(diffSec / 60);
        if (Math.abs(diffMin) < 1) return { text: 'I tid', color: 'text-emerald-400 font-bold' };
        if (diffMin > 0) return { text: `+${diffMin}`, color: 'text-rose-400 font-bold' };
        return { text: `${diffMin}`, color: 'text-sky-400 font-bold' };
    };

    const formatActualTime = (t: any) => {
        if (!t) return '--:--';
        if (typeof t === 'number') {
            let h = Math.floor(t / 3600);
            if (h >= 24) h -= 24;
            const m = Math.floor((t % 3600) / 60);
            return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
        }
        const parts = t.toString().split(':');
        let h = parseInt(parts[0], 10);
        if (h >= 24) h -= 24;
        return `${h.toString().padStart(2, '0')}:${(parts[1] || '00').padStart(2, '0')}`;
    };

    return (
        <div className="fixed left-3 sm:left-4 bottom-4 z-[1600] w-80 sm:w-88 max-h-[calc(100vh-140px)] rounded-2xl border border-slate-800 bg-slate-900/95 text-white backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-3">
            {/* Header section */}
            <div className="p-4 relative shrink-0 border-b border-white/5">
                <div className="absolute top-3.5 right-3.5 flex items-center gap-1.5">
                    {onToggleFollow && (
                        <button
                            onClick={onToggleFollow}
                            className={`p-1.5 rounded-xl border transition-all ${isFollowingVehicle
                                    ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white border-slate-700'
                                }`}
                            title={isFollowingVehicle ? 'Följer fordon på kartan' : 'Klicka för att följa fordon på kartan'}
                        >
                            {isFollowingVehicle ? <LocateFixed className="w-4 h-4" /> : <Locate className="w-4 h-4" />}
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-xl border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
                        title="Stäng fordonsvy"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex items-center gap-3 pr-20">
                    <div
                        className="w-11 h-11 rounded-xl flex items-center justify-center font-extrabold text-base shrink-0 shadow-md text-white"
                        style={{ backgroundColor: lineColorHex }}
                    >
                        {lineShortName}
                    </div>
                    <div className="flex flex-col min-w-0">
                        <div className="text-[10px] font-bold uppercase tracking-wider mb-0.5 flex items-center gap-1 truncate text-slate-400">
                            <TransportIcon className="w-3 h-3 shrink-0" />
                            <span className="truncate">{vehicle.agency === 'WAAB' ? 'Fartyg' : transportInfo.type} · {company}</span>
                        </div>
                        <div className="text-sm font-bold truncate leading-tight text-white">
                            {hasDestination ? `mot ${vehicle.destination}` : `Linje ${lineShortName}`}
                        </div>
                    </div>
                </div>
            </div>

            {/* Metrics Row (Vehicle ID, Speed, Delay) */}
            <div className="p-3 shrink-0">
                <div className="grid grid-cols-3 gap-2 p-2.5 rounded-xl border bg-slate-800/60 border-slate-700/60">
                    <div className="space-y-0.5">
                        <div className="text-[9.5px] font-bold uppercase flex items-center gap-1 text-slate-400">
                            <Hash className="w-3 h-3" /> {isBoat ? 'Fartyg' : 'Vagn'}
                        </div>
                        <div className="text-xs font-bold truncate text-white">{vehicleDisplayName}</div>
                    </div>

                    <div className="space-y-0.5">
                        <div className="text-[9.5px] font-bold uppercase flex items-center gap-1 text-slate-400">
                            <Gauge className="w-3 h-3" /> Fart
                        </div>
                        <div className="text-xs font-bold tabular-nums text-white">{roundedSpeed} km/h</div>
                    </div>

                    <div className="space-y-0.5">
                        <div className="text-[9.5px] font-bold uppercase flex items-center gap-1 text-slate-400">
                            <Clock className="w-3 h-3" /> Status
                        </div>
                        <div className={`text-xs font-bold truncate ${delayStatus.color}`}>{delayStatus.text}</div>
                    </div>
                </div>
            </div>

            {/* Driven Stops List */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3 custom-scrollbar">
                <div className="text-[10px] font-bold uppercase tracking-widest border-b pb-1.5 flex items-center justify-between text-slate-400 border-white/5">
                    <span>Körda hållplatser</span>
                    {tripEvents && tripEvents.length > 0 && (
                        <span className="font-mono text-[9px] tabular-nums font-semibold">{tripEvents.length} registrerade</span>
                    )}
                </div>

                {tripEvents && tripEvents.length > 0 ? (
                    <div className="relative pl-4 space-y-3.5 before:absolute before:left-[4px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-700/80">
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
                            let isStopReglering = Boolean(te.isReglering);
                            if (!stopName || !isStopReglering) {
                                for (const route of selectedRoutes) {
                                    const found = route.stops?.find((s: any) => String(s.id) === String(te.stopId || te.s));
                                    if (found) {
                                        if (!stopName) stopName = found.name;
                                        if (found.isReglering) isStopReglering = true;
                                        break;
                                    }
                                }
                            }

                            if (!isStopReglering && te.scheduledArrival && te.scheduledDeparture && te.scheduledArrival !== te.scheduledDeparture) {
                                isStopReglering = true;
                            }

                            const isLatest = i === 0;

                            return (
                                <div key={i} className="relative flex items-center gap-2.5">
                                    {/* Circle indicator strictly aligned with the line */}
                                    <div
                                        className={cn(
                                            'absolute -left-[18px] top-1/2 -translate-y-1/2 rounded-full border-2 transition-all shrink-0',
                                            isLatest
                                                ? 'w-[12px] h-[12px] bg-blue-500 border-white ring-2 ring-blue-500/50'
                                                : isStopReglering
                                                    ? 'w-[11px] h-[11px] bg-blue-500 border-blue-300 ring-1 ring-blue-400/40'
                                                    : 'w-[9px] h-[9px] bg-slate-800 border-slate-500'
                                        )}
                                    />

                                    {/* Time */}
                                    <div
                                        className={cn(
                                            'w-10 shrink-0 text-xs font-mono tabular-nums leading-none',
                                            isStopReglering ? 'font-bold text-slate-100' : 'font-normal text-slate-400'
                                        )}
                                    >
                                        {formatActualTime(te.actualDeparture || te.ad || te.actualArrival || te.aa)}
                                    </div>

                                    {/* Stopped icon & Stop Name */}
                                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                        {isTeStopped ? (
                                            <span title="Stannade" className="shrink-0 flex items-center">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                                            </span>
                                        ) : (
                                            <span title="Passerade utan stopp" className="shrink-0 flex items-center">
                                                <XCircle className="w-3.5 h-3.5 text-amber-500" />
                                            </span>
                                        )}

                                        <div
                                            className={cn(
                                                'text-xs truncate leading-none',
                                                isStopReglering ? 'font-bold text-white' : 'font-normal text-slate-300'
                                            )}
                                            title={stopName || `Hållplats ${te.stopId || te.s}`}
                                        >
                                            {stopName || `Hållplats ${te.stopId || te.s}`}
                                        </div>
                                    </div>

                                    {/* Delay diff */}
                                    {stopDiff && (
                                        <div className={cn('text-[11px] font-mono tabular-nums shrink-0 leading-none', stopDiff.color)}>
                                            {stopDiff.text}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="p-4 text-center text-xs rounded-xl text-slate-500 bg-slate-800/30">
                        Inga körda hållplatser registrerade för aktuell tur än
                    </div>
                )}
            </div>
        </div>
    );
};
export default VehicleSidebar;
