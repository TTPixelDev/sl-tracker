import React from 'react';
import { MapPin, History, Ship, Bus } from 'lucide-react';
import { SmartSearchBar } from './SmartSearchBar';
import { SettingsDropdown } from './SettingsDropdown';
import { SLLineRoute, SLStop, SLVehicle } from '../../types';

interface NavbarV2Props {
    agency: 'SL' | 'WAAB';
    onAgencyChange: (a: 'SL' | 'WAAB') => void;
    view: 'live' | 'history';
    onViewChange: (v: 'live' | 'history') => void;
    showAll: boolean;
    onToggleShowAll: (val: boolean) => void;
    mapStyle: 'standard' | 'minimal';
    onToggleMapStyle: (style: 'standard' | 'minimal') => void;
    isFollowingVehicle: boolean;
    onToggleFollow: () => void;
    onSelectRoute: (routeId: string) => Promise<void>;
    onSelectStop: (stop: SLStop) => void;
    onSelectVehicle: (vehicle: SLVehicle, routeId: string) => void;
    selectedRoutes: SLLineRoute[];
    vehicles: SLVehicle[];
    lastUpdated: Date | null;
}

export const NavbarV2: React.FC<NavbarV2Props> = ({
    agency,
    onAgencyChange,
    view,
    onViewChange,
    showAll,
    onToggleShowAll,
    mapStyle,
    onToggleMapStyle,
    isFollowingVehicle,
    onToggleFollow,
    onSelectRoute,
    onSelectStop,
    onSelectVehicle,
    selectedRoutes,
    vehicles,
    lastUpdated
}) => {
    return (
        <header className="fixed top-0 left-0 right-0 h-14 z-[2500] px-3 sm:px-4 flex items-center justify-between gap-2 sm:gap-4 bg-slate-900/90 border-b border-slate-800/90 text-white backdrop-blur-xl">
            {/* Left zone: Brand & Unified Search */}
            <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <a
                    href="/v2"
                    className="flex items-center gap-2 shrink-0 group focus:outline-none"
                    title="SL-Tracker"
                >
                    <div className="w-8 h-8 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-600/30 group-hover:scale-105 transition-transform">
                        <Bus className="w-4 h-4" />
                    </div>
                    <div className="hidden md:flex flex-col">
                        <span className="font-extrabold text-sm tracking-tight leading-none text-white">SL-Tracker</span>
                        <span className="text-[10px] font-bold text-blue-500 leading-none mt-0.5">v2</span>
                    </div>
                </a>

                {/* Smart Search Bar */}
                <div className="flex-1 max-w-sm sm:max-w-md">
                    <SmartSearchBar
                        onSelectRoute={onSelectRoute}
                        onSelectStop={onSelectStop}
                        onSelectVehicle={onSelectVehicle}
                        currentAgency={agency}
                        selectedRoutes={selectedRoutes}
                        vehicles={vehicles}
                    />
                </div>
            </div>

            {/* Right zone: Agency, View Mode, Settings */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                {/* SL / WÅAB Agency Switcher */}
                <div className="p-1 rounded-xl flex border bg-slate-800/70 border-slate-700/60">
                    <button
                        onClick={() => onAgencyChange('SL')}
                        className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all ${agency === 'SL'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        SL
                    </button>
                    <button
                        onClick={() => onAgencyChange('WAAB')}
                        className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${agency === 'WAAB'
                            ? 'bg-cyan-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <Ship className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">WÅAB</span>
                    </button>
                </div>

                {/* Live / Historik Switcher */}
                <div className="p-1 rounded-xl flex border bg-slate-800/70 border-slate-700/60">
                    <button
                        onClick={() => onViewChange('live')}
                        className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${view === 'live'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Live</span>
                    </button>
                    <button
                        onClick={() => onViewChange('history')}
                        className={`px-2.5 sm:px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${view === 'history'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-400 hover:text-white'
                            }`}
                    >
                        <History className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Historik</span>
                    </button>
                </div>

                {/* Settings Dropdown (Visa all trafik, Detaljerad karta, Följ, mm) */}
                <SettingsDropdown
                    showAll={showAll}
                    onToggleShowAll={onToggleShowAll}
                    mapStyle={mapStyle}
                    onToggleMapStyle={onToggleMapStyle}
                    isFollowingVehicle={isFollowingVehicle}
                    onToggleFollow={onToggleFollow}
                    lastUpdated={lastUpdated}
                />
            </div>
        </header>
    );
};
export default NavbarV2;
