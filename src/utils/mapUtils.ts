import { Ship, TrainFront, TramFront, Train, Bus } from 'lucide-react';

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
