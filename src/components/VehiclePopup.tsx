import React from 'react';
import { SLVehicle } from '../types';
import { Building2, Hash, Gauge, Activity, Bus, Train, Ship, TramFront, TrainFront as SubwayIcon } from 'lucide-react';
import { SHIP_NAMES } from '../constants';
import { getLineColor, getTransportIcon } from './LiveMap';

interface VehiclePopupProps {
  vehicle: SLVehicle;
  lineShortName: string;
}

const VehiclePopup: React.FC<VehiclePopupProps> = ({ vehicle, lineShortName }) => {
  const match = /([0-9]{3})([0-9]{4})$/.exec(vehicle.id);
  const companyCode = match ? match[1] : null;
  const vesselCode = match ? match[2] : vehicle.id.slice(-4);
  
  const getTransportType = (lineString: string) => {
    const lineName = lineString.replace('Linje ', '').trim();
    if (/[a-zA-Z]/.test(lineName)) return { type: 'Buss', icon: Bus };
    const num = parseInt(lineName);
    if (isNaN(num)) return { type: 'Buss', icon: Bus };

    // Tunnelbana
    if ([10, 11, 13, 14, 17, 18, 19].includes(num)) return { type: 'Tunnelbana', icon: SubwayIcon };

    // Specifika banor med egna namn
    if (num === 7) return { type: 'Spårväg City', icon: TramFront };
    if (num === 12) return { type: 'Nockebybanan', icon: TramFront };
    if (num === 21) return { type: 'Lidingöbanan', icon: TramFront };
    if ([30, 31].includes(num)) return { type: 'Tvärbanan', icon: TramFront };
    if ([25, 26].includes(num)) return { type: 'Saltsjöbanan', icon: Train };
    if ([27, 28, 29].includes(num)) return { type: 'Roslagsbanan', icon: Train };

    // Övriga generella kategorier
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

  const getDelayInfo = () => {
    if (vehicle.delay === undefined) return { text: "Realtid", color: "text-slate-500" };
    const delayMin = Math.round(vehicle.delay / 60);
    if (Math.abs(delayMin) < 1) return { text: "I tid", color: "text-emerald-600" };
    if (vehicle.delay > 0) return { text: `${delayMin} min sen`, color: "text-rose-600" };
    return { text: `${Math.abs(delayMin)} min tidig`, color: "text-sky-600" };
  };

  const delayStatus = getDelayInfo();

  return (
    <div className="bg-white min-w-[280px] font-sans overflow-hidden">
      <div className="bg-slate-900 p-4 text-white">
        <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 shadow-lg" style={{ backgroundColor: lineColorHex }}>
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

      <div className="p-4 space-y-4">
        <div className={`grid gap-x-6 gap-y-4 ${isBus ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Building2 className="w-3 h-3" /> Entreprenör
                </div>
                <div className="text-xs font-bold text-slate-700 truncate" title={company}>{company}</div>
            </div>
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Hash className="w-3 h-3" /> {isBoat ? 'Fartyg' : 'Vagnsnr'}
                </div>
                <div className="text-xs font-bold text-slate-700 truncate">{vehicleDisplayName}</div>
            </div>
            {isBus && (
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Gauge className="w-3 h-3" /> Hastighet
                </div>
                <div className="text-xs font-bold text-slate-700">{roundedSpeed} km/h</div>
            </div>
            )}
            <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-bold uppercase flex items-center gap-1">
                    <Activity className="w-3 h-3" /> Punktlighet
                </div>
                <div className={`text-xs font-bold flex items-center gap-1 ${delayStatus.color}`}>
                    {delayStatus.text}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default VehiclePopup;
