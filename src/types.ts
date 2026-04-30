export interface StopEvent {
  id: string;
  tripId: string;
  line: string;
  agency?: string;
  stopId: string;
  stopName: string;
  destinationName?: string;
  scheduledArrival: string;
  scheduledDeparture: string;
  actualArrival: string | null;
  actualDeparture: string | null;
  stopped: boolean;
  date: string;
  timestamp: number;
  scheduledDepartureMinutes: number;
}

export interface SLStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  lines?: string[];
  agency?: 'SL' | 'WAAB';
}

export interface SLVehicle {
  id: string;
  line: string; 
  tripId: string;
  operator: string;
  vehicleNumber: string;
  lat: number;
  lng: number;
  bearing: number;
  speed: number;
  destination: string;
  type: 'Buss' | 'Tåg' | 'Tunnelbana' | 'Spårvagn' | 'Färja';
  delay?: number; 
  agency?: 'SL' | 'WAAB';
}

export interface SLLineRoute {
  id: string; 
  line: string; 
  path: [number, number][];
  stops: SLStop[];
  agency?: 'SL' | 'WAAB';
}

export interface SearchResult {
  type: 'line' | 'stop';
  id: string;
  title: string;
  subtitle?: string;
  agency?: 'SL' | 'WAAB';
}

export interface HistoryPoint {
  lat: number;
  lng: number;
  ts: number;
  delay?: number;
}
