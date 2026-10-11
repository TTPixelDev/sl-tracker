import "dotenv/config";
import path from "path";
import fs from "fs";
import { MongoClient } from "mongodb";
import protobuf from "protobufjs";

const DB_NAME = "sl-times";
const DATA_DIR = path.resolve(process.cwd(), "public/data");
const LINES_DIR = path.join(DATA_DIR, "lines");

// 4 hours retention: documents are deleted after 4 hours to keep storage minimal and prevent costs
const RETENTION_MS = 4 * 60 * 60 * 1000;

interface TrailPoint {
    lat: number;
    lng: number;
    ts: number;
    speed?: number;
    delay?: number;
}

interface IngestTrail {
    tripId: string;
    vehicleId: string;
    line: string;
    lastUpdate: string;
    expireAt: Date;
    trail: TrailPoint[];
}

interface IngestStopEvent {
    t: string; // tripId
    l: string; // line
    s: string; // stopId
    stopName: string;
    d: string; // date string YYYY-MM-DD
    ts: number;
    st: boolean; // stopped
    aa: number | null; // actual arrival secs of day
    ad: number | null; // actual departure secs of day
    sa: number | null; // scheduled arrival mins of day
    sd: number | null; // scheduled departure mins of day
    reg: boolean; // isReglering
    expireAt: Date;
}

// In-memory cache for instant low-latency serving
export const inMemoryTrails = new Map<string, IngestTrail>();
export const inMemoryStopEvents = new Map<string, Map<string, IngestStopEvent>>(); // tripId -> (stopId -> event)

let isIngesting = false;
let mongoClient: MongoClient | null = null;
let lastIngestStatus = {
    online: false,
    tracking: 0,
    lastUpdate: new Date().toISOString(),
    text: "Initierar realtidsspårning..."
};

// Fast distance calculation in meters
function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const a =
        Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function timeStringToSeconds(t?: string): number | null {
    if (!t) return null;
    const parts = t.split(":");
    if (parts.length < 2) return null;
    let h = parseInt(parts[0], 10);
    if (h >= 24) h -= 24;
    const m = parseInt(parts[1], 10) || 0;
    const s = parseInt(parts[2], 10) || 0;
    return h * 3600 + m * 60 + s;
}

function timeStringToMinutes(t?: string): number | null {
    const secs = timeStringToSeconds(t);
    return secs !== null ? Math.round(secs / 60) : null;
}

function formatSecondsToTime(secs: number | null): string | null {
    if (secs === null || isNaN(Number(secs))) return null;
    let h = Math.floor(Number(secs) / 3600) % 24;
    const m = Math.floor((Number(secs) % 3600) / 60);
    const s = Number(secs) % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export async function startIngest() {
    if (isIngesting) return;
    isIngesting = true;

    console.log("--- Startar Realtidsingest för bussar och båtar (trails & stopp med 4h TTL) ---");

    // Load trip-to-route mapping
    let tripToRouteMap: Record<string, { r: string; h?: string }> = {};
    try {
        const ttrPath = path.join(DATA_DIR, "trip-to-route.json");
        if (fs.existsSync(ttrPath)) {
            tripToRouteMap = JSON.parse(fs.readFileSync(ttrPath, "utf-8"));
            console.log(`Laddade ${Object.keys(tripToRouteMap).length} resor i trip-to-route map.`);
        }
    } catch (err) {
        console.warn("Kunde inte läsa trip-to-route.json:", err);
    }

    // Cache line routes in memory
    const lineRoutesCache = new Map<string, any>();
    function getLineRoute(lineId: string): any {
        if (lineRoutesCache.has(lineId)) return lineRoutesCache.get(lineId);
        try {
            const p = path.join(LINES_DIR, `${lineId}.json`);
            if (fs.existsSync(p)) {
                const data = JSON.parse(fs.readFileSync(p, "utf-8"));
                lineRoutesCache.set(lineId, data);
                return data;
            }
        } catch { }
        return null;
    }

    // Connect to MongoDB with auto-reconnection
    const mongoUri = process.env.MONGODB_URI;
    let db: any = null;
    let isConnecting = false;

    async function getDb(): Promise<any> {
        if (db) return db;
        if (!mongoUri || isConnecting) return null;
        isConnecting = true;
        try {
            if (mongoClient) {
                try {
                    await mongoClient.close().catch(() => { });
                } catch { }
            }
            mongoClient = new MongoClient(mongoUri, {
                maxPoolSize: 10,
                connectTimeoutMS: 10000,
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000
            });
            await mongoClient.connect();
            db = mongoClient.db(DB_NAME);
            console.log("Ansluten till MongoDB för spårning av dagens turer.");

            // Ensure TTL index on expireAt so old documents are deleted after 4 hours
            await Promise.all([
                db.collection("vehicle_trails").createIndex({ tripId: 1 }, { unique: true }).catch(() => { }),
                db.collection("vehicle_trails").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { }),
                db.collection("stop_events").createIndex({ t: 1, s: 1 }, { unique: true }).catch(() => { }),
                db.collection("stop_events").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(() => { })
            ]);

            // Prune any legacy documents that expired
            await Promise.all([
                db.collection("vehicle_trails").deleteMany({ expireAt: { $lt: new Date() } }).catch(() => { }),
                db.collection("stop_events").deleteMany({ expireAt: { $lt: new Date() } }).catch(() => { })
            ]);
            return db;
        } catch (err: any) {
            console.warn("MongoDB anslutningsvarning (använder in-memory som fallback):", err?.message || err);
            db = null;
            mongoClient = null;
            return null;
        } finally {
            isConnecting = false;
        }
    }

    function handleMongoError(err: any) {
        if (!err) return;
        const msg = String(err?.message || err || "").toLowerCase();
        if (
            msg.includes("closed") ||
            msg.includes("topology") ||
            msg.includes("pool") ||
            msg.includes("timeout") ||
            msg.includes("connection") ||
            msg.includes("econnreset")
        ) {
            console.warn("Databasanslutning bruten i ingest daemon, schemalägger återanslutning:", msg);
            db = null;
            mongoClient = null;
        }
    }

    // Initial connect attempt
    await getDb();

    // Load Protobuf definitions
    const protoRoot = await protobuf.parse(`
    syntax = "proto2";
    package transit_realtime;

    message TripDescriptor {
      optional string trip_id = 1;
      optional string route_id = 5;
      optional uint32 direction_id = 6;
    }

    message VehicleDescriptor {
      optional string id = 1;
      optional string label = 2;
    }

    message Position {
      required float latitude = 1;
      required float longitude = 2;
      optional float bearing = 3;
      optional float speed = 5;
    }

    message VehiclePosition {
      optional TripDescriptor trip = 1;
      optional VehicleDescriptor vehicle = 8;
      optional Position position = 2;
    }

    message StopTimeEvent {
      optional int32 delay = 1;
      optional int64 time = 2;
    }

    message StopTimeUpdate {
      optional uint32 stop_sequence = 1;
      optional string stop_id = 4;
      optional StopTimeEvent arrival = 2;
      optional StopTimeEvent departure = 3;
    }

    message TripUpdate {
      optional TripDescriptor trip = 1;
      repeated StopTimeUpdate stop_time_update = 2;
    }

    message FeedEntity {
      required string id = 1;
      optional VehiclePosition vehicle = 4;
      optional TripUpdate trip_update = 3;
    }

    message FeedHeader {
      required string gtfs_realtime_version = 1;
      optional uint64 timestamp = 3;
    }

    message FeedMessage {
      required FeedHeader header = 1;
      repeated FeedEntity entity = 2;
    }
  `).root;
    const FeedMessage = protoRoot.lookupType("transit_realtime.FeedMessage");

    // Track vehicles dwelling at stops
    const dwellingVehicles = new Map<string, { stopId: string; enterTime: number; firstSpeed: number }>();

    // Ingest loop
    async function pollRealtime() {
        try {
            const apiKey = process.env.RT_API_KEY;
            if (!apiKey) {
                lastIngestStatus = {
                    online: false,
                    tracking: 0,
                    lastUpdate: new Date().toISOString(),
                    text: "Saknar RT_API_KEY"
                };
                return;
            }

            const [posRes, updateRes] = await Promise.all([
                fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb?key=${apiKey}`, {
                    signal: AbortSignal.timeout(10000)
                }),
                fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/TripUpdatesSweden.pb?key=${apiKey}`, {
                    signal: AbortSignal.timeout(10000)
                })
            ]);

            if (!posRes.ok) {
                console.warn("Kunde inte hämta fordonsdata:", posRes.status);
                return;
            }

            const [posBuf, updateBuf] = await Promise.all([
                posRes.arrayBuffer(),
                updateRes.ok ? updateRes.arrayBuffer() : Promise.resolve(null)
            ]);

            const posMsg = FeedMessage.decode(new Uint8Array(posBuf));
            const posObj = FeedMessage.toObject(posMsg, { enums: String, longs: String });

            const tripUpdatesMap = new Map<string, { delay?: number; stopUpdates?: any[] }>();
            if (updateBuf) {
                const updateMsg = FeedMessage.decode(new Uint8Array(updateBuf));
                const updateObj = FeedMessage.toObject(updateMsg, { enums: String, longs: String });
                for (const e of updateObj.entity || []) {
                    if (e.tripUpdate?.trip) {
                        const tId = e.tripUpdate.trip.tripId || e.tripUpdate.trip.trip_id;
                        const stu = e.tripUpdate.stopTimeUpdate;
                        const delay = stu?.[0]?.arrival?.delay ?? stu?.[0]?.departure?.delay;
                        if (tId) {
                            tripUpdatesMap.set(tId, { delay, stopUpdates: stu });
                        }
                    }
                }
            }

            const now = Date.now();
            const nowDate = new Date(now);
            const expireDate = new Date(now + RETENTION_MS);
            const todayDateStr = new Intl.DateTimeFormat("sv-SE", {
                timeZone: "Europe/Stockholm",
                year: "numeric",
                month: "2-digit",
                day: "2-digit"
            }).format(nowDate);

            // Seconds of day
            const stockholmTime = new Intl.DateTimeFormat("sv-SE", {
                timeZone: "Europe/Stockholm",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false
            }).format(nowDate);
            const [curH, curM, curS] = stockholmTime.split(":").map(Number);
            const currentSecsOfDay = curH * 3600 + curM * 60 + curS;

            const entities = posObj.entity || [];
            let trackedCount = 0;

            const bulkTrailOps: any[] = [];
            const bulkStopOps: any[] = [];

            for (const entity of entities) {
                const v = entity.vehicle;
                if (!v || !v.trip || !v.position) continue;
                const tripId = v.trip.tripId || v.trip.trip_id;
                if (!tripId) continue;

                const lat = v.position.latitude;
                const lng = v.position.longitude;
                if (typeof lat !== "number" || typeof lng !== "number") continue;

                const vehicleId = v.vehicle?.id || v.vehicle?.label || entity.id;
                const mapInfo = tripToRouteMap[tripId];
                const routeId = mapInfo?.r || v.trip.routeId || v.trip.route_id || "";
                const speed = (v.position.speed || 0) * 3.6;
                const tripInfo = tripUpdatesMap.get(tripId);
                const delay = tripInfo?.delay;

                trackedCount++;

                // 1. UPDATE TRAIL
                let cachedTrail = inMemoryTrails.get(tripId);
                if (!cachedTrail) {
                    cachedTrail = {
                        tripId,
                        vehicleId,
                        line: routeId,
                        lastUpdate: nowDate.toISOString(),
                        expireAt: expireDate,
                        trail: []
                    };
                    inMemoryTrails.set(tripId, cachedTrail);
                }

                const points = cachedTrail.trail;
                const lastPoint = points[points.length - 1];

                let shouldAddPoint = false;
                if (!lastPoint) {
                    shouldAddPoint = true;
                } else {
                    const dist = getDistanceMeters(lastPoint.lat, lastPoint.lng, lat, lng);
                    const timeDiff = now - lastPoint.ts;
                    // Add point if moved >= 12 meters OR if 12+ seconds elapsed and moved >= 3m
                    if (dist >= 12 || (timeDiff >= 12000 && dist >= 3)) {
                        shouldAddPoint = true;
                    }
                }

                if (shouldAddPoint) {
                    const newPt: TrailPoint = {
                        lat,
                        lng,
                        ts: now,
                        speed: Math.round(speed * 10) / 10,
                        delay
                    };
                    points.push(newPt);
                    // Keep up to 350 points per trail
                    if (points.length > 350) points.shift();

                    cachedTrail.lastUpdate = nowDate.toISOString();
                    cachedTrail.expireAt = expireDate;

                    bulkTrailOps.push({
                        updateOne: {
                            filter: { tripId },
                            update: {
                                $set: {
                                    vehicleId,
                                    line: routeId,
                                    lastUpdate: cachedTrail.lastUpdate,
                                    expireAt: expireDate
                                },
                                $push: {
                                    trail: {
                                        $each: [newPt],
                                        $slice: -350
                                    }
                                }
                            },
                            upsert: true
                        }
                    });
                }

                // 2. DETECT STOP PASSAGES & STOPS (where all buses have stopped and passed)
                if (routeId) {
                    const lineData = getLineRoute(routeId);
                    if (lineData && Array.isArray(lineData.stops)) {
                        let tripStopsMap = inMemoryStopEvents.get(tripId);
                        if (!tripStopsMap) {
                            tripStopsMap = new Map();
                            inMemoryStopEvents.set(tripId, tripStopsMap);
                        }

                        const threshold = lineData.agency === "WAAB" ? 120 : 65;

                        for (const stop of lineData.stops) {
                            const stopIdStr = String(stop.id);
                            const dist = getDistanceMeters(lat, lng, stop.lat, stop.lng);

                            if (dist <= threshold) {
                                const dwellKey = `${tripId}_${stopIdStr}`;
                                const existingDwell = dwellingVehicles.get(dwellKey);
                                const isSlow = speed < 3.0; // km/h

                                if (!existingDwell) {
                                    dwellingVehicles.set(dwellKey, {
                                        stopId: stopIdStr,
                                        enterTime: now,
                                        firstSpeed: speed
                                    });
                                }

                                // Check or create event
                                let existingEv = tripStopsMap.get(stopIdStr);
                                const schedArr = timeStringToMinutes(stop.scheduledArrival);
                                const schedDep = timeStringToMinutes(stop.scheduledDeparture);

                                if (!existingEv) {
                                    const stopped = isSlow || (existingDwell ? now - existingDwell.enterTime >= 15000 : false);
                                    existingEv = {
                                        t: tripId,
                                        l: routeId,
                                        s: stopIdStr,
                                        stopName: stop.name,
                                        d: todayDateStr,
                                        ts: now,
                                        st: stopped,
                                        aa: currentSecsOfDay,
                                        ad: currentSecsOfDay,
                                        sa: schedArr,
                                        sd: schedDep,
                                        reg: Boolean(stop.isReglering),
                                        expireAt: expireDate
                                    };
                                    tripStopsMap.set(stopIdStr, existingEv);

                                    bulkStopOps.push({
                                        updateOne: {
                                            filter: { t: tripId, s: stopIdStr },
                                            update: { $set: existingEv },
                                            upsert: true
                                        }
                                    });
                                } else {
                                    // Update departure time and stopped flag
                                    let changed = false;
                                    if (isSlow && !existingEv.st) {
                                        existingEv.st = true;
                                        changed = true;
                                    }
                                    existingEv.ad = currentSecsOfDay;
                                    existingEv.ts = now;
                                    existingEv.expireAt = expireDate;

                                    if (changed || Math.abs(currentSecsOfDay - (existingEv.ad || 0)) >= 5) {
                                        bulkStopOps.push({
                                            updateOne: {
                                                filter: { t: tripId, s: stopIdStr },
                                                update: {
                                                    $set: {
                                                        st: existingEv.st,
                                                        ad: existingEv.ad,
                                                        ts: now,
                                                        expireAt: expireDate
                                                    }
                                                }
                                            }
                                        });
                                    }
                                }
                            } else {
                                // If previously dwelling and now moved away, clean up dwell map
                                const dwellKey = `${tripId}_${stopIdStr}`;
                                if (dwellingVehicles.has(dwellKey)) {
                                    dwellingVehicles.delete(dwellKey);
                                }
                            }
                        }
                    }
                }
            }

            // Write batch to MongoDB
            const currentDb = await getDb();
            if (currentDb) {
                if (bulkTrailOps.length > 0) {
                    currentDb.collection("vehicle_trails").bulkWrite(bulkTrailOps, { ordered: false }).catch((e: any) => {
                        handleMongoError(e);
                    });
                }
                if (bulkStopOps.length > 0) {
                    currentDb.collection("stop_events").bulkWrite(bulkStopOps, { ordered: false }).catch((e: any) => {
                        handleMongoError(e);
                    });
                }

                // Update status doc in database
                currentDb.collection("status").updateOne(
                    { _id: "ingest_status" },
                    {
                        $set: {
                            online: true,
                            tracking: trackedCount,
                            lastUpdate: nowDate.toISOString(),
                            text: `Aktiv: ${trackedCount} fordon i spårning (${stockholmTime})`
                        }
                    },
                    { upsert: true }
                ).catch((e: any) => handleMongoError(e));
            }

            lastIngestStatus = {
                online: true,
                tracking: trackedCount,
                lastUpdate: nowDate.toISOString(),
                text: `Aktiv: ${trackedCount} fordon i spårning (${stockholmTime})`
            };
        } catch (err) {
            console.error("Fel i realtidsingest-loop:", err);
        }
    }

    // Periodic in-memory prune to clean up trips older than 4 hours
    setInterval(() => {
        const cutoff = Date.now();
        for (const [tripId, tr] of inMemoryTrails.entries()) {
            if (tr.expireAt.getTime() <= cutoff) {
                inMemoryTrails.delete(tripId);
            }
        }
        for (const [tripId, evs] of inMemoryStopEvents.entries()) {
            let allExpired = true;
            for (const [, ev] of evs.entries()) {
                if (ev.expireAt.getTime() > cutoff) {
                    allExpired = false;
                    break;
                }
            }
            if (allExpired) inMemoryStopEvents.delete(tripId);
        }
    }, 10 * 60 * 1000);

    // Non-overlapping recurring poll cycle
    let isPolling = false;
    async function runCycle() {
        if (isPolling) return;
        isPolling = true;
        try {
            await pollRealtime();
        } catch (err: any) {
            console.error("Fel i realtidsingest-cykel:", err?.message || err);
        } finally {
            isPolling = false;
        }
    }

    await runCycle();
    setInterval(runCycle, 3500);
}

// Helpers for API endpoints
export async function getTripTrail(tripId: string): Promise<TrailPoint[]> {
    // 1. Try in-memory
    const mem = inMemoryTrails.get(tripId);
    if (mem && mem.trail.length > 0) {
        return mem.trail;
    }

    // 2. Try MongoDB
    if (mongoClient) {
        try {
            const doc = await mongoClient.db(DB_NAME).collection("vehicle_trails").findOne({ tripId });
            if (doc && Array.isArray(doc.trail)) {
                return doc.trail;
            }
        } catch { }
    }

    return [];
}

export async function getTripStopEvents(tripId: string): Promise<any[]> {
    // 1. Try in-memory
    const memStops = inMemoryStopEvents.get(tripId);
    if (memStops && memStops.size > 0) {
        return Array.from(memStops.values()).map(e => ({
            stopId: e.s,
            stopName: e.stopName,
            stopped: e.st,
            isReglering: e.reg,
            actualArrival: formatSecondsToTime(e.aa),
            actualDeparture: formatSecondsToTime(e.ad),
            scheduledArrival: formatSecondsToTime(e.sa !== null ? e.sa * 60 : null),
            scheduledDeparture: formatSecondsToTime(e.sd !== null ? e.sd * 60 : null)
        }));
    }

    // 2. Try MongoDB
    if (mongoClient) {
        try {
            const docs = await mongoClient.db(DB_NAME).collection("stop_events").find({ t: tripId }).sort({ ts: 1 }).toArray();
            if (docs && docs.length > 0) {
                return docs.map((e: any) => ({
                    stopId: e.s,
                    stopName: e.stopName || e.dn || "",
                    stopped: Boolean(e.st),
                    isReglering: Boolean(e.reg),
                    actualArrival: formatSecondsToTime(e.aa),
                    actualDeparture: formatSecondsToTime(e.ad),
                    scheduledArrival: formatSecondsToTime(e.sa !== null ? (e.sa > 3600 ? e.sa : e.sa * 60) : null),
                    scheduledDeparture: formatSecondsToTime(e.sd !== null ? (e.sd > 3600 ? e.sd : e.sd * 60) : null)
                }));
            }
        } catch { }
    }

    return [];
}

export function getIngestStatus() {
    return lastIngestStatus;
}

// Global process-level safety so Ubuntu systemd service NEVER terminates on unhandled errors
process.on("unhandledRejection", (reason) => {
    console.error("Ohanterat löfte i ingest daemon (tjänsten fortsätter köra):", reason);
});
process.on("uncaughtException", (err) => {
    console.error("Ohanterat undantag i ingest daemon (tjänsten fortsätter köra):", err);
});

// Allow direct CLI execution: tsx scripts/ingest-rt.ts
if (process.argv[1] && (process.argv[1].includes("ingest-rt") || process.argv[1].includes("ingest"))) {
    startIngest().catch((err) => {
        console.error("Kunde inte starta ingest:", err);
    });
}
