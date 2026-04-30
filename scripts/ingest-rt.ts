import { MongoClient, AnyBulkWriteOperation } from 'mongodb';
import protobuf from 'protobufjs';
import { getDistance } from 'geolib';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

// --- Konfiguration ---
const API_ENDPOINT = 'https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb';
const INTERVAL_MS = 2000;
const STOP_RADIUS = 30;
const STOPPED_SPEED_THRESHOLD = 5;

// Sökvägar för loggfiler
const STATUS_FILE_PATH = process.env.STATUS_FILE_PATH || '/var/www/html/status.txt';
const STATUS_JSON_PATH = process.env.STATUS_JSON_PATH || '/var/www/html/status.json';

const PROTO_DEF = `
syntax = "proto2";
package transit_realtime;
message FeedMessage { required FeedHeader header = 1; repeated FeedEntity entity = 2; }
message FeedHeader { required string gtfs_realtime_version = 1; optional Incrementality incrementality = 2 [default = FULL_DATASET]; optional uint64 timestamp = 3; enum Incrementality { FULL_DATASET = 0; DIFFERENTIAL = 1; } }
message FeedEntity { required string id = 1; optional bool is_deleted = 2 [default = false]; optional TripUpdate trip_update = 3; optional VehiclePosition vehicle = 4; optional Alert alert = 5; }
message VehiclePosition { optional TripDescriptor trip = 1; optional VehicleDescriptor vehicle = 8; optional Position position = 2; optional uint64 timestamp = 5; }
message TripUpdate { optional TripDescriptor trip = 1; repeated StopTimeUpdate stop_time_update = 2; }
message StopTimeUpdate { optional uint32 stop_sequence = 1; optional string stop_id = 4; optional StopTimeEvent arrival = 2; optional StopTimeEvent departure = 3; }
message StopTimeEvent { optional int32 delay = 1; optional int64 time = 2; optional int32 uncertainty = 3; }
message TripDescriptor { optional string trip_id = 1; optional string route_id = 5; optional uint32 direction_id = 6; }
message VehicleDescriptor { optional string id = 1; optional string label = 2; optional string license_plate = 3; }
message Position { required float latitude = 1; required float longitude = 2; optional float bearing = 3; optional float speed = 5; }
message Alert {}
`;

const root = protobuf.parse(PROTO_DEF).root;
const FeedMessage = root.lookupType("transit_realtime.FeedMessage");

const activeTracking = new Map<string, any>();
let lastHeartbeat = Date.now();
let savedEventsToday = 0;

async function runIngest() {
    const uri = process.env.MONGODB_URI;
    const apiKey = process.env.RT_API_KEY;

    if (!uri || !apiKey) {
        console.error("❌ MONGODB_URI eller RT_API_KEY saknas i .env filen!");
        process.exit(1);
    }

    console.log("🚀 Startar optimerad SL Ingest Combo Service...");
    const client = new MongoClient(uri);

    try {
        await client.connect();
        console.log("✅ Ansluten till databasen.");

        const db = client.db("sl-times");
        const trailsCollection = db.collection("vehicle_trails");
        const stopEventsCollection = db.collection("stop_events");
        const tripsCollection = db.collection("trips");
        const stopsCollection = db.collection("stops");
        const statusCollection = db.collection("status");

        await stopEventsCollection.createIndex({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });
        await stopEventsCollection.createIndex({ d: 1, l: 1, s: 1, sdm: 1 });
        await trailsCollection.createIndex({ tripId: 1 }, { unique: true });
        await trailsCollection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 });

        console.log("📦 Hämtar hållplatsdata...");
        const allStops = await stopsCollection.find({}).toArray();
        const stopLookup = new Map<string, any>();
        allStops.forEach(s => stopLookup.set(s.id, s));
        console.log(`📍 ${stopLookup.size} hållplatser inlästa.`);

        setInterval(() => {
            const now = Date.now();
            let cleaned = 0;
            for (const [tripId, data] of activeTracking.entries()) {
                if (now - data.lastSeen > 20 * 60 * 1000) {
                    activeTracking.delete(tripId);
                    cleaned++;
                }
            }
            if (cleaned > 0) console.log(`🧹 Rensade ${cleaned} inaktiva resor från RAM.`);
        }, 15 * 60 * 1000);

        while (true) {
            const startTime = Date.now();
            let statusMessage = "Hämtar data...";
            let cleanText = "Hämtar data...";
            let aktivBool = 0;
            let trackerCount = 0;

            try {
                const response = await fetch(`${API_ENDPOINT}?key=${apiKey}`);
                if (!response.ok) throw new Error(`API Error: ${response.status}`);

                const arrayBuffer = await response.arrayBuffer();
                const message = FeedMessage.decode(new Uint8Array(arrayBuffer));
                const object: any = FeedMessage.toObject(message, { enums: String, longs: String, defaults: true });
                const entities = object.entity || [];

                const timeStr = new Date().toLocaleTimeString('sv-SE', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
                const now = Date.now();

                if (entities.length === 0) {
                    statusMessage = `Inga fordon hittades (${timeStr})`;
                    cleanText = statusMessage;
                } else {
                    const tripDelays: Record<string, number> = {};
                    entities.forEach((e: any) => {
                        if (e.tripUpdate?.trip?.tripId) {
                            const updates = e.tripUpdate.stopTimeUpdate;
                            if (updates?.length > 0) {
                                const first = updates[0];
                                let delay = first.arrival?.delay ?? first.departure?.delay;
                                if (delay !== undefined) tripDelays[e.tripUpdate.trip.tripId] = parseInt(delay);
                            }
                        }
                    });

                    const expireTime = new Date(now + 4 * 60 * 60 * 1000);
                    const trackerOps: AnyBulkWriteOperation[] = [];

                    for (const e of entities) {
                        const v = e.vehicle;
                        if (!v || !v.trip || !v.position) continue;

                        const tripId = v.trip.tripId || e.id;
                        const routeId = v.trip.routeId;
                        if (!tripId) continue;

                        trackerOps.push({
                            updateOne: {
                                filter: { tripId: tripId },
                                update: {
                                    $set: { line: routeId, vehicleId: v.vehicle?.id || e.id, expireAt: expireTime, lastUpdate: now },
                                    $push: { trail: { lat: v.position.latitude, lng: v.position.longitude, ts: now, delay: tripDelays[tripId] ?? null } } as any
                                },
                                upsert: true
                            }
                        });

                        if (!activeTracking.has(tripId)) {
                            const tripDoc = await tripsCollection.findOne({ _id: tripId as any });
                            if (tripDoc && tripDoc.stops) {
                                const stopMap = new Map();
                                tripDoc.stops.forEach((s: any) => {
                                    const sInfo = stopLookup.get(s.id);
                                    if (sInfo) {
                                        stopMap.set(s.id, {
                                            routeId: tripDoc.routeId,
                                            destinationName: tripDoc.destinationName,
                                            arrival: s.arr,
                                            departure: s.dep,
                                            scheduledMinutes: s.mins,
                                            lat: sInfo.lat,
                                            lng: sInfo.lng,
                                            arrivalRegistered: null,
                                            hasStopped: false,
                                            completed: false
                                        });
                                    }
                                });
                                activeTracking.set(tripId, { stops: stopMap, lastSeen: now });
                            } else {
                                activeTracking.set(tripId, { lastSeen: now, notFound: true });
                            }
                        } else {
                            activeTracking.get(tripId).lastSeen = now;
                        }

                        const tripData = activeTracking.get(tripId);
                        if (!tripData || tripData.notFound) continue;

                        const pos = { latitude: v.position.latitude, longitude: v.position.longitude };
                        const speed = (v.position.speed || 0) * 3.6;

                        for (const [stopId, data] of tripData.stops.entries()) {
                            if (data.completed) continue;
                            const dist = getDistance(pos, { latitude: data.lat, longitude: data.lng });

                            if (dist <= STOP_RADIUS) {
                                if (!data.arrivalRegistered) {
                                    data.arrivalRegistered = new Date();
                                    console.log(`📍 [Resa ${tripId}] Ankommit till ${stopId}`);
                                }
                                if (speed <= STOPPED_SPEED_THRESHOLD) data.hasStopped = true;
                            } else if (data.arrivalRegistered && dist > STOP_RADIUS + 25) {
                                data.completed = true;
                                const departureTime = new Date();
                                const dateStr = new Date().toISOString().split('T')[0];

                                const actualArrivalSeconds = data.arrivalRegistered.getHours() * 3600 + data.arrivalRegistered.getMinutes() * 60 + data.arrivalRegistered.getSeconds();
                                const actualDepartureSeconds = departureTime.getHours() * 3600 + departureTime.getMinutes() * 60 + departureTime.getSeconds();

                                const timeStopped = departureTime.getTime() - data.arrivalRegistered.getTime();
                                const wasStopped = data.hasStopped || timeStopped >= 25000;

                                const event = {
                                    _id: `${tripId}_${stopId}`,
                                    t: tripId,
                                    l: data.routeId,
                                    dn: data.destinationName,
                                    s: stopId,
                                    d: dateStr,
                                    ts: Date.now(),
                                    sa: typeof data.arrival === 'string' ? (Number(data.arrival.split(':')[0]) * 60 + Number(data.arrival.split(':')[1])) : data.arrival,
                                    sd: typeof data.departure === 'string' ? (Number(data.departure.split(':')[0]) * 60 + Number(data.departure.split(':')[1])) : data.departure,
                                    sdm: data.scheduledMinutes,
                                    aa: actualArrivalSeconds,
                                    ad: actualDepartureSeconds,
                                    st: wasStopped
                                };

                                await stopEventsCollection.updateOne({ _id: event._id as any }, { $set: event }, { upsert: true });
                                savedEventsToday++;
                                console.log(`✅ [Resa ${tripId}] SPARAT: Stopp vid ${stopId} (${event.st ? 'STANNADE' : 'PASSERADE'})`);
                            }
                        }
                    }

                    trackerCount = trackerOps.length;
                    if (trackerCount > 0) {
                        await trailsCollection.bulkWrite(trackerOps, { ordered: false });
                        aktivBool = 1;
                        statusMessage = `Aktiv: <font color='#00ff00'>${trackerCount}</font> fordon (${timeStr})`;
                        cleanText = `Aktiv: ${trackerCount} fordon (${timeStr})`;

                        if (now - lastHeartbeat > 30000) {
                            console.log(`[${timeStr}] 📊 Tracker: ${trackerCount} fordon | 📋 Övervakar: ${activeTracking.size} resor | ✅ Sparat idag: ${savedEventsToday}`);
                            lastHeartbeat = now;
                        }
                    }
                }
            } catch (err: any) {
                const timeStr = new Date().toLocaleTimeString('sv-SE', {hour: '2-digit', minute:'2-digit'});
                statusMessage = `<font color='red'>FEL: Loop-avbrott</font> (${timeStr})`;
                console.error(`❌ Loop-fel vid ${timeStr}:`, err?.message || err);
            }

            try {
                if (fs.existsSync(path.dirname(STATUS_FILE_PATH))) {
                    fs.writeFileSync(STATUS_FILE_PATH, statusMessage);
                    fs.writeFileSync(STATUS_JSON_PATH, JSON.stringify({ text: cleanText, aktiv: aktivBool }));
                }

                await statusCollection.updateOne(
                    { _id: "ingest_status" as any },
                    {
                        $set: {
                            lastUpdate: new Date(),
                            text: cleanText,
                            aktiv: aktivBool === 1,
                            tracking: trackerCount,
                            monitoring: activeTracking.size,
                            savedToday: savedEventsToday
                        }
                    },
                    { upsert: true }
                );
            } catch (e: any) {
                console.error("⚠️ Kunde inte spara status-dokument/fil:", e?.message || e);
            }

            const workDuration = Date.now() - startTime;
            await new Promise(resolve => setTimeout(resolve, Math.max(100, INTERVAL_MS - workDuration)));
        }
    } catch (fatal: any) {
        console.error("FATALT FEL I TJÄNSTEN:", fatal?.message || fatal);
        process.exit(1);
    }
}

runIngest().catch(console.error);
