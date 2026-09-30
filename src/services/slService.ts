import { SLStop, SLLineRoute, SearchResult, SLVehicle, HistoryPoint } from '../types';
import protobuf from 'protobufjs';

const DB_NAME = 'SL_Tracker_DB_v6';
const DB_VERSION = 1;
const STATIC_TS_KEY = 'sl_static_timestamp_v6';
const CACHE_DURATION = 1000 * 60 * 60 * 24 * 7;

const RT_VEHICLE_URL = '/api/gtfs-rt';
const RT_TRIP_UPDATES_URL = '/api/trip-updates';

export interface LineManifestEntry {
  id: string;
  line: string;
  description?: string;
  from: string;
  to: string;
  agency: 'SL' | 'WAAB';
}

class SLService {
  private db: IDBDatabase | null = null;
  private isInitialized = false;
  private rtRoot: any = null;
  private tripToRouteMap: Record<string, { r: string; h?: string }> | null = null;
  private routeDirections: any | null = null;
  private contractorsMap: Map<string, string> = new Map();
  private stopsMap: Map<string, string> = new Map();
  private manifest: LineManifestEntry[] = [];

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db.objectStoreNames.contains('stops')) db.deleteObjectStore('stops');
        if (db.objectStoreNames.contains('routes')) db.deleteObjectStore('routes');
        db.createObjectStore('stops', { keyPath: 'id' }).createIndex('name', 'name');
        db.createObjectStore('routes', { keyPath: 'id' }).createIndex('line', 'line');
      };
      request.onsuccess = () => { this.db = request.result; resolve(this.db); };
      request.onerror = () => reject(request.error);
    });
  }

  async initialize() {
    if (this.isInitialized) return;
    await this.getDB();
    const lastUpdate = localStorage.getItem(STATIC_TS_KEY);
    if (!lastUpdate || (Date.now() - parseInt(lastUpdate)) > CACHE_DURATION) {
      await this.loadStaticDataFromFiles();
    } else {
      await this.loadStopsFromDB();
      this.manifest = await this.getManifestFromDB();
    }
    await this.loadHelperMaps();
    this.isInitialized = true;
  }

  async getManifest(): Promise<LineManifestEntry[]> {
    await this.initialize();
    return this.manifest;
  }

  private async loadHelperMaps() {
    try {
      const [tripRes, dirRes, contrRes] = await Promise.all([
        fetch(`/data/trip-to-route.json?v=${Date.now()}`),
        fetch(`/data/route-directions.json?v=${Date.now()}`),
        fetch(`/api/contractors`)
      ]);

      if (tripRes.ok) this.tripToRouteMap = await tripRes.json();
      if (dirRes.ok) this.routeDirections = await dirRes.json();
      if (contrRes.ok) {
        const data = await contrRes.json();
        Object.values(data).forEach((modeArray: any) => {
          if (Array.isArray(modeArray)) {
            modeArray.forEach((line: any) => {
              if (line.designation && line.contractor?.name) {
                this.contractorsMap.set(line.designation, line.contractor.name);
              }
            });
          }
        });
      }
    } catch (e) { console.warn("Kunde inte ladda hjälpkartor:", e); }
  }

  private async loadStopsFromDB() {
    const db = await this.getDB();
    const tx = db.transaction('stops', 'readonly');
    const req = tx.objectStore('stops').getAll();
    req.onsuccess = () => { if (req.result) req.result.forEach((s: SLStop) => this.stopsMap.set(s.id, s.name)); };
  }

  private async getManifestFromDB(): Promise<LineManifestEntry[]> {
    const db = await this.getDB();
    return new Promise(resolve => {
      const req = db.transaction('routes', 'readonly').objectStore('routes').getAll();
      req.onsuccess = () => resolve(req.result);
    });
  }

  private async loadStaticDataFromFiles() {
    try {
      const [manifestRes, stopsRes] = await Promise.all([fetch('/data/manifest.json'), fetch('/data/stops.json')]);
      if (manifestRes.ok && stopsRes.ok) {
        this.manifest = await manifestRes.json();
        const stops: SLStop[] = await stopsRes.json();
        stops.forEach(s => this.stopsMap.set(s.id, s.name));

        try {
          const db = await this.getDB();
          const tx = db.transaction(['stops', 'routes'], 'readwrite');
          stops.forEach(s => tx.objectStore('stops').put(s));
          this.manifest.forEach((r: LineManifestEntry) => tx.objectStore('routes').put(r));
          localStorage.setItem(STATIC_TS_KEY, Date.now().toString());
        } catch (dbErr) {
          console.warn("Kunde inte spara till IndexedDB, kan bero på iframe-begränsningar:", dbErr);
        }
      } else {
        console.warn("Servern returnerade inte 200 OK för data:", manifestRes.status, stopsRes.status);
      }
    } catch (e) { console.error("Kunde inte ladda data över nätverket:", e); }
  }

  async search(query: string, currentAgency?: 'SL' | 'WAAB', searchType?: 'line' | 'stop'): Promise<SearchResult[]> {
    await this.initialize();
    const trimmed = query.trim();
    if (trimmed.length < 1) return [];

    const isLine = searchType === 'line' || (searchType !== 'stop' && (
      /^\d{1,3}[a-zA-Z]?$/i.test(trimmed) ||
      /^(linje|line|l)\s*([0-9a-zA-Z]+)?$/i.test(trimmed)
    ));
    const targetType = searchType || (isLine ? 'line' : 'stop');

    // First ask the server API with explicit type
    try {
      const agencyParam = currentAgency ? `&agency=${currentAgency}` : '';
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&type=${targetType}${agencyParam}`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data) && data.length > 0) return data;
      }
    } catch (e) { }

    // Fallback to local DB
    const q = trimmed.toLowerCase();
    const db = await this.getDB();

    return new Promise(resolve => {
      const results: SearchResult[] = [];
      const tx = db.transaction(['routes', 'stops'], 'readonly');

      if (targetType === 'line') {
        const cleanLine = q.replace(/^(linje|line|l)\s*/i, '').trim();
        tx.objectStore('routes').openCursor().onsuccess = (e) => {
          const cursor = (e.target as any).result;
          if (cursor) {
            const r = cursor.value as LineManifestEntry;
            if (results.length < 30 && (!currentAgency || r.agency === currentAgency)) {
              const lineStr = (r.line || '').toLowerCase();
              if (lineStr.startsWith(cleanLine) || (cleanLine.length > 1 && lineStr.includes(cleanLine))) {
                results.push({ type: 'line', id: r.id, title: `Linje ${r.line}`, subtitle: `${r.from} - ${r.to}`, agency: r.agency });
              }
            }
            cursor.continue();
          } else {
            // Sort numerically
            results.sort((a, b) => {
              const numA = parseInt(a.title.replace(/\D/g, ''));
              const numB = parseInt(b.title.replace(/\D/g, ''));
              if (!isNaN(numA) && !isNaN(numB) && numA !== numB) return numA - numB;
              return a.title.localeCompare(b.title);
            });
            resolve(results);
          }
        };
      } else {
        // STOP SEARCH ONLY
        const seenNames = new Set<string>();
        tx.objectStore('stops').openCursor().onsuccess = (e) => {
          const cursor = (e.target as any).result;
          if (cursor && results.length < 30) {
            const s = cursor.value as SLStop;
            const stopAgency = s.agency || 'SL';
            const normName = (s.name || '').trim().toLowerCase();
            if (normName.includes(q) && (!currentAgency || stopAgency === currentAgency)) {
              if (!seenNames.has(normName)) {
                seenNames.add(normName);
                results.push({
                  type: 'stop',
                  id: s.id,
                  title: s.name,
                  subtitle: stopAgency === 'WAAB' ? 'Brygga' : 'Hållplats',
                  agency: stopAgency,
                  lat: s.lat,
                  lng: s.lng
                });
              }
            }
            cursor.continue();
          } else {
            results.sort((a, b) => a.title.localeCompare(b.title));
            resolve(results);
          }
        };
      }
    });
  }

  async getLineContractor(designation: string): Promise<string> {
    await this.initialize();
    return this.contractorsMap.get(designation) || "Okänd";
  }

  getLineContractorSync(designation: string): string | undefined {
    return this.contractorsMap.get(designation);
  }

  async getLineStops(lineId: string): Promise<SLStop[]> {
    // Force use of static line route definitions for stop filtering
    // because dynamic GTFS trips often include depot runs and strange variants
    // which pollutes the history stop dropdown
    const r = await this.getLineRoute(lineId);
    return r ? r.stops : [];
  }

  async getLineRoute(routeId: string): Promise<SLLineRoute | null> {
    let routeData: SLLineRoute | null = null;
    try {
      const res = await fetch(`/data/lines/${routeId}.json`);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.stops) && data.stops.length > 0) {
          routeData = data;
        }
      }
    } catch (e) { }

    if (!routeData) {
      try {
        const res = await fetch(`/api/line-route?routeId=${routeId}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.stops) && data.stops.length > 0) {
            routeData = data;
          }
        }
      } catch (e) { }
    }

    if (routeData && Array.isArray(routeData.stops)) {
      const hasInterpolated = routeData.stops.some((s: any) => {
        const a = s.scheduledArrival || s.arr;
        const d = s.scheduledDeparture || s.dep;
        return (a && !a.endsWith(':00')) || (d && !d.endsWith(':00'));
      });

      routeData.stops.forEach((s: any, idx: number) => {
        if (s.isReglering === undefined) {
          const isTerminal = idx === 0 || idx === routeData!.stops.length - 1;
          const a = s.scheduledArrival || s.arr;
          const d = s.scheduledDeparture || s.dep;
          const isDwell = a && d && a !== d;
          const isTimepoint = hasInterpolated && ((a && a.endsWith(':00')) || (d && d.endsWith(':00')));
          s.isReglering = isTerminal || isDwell || isTimepoint;
        }
      });
    }

    return routeData;
  }

  async getStopInfo(stopId: string): Promise<SLStop | null> {
    try {
      const db = await this.getDB();
      const local: SLStop = await new Promise(resolve => {
        const req = db.transaction('stops', 'readonly').objectStore('stops').get(stopId);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null as any);
      });
      if (local) return local;
    } catch (e) { }

    try {
      const res = await fetch(`/api/stop?id=${encodeURIComponent(stopId)}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (e) { }

    return null;
  }

  async getLiveVehicles(currentAgency?: 'SL' | 'WAAB'): Promise<SLVehicle[]> {
    await this.initialize();
    try {
      const [posRes, updatesRes] = await Promise.all([
        fetch(RT_VEHICLE_URL),
        fetch(RT_TRIP_UPDATES_URL)
      ]);
      if (!posRes.ok || !updatesRes.ok) return [];

      const [posBuffer, updatesBuffer] = await Promise.all([
        posRes.arrayBuffer(),
        updatesRes.arrayBuffer()
      ]);

      const root = await this.getRTRoot();
      const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

      const posMessage = FeedMessage.decode(new Uint8Array(posBuffer));
      const posObject = FeedMessage.toObject(posMessage, { enums: String, longs: String });

      const updatesMessage = FeedMessage.decode(new Uint8Array(updatesBuffer));
      const updatesObject = FeedMessage.toObject(updatesMessage, { enums: String, longs: String });

      const tripInfoMap: Map<string, { delay?: number, directionId?: number, routeId?: string, lastStopId?: string }> = new Map();

      (updatesObject.entity || []).forEach((e: any) => {
        if (e.tripUpdate && e.tripUpdate.trip) {
          const tId = e.tripUpdate.trip.tripId || e.tripUpdate.trip.trip_id;
          const stu = e.tripUpdate.stopTimeUpdate;
          if (stu && stu.length > 0) {
            const first = stu[0];
            const delay = first.arrival?.delay !== undefined ? first.arrival.delay :
              first.departure?.delay !== undefined ? first.departure.delay : undefined;

            const last = stu[stu.length - 1];
            const lastStopId = last?.stopId || last?.stop_id;
            const directionId = e.tripUpdate.trip.directionId ?? e.tripUpdate.trip.direction_id;
            const routeId = e.tripUpdate.trip.routeId ?? e.tripUpdate.trip.route_id;

            if (tId) tripInfoMap.set(tId, { delay, directionId, routeId, lastStopId });
          }
        }
      });

      const vehicles: SLVehicle[] = [];
      for (const entity of (posObject.entity || [])) {
        const v = entity.vehicle;
        if (!v || !v.trip || !v.position) continue;
        const tripId = v.trip.tripId || v.trip.trip_id;
        const mapInfo = this.tripToRouteMap?.[tripId];

        const info = tripInfoMap.get(tripId);

        let routeId = mapInfo?.r;
        if (!routeId && info?.routeId) routeId = info.routeId;
        let directionId = v.trip.directionId ?? v.trip.direction_id;

        if (info) {
          if (directionId === undefined || directionId === null) directionId = info.directionId;
          if (!routeId && info.routeId) routeId = info.routeId;
        }

        if (!routeId) continue;
        const routeManifest = this.manifest.find(m => m.id === routeId);
        if (!routeManifest) continue;

        if (currentAgency && routeManifest.agency !== currentAgency) continue;

        let headsign = "Okänd";

        if (mapInfo?.h) headsign = mapInfo.h;
        if ((!headsign || headsign === "Okänd") && directionId !== undefined && directionId !== null && this.routeDirections) {
          const fallbackHeadsign = this.routeDirections[routeId]?.[String(directionId)];
          if (fallbackHeadsign) headsign = fallbackHeadsign;
        }
        if (!headsign || headsign === "Okänd") {
          if (info?.lastStopId) {
            const stopName = this.stopsMap.get(info.lastStopId);
            if (stopName) headsign = stopName;
          }
        }
        if (!headsign || headsign === "Okänd") {
          if (routeManifest.to && routeManifest.to !== routeManifest.from) {
            headsign = routeManifest.to;
          }
        }

        vehicles.push({
          id: v.vehicle?.id || entity.id,
          line: routeId,
          tripId: tripId,
          operator: routeManifest.agency === 'WAAB' ? "Blidösundsbolaget" : "SL",
          vehicleNumber: v.vehicle?.label || v.vehicle?.id?.slice(-4) || "N/A",
          lat: v.position.latitude,
          lng: v.position.longitude,
          bearing: v.position.bearing || 0,
          speed: (v.position.speed || 0) * 3.6,
          destination: headsign,
          type: routeManifest.agency === 'WAAB' ? 'Färja' : 'Buss',
          agency: routeManifest.agency,
          delay: info?.delay,
          directionId: directionId !== undefined && directionId !== null ? Number(directionId) : undefined
        });
      }
      return vehicles;
    } catch (e) {
      console.error("Fel vid hämtning av realtidsdata:", e);
      return [];
    }
  }

  async findVehicle(vNum: string): Promise<{ vehicle: SLVehicle, routeId: string } | null> {
    const all = await this.getLiveVehicles();
    const found = all.find(v => v.vehicleNumber === vNum || v.id.endsWith(vNum));
    return found ? { vehicle: found, routeId: found.line } : null;
  }

  async getVehicleHistory(tripId: string): Promise<HistoryPoint[]> {
    const res = await fetch(`/api/trip-history?tripId=${tripId}&t=${Date.now()}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.path || [];
  }

  async getTripEvents(tripId: string, date?: string): Promise<any[]> {
    const url = date ? `/api/trip-events?tripId=${tripId}&date=${date}&t=${Date.now()}` : `/api/trip-events?tripId=${tripId}&t=${Date.now()}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  }

  async getLastUpdated(): Promise<Date | null> {
    try {
      const res = await fetch('/data/meta.json');
      if (res.ok) {
        const data = await res.json();
        if (data.lastUpdated) {
          return new Date(data.lastUpdated);
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  private async getRTRoot() {
    if (this.rtRoot) return this.rtRoot;
    this.rtRoot = await protobuf.parse(`
      syntax = "proto2";
      package transit_realtime;
      message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
      message FeedHeader { required string gtfs_realtime_version = 1; optional uint64 timestamp = 3; }
      message FeedEntity { required string id = 1; optional VehiclePosition vehicle = 4; optional TripUpdate trip_update = 3; }
      message VehiclePosition { optional TripDescriptor trip = 1; optional VehicleDescriptor vehicle = 8; optional Position position = 2; }
      message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; }
      message StopTimeUpdate { optional uint32 stop_sequence = 1; optional string stop_id = 4; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; }
      message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; }
      message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
      message VehicleDescriptor { optional string id = 1; optional string label = 2; }
      message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
    `).root;
    return this.rtRoot;
  }
}
export const slService = new SLService();
