import React from 'react';
import { X, Trash2 } from 'lucide-react';
import { SLLineRoute, SLVehicle } from '../../types';
import { getLineColor, getTransportIcon } from '../../utils/mapUtils';
import { slService } from '../../services/slService';

interface LineChipsBarProps {
    selectedRoutes: SLLineRoute[];
    onRemoveRoute: (routeId: string) => void;
    onClearAll: () => void;
    vehicles: SLVehicle[];
}

export const LineChipsBar: React.FC<LineChipsBarProps> = ({
    selectedRoutes,
    onRemoveRoute,
    onClearAll,
    vehicles
}) => {
    if (selectedRoutes.length === 0) return null;

    return (
        <div className="fixed top-14 left-0 right-0 z-[2200] px-3 sm:px-4 py-2 pointer-events-none flex flex-wrap gap-2 items-center">
            {selectedRoutes.map((route) => {
                const lineColorHex = getLineColor(route.line, route.agency);
                const TransportIcon = getTransportIcon(route.line, route.agency);

                const firstStop = route.stops && route.stops.length > 0 ? route.stops[0].name : '';
                const lastStop = route.stops && route.stops.length > 0 ? route.stops[route.stops.length - 1].name : '';

                const routeVehicles = vehicles.filter((v: any) => v.line === route.line);
                const contractor = slService.getLineContractorSync(route.line);
                let operator = 'OKÄND';

                if (route.agency === 'WAAB') operator = 'WAXHOLMSBOLAGET';
                else if (contractor) operator = contractor.toUpperCase();
                else operator = routeVehicles.length > 0 ? routeVehicles[0].operator.toUpperCase() : 'NOBINA';

                return (
                    <div
                        key={route.id}
                        className="pointer-events-auto flex items-center h-10 rounded-xl shadow-lg border transition-all animate-in fade-in slide-in-from-top-1 bg-slate-800/95 border-slate-700/80 text-white"
                    >
                        {/* Line number and operator */}
                        <div className="flex items-center gap-2 pl-3 pr-2.5">
                            <TransportIcon className="w-4 h-4 shrink-0" style={{ color: lineColorHex }} />
                            <div className="flex flex-col">
                                <span className="text-xs font-bold whitespace-nowrap leading-tight">
                                    Linje {route.line}
                                </span>
                                <span className="text-[8.5px] font-bold tracking-wider leading-none uppercase text-slate-400">
                                    {operator}
                                </span>
                            </div>
                        </div>

                        {/* Endpoints */}
                        <div className="flex flex-col min-w-0 pl-2.5 py-1 pr-1 border-l border-slate-700/80 text-slate-300 h-full justify-center gap-0.5">
                            <span className="text-[9.5px] leading-none truncate max-w-[85px] sm:max-w-[110px]">
                                {(firstStop || '').replace(/\s*\(.*\)/, '')}
                            </span>
                            <span className="text-[9.5px] leading-none truncate max-w-[85px] sm:max-w-[110px]">
                                {(lastStop || '').replace(/\s*\(.*\)/, '')}
                            </span>
                        </div>

                        {/* Close button */}
                        <button
                            onClick={() => onRemoveRoute(route.id)}
                            className="px-2.5 hover:bg-red-500/10 hover:text-red-500 h-full rounded-r-xl transition-colors flex items-center justify-center text-slate-400"
                            title={`Ta bort linje ${route.line}`}
                            aria-label={`Ta bort linje ${route.line}`}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                );
            })}

            {selectedRoutes.length > 0 && (
                <button
                    onClick={onClearAll}
                    className="pointer-events-auto flex items-center gap-1.5 px-3 h-10 rounded-xl shadow-lg border text-xs font-semibold transition-all active:scale-95 bg-slate-800/90 hover:bg-slate-700/90 text-slate-300 hover:text-white border-slate-700/80"
                    title="Rensa alla valda linjer"
                >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    <span>Rensa alla</span>
                </button>
            )}
        </div>
    );
};
export default LineChipsBar;
