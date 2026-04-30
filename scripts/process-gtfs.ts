import path from 'path';
import fs from 'fs';
import yauzl from 'yauzl-promise';
import { parse } from 'csv-parse';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const DB_NAME = 'sl-times';

const DATA_DIR = path.resolve(process.cwd(), 'data/raw');
const ZIP_FILE = path.join(DATA_DIR, 'sweden.zip');
const PUBLIC_DIR = path.resolve(process.cwd(), 'public');
const OUT_DIR = path.join(PUBLIC_DIR, 'data');
const LINES_OUT_DIR = path.join(OUT_DIR, 'lines');

const AGENCIES: Record<string, string> = {
    '505000000000000001': 'SL',
    '500000000000000114': 'WAAB',
    '505000000000000606': 'WAAB'
};

const formatCoord = (n: number | string) => Number(Number(n).toFixed(5));

async function streamCsvFromEntry(entry: any, processRow: (row: any) => Promise<void> | void) {
    if (!entry) return;
    const readStream = await entry.openReadStream();
    const parser = readStream.pipe(parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true
    }));
    try {
        for await (const row of parser) {
            await processRow(row);
        }
    } finally {
        if (!readStream.destroyed) readStream.destroy();
    }
}

async function processGTFS() {
    console.log('--- Startar Minnesoptimerad GTFS-bearbetning (SL + WÅAB) ---');

    if (!fs.existsSync(ZIP_FILE)) {
        console.error(`FEL: Hittar inte ${ZIP_FILE}`);
        console.error("Ladda ner GTFS-zip till data/raw/sweden.zip först.");
        process.exit(1);
    }

    if (fs.existsSync(LINES_OUT_DIR)) {
        fs.rmSync(LINES_OUT_DIR, { recursive: true, force: true });
    }
    [PUBLIC_DIR, OUT_DIR, LINES_OUT_DIR].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });

    const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
    await client.connect();
    const db = client.db(DB_NAME);

    const zipfile = await yauzl.open(ZIP_FILE);
    const entries = new Map();
    for await (const entry of zipfile) {
        entries.set(entry.filename, entry);
    }

    try {
        console.log('[1/6] Filtrerar rutter...');
        const validRouteIds = new Set<string>();
        const routesData = new Map<string, any>();
        await streamCsvFromEntry(entries.get('routes.txt'), (row) => {
            const agencyId = row.agency_id || '505000000000000001';
            const agency = AGENCIES[agencyId] || (agencyId === '505000000000000001' ? 'SL' : undefined);
            if (agency) {
                validRouteIds.add(row.route_id);
                row._app_agency = agency;
                routesData.set(row.route_id, row);
            }
        });

        console.log('[1.5/6] Laddar alla hållplatser...');
        const allStopsMap = new Map<string, any>();
        await streamCsvFromEntry(entries.get('stops.txt'), (row) => {
            allStopsMap.set(row.stop_id, {
                id: row.stop_id,
                name: row.stop_name,
                lat: formatCoord(row.stop_lat),
                lng: formatCoord(row.stop_lon)
            });
        });

        console.log('[2/6] Kartlägger resor och väljer representativa turer...');
        const tripToRouteMap = new Map<string, string>();
        const tripToShapeId = new Map<string, string>();
        const routeToBestTrip = new Map<string, string>();
        const tripStopCounts = new Map<string, number>();

        interface ProcessedTrip {
            _id: string;
            routeId: string;
            destinationName: string;
            stops: { id: string; seq: number; arr: string; dep: string; mins: number }[];
        }
        const tripsProcessed = new Map<string, ProcessedTrip>();

        await streamCsvFromEntry(entries.get('trips.txt'), (row) => {
            if (validRouteIds.has(row.route_id)) {
                tripToRouteMap.set(row.trip_id, row.route_id);
                if (row.shape_id) tripToShapeId.set(row.trip_id, row.shape_id);

                tripsProcessed.set(row.trip_id, {
                    _id: row.trip_id,
                    routeId: row.route_id,
                    destinationName: row.trip_headsign || "",
                    stops: []
                });
            }
        });

        await streamCsvFromEntry(entries.get('stop_times.txt'), (row) => {
            if (tripToRouteMap.has(row.trip_id)) {
                const count = (tripStopCounts.get(row.trip_id) || 0) + 1;
                tripStopCounts.set(row.trip_id, count);
            }
        });

        for (const [tripId, routeId] of tripToRouteMap.entries()) {
            const count = tripStopCounts.get(tripId) || 0;
            const currentBest = routeToBestTrip.get(routeId);
            if (!currentBest || count > (tripStopCounts.get(currentBest) || 0)) {
                routeToBestTrip.set(routeId, tripId);
            }
        }

        const selectedTripIds = new Set(routeToBestTrip.values());
        const selectedShapeIds = new Set();
        selectedTripIds.forEach(tid => {
            const sid = tripToShapeId.get(tid);
            if (sid) selectedShapeIds.add(sid);
        });

        console.log('[3/6] Samlar data för utvalda resor och db-resor...');
        const selectedTripStops = new Map<string, any[]>();
        const neededStopIdsForStatic = new Set<string>();
        let processedST = 0;

        await streamCsvFromEntry(entries.get('stop_times.txt'), (row) => {
            if (tripToRouteMap.has(row.trip_id)) {
                if (selectedTripIds.has(row.trip_id)) {
                    if (!selectedTripStops.has(row.trip_id)) selectedTripStops.set(row.trip_id, []);
                    selectedTripStops.get(row.trip_id)!.push(row);
                    neededStopIdsForStatic.add(row.stop_id);
                }

                const trip = tripsProcessed.get(row.trip_id);
                if (trip) {
                    const parts = row.arrival_time ? row.arrival_time.split(':') : row.departure_time.split(':');
                    const h = parts ? Number(parts[0]) : 0;
                    const m = parts ? Number(parts[1]) : 0;
                    trip.stops.push({
                        id: row.stop_id,
                        seq: parseInt(row.stop_sequence),
                        arr: row.arrival_time || row.departure_time,
                        dep: row.departure_time || row.arrival_time,
                        mins: h * 60 + m
                    });
                }
            }
            if (++processedST % 500000 === 0) console.log(`   Läst ${processedST} stop_times-rader...`);
        });

        console.log('[3.5/6] Sparar resor till databasen...');
        await db.collection("trips").deleteMany({}); 
        await db.collection("trips").createIndex({ routeId: 1 });

        const tripOps: any[] = [];
        const usedStopIdsForDb = new Set<string>();

        for (const trip of tripsProcessed.values()) {
            trip.stops.sort((a, b) => a.seq - b.seq);
            if (!trip.destinationName && trip.stops.length > 0) {
                const lastStopId = trip.stops[trip.stops.length - 1].id;
                const stopInfo = allStopsMap.get(lastStopId);
                if (stopInfo) trip.destinationName = stopInfo.name;
            }
            
            tripOps.push({ insertOne: { document: trip } });
            trip.stops.forEach(s => usedStopIdsForDb.add(s.id));

            if (tripOps.length >= 2000) {
                await db.collection("trips").bulkWrite(tripOps);
                tripOps.length = 0;
            }
        }
        if (tripOps.length) await db.collection("trips").bulkWrite(tripOps);


        console.log('[4/6] Streamar former (Shapes)...');
        const finalShapesMap = new Map<string, any[]>();
        await streamCsvFromEntry(entries.get('shapes.txt'), (row) => {
            if (selectedShapeIds.has(row.shape_id)) {
                if (!finalShapesMap.has(row.shape_id)) finalShapesMap.set(row.shape_id, []);
                finalShapesMap.get(row.shape_id)!.push({
                    lat: formatCoord(row.shape_pt_lat),
                    lng: formatCoord(row.shape_pt_lon),
                    seq: parseInt(row.shape_pt_sequence)
                });
            }
        });

        console.log('[5/6] Exporterar data (static JSON)...');
        const manifest = [];
        for (const [routeId, route] of routesData.entries()) {
            const tripId = routeToBestTrip.get(routeId);
            if (!tripId) continue;

            const stimes = (selectedTripStops.get(tripId) || [])
                .sort((a,b) => parseInt(a.stop_sequence) - parseInt(b.stop_sequence));
            
            const stops = stimes.map(st => {
                const s = allStopsMap.get(st.stop_id);
                if (s) return { ...s, agency: route._app_agency };
                return null;
            }).filter(Boolean);

            if (stops.length < 2) continue;

            const shapeId = tripToShapeId.get(tripId);
            const pathPoints = (finalShapesMap.get(shapeId!) || [])
                .sort((a,b) => a.seq - b.seq)
                .map(p => [p.lat, p.lng]);

            const lineData = {
                id: routeId,
                line: route.route_short_name || route.route_long_name,
                agency: route._app_agency,
                path: pathPoints.length > 0 ? pathPoints : stops.map(s => [s.lat, s.lng!]),
                stops: stops
            };

            fs.writeFileSync(path.join(LINES_OUT_DIR, `${routeId}.json`), JSON.stringify(lineData));
            
            manifest.push({
                id: routeId,
                line: lineData.line,
                from: stops[0]!.name,
                to: stops[stops.length-1]!.name,
                agency: route._app_agency
            });
        }

        const staticStopsArray = Array.from(allStopsMap.values()).filter(s => neededStopIdsForStatic.has(s.id));
        fs.writeFileSync(path.join(OUT_DIR, 'stops.json'), JSON.stringify(staticStopsArray));
        fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest));

        console.log('[6/6] Sparar hållplatser och rutter till databasen...');
        const dbStops = Array.from(allStopsMap.values()).filter(s => usedStopIdsForDb.has(s.id));
        
        await db.collection("stops").deleteMany({});
        await db.collection("stops").createIndex({ id: 1 });
        if (dbStops.length) {
            for (let i = 0; i < dbStops.length; i += 1000) {
                await db.collection("stops").bulkWrite(dbStops.slice(i, i + 1000).map(s => ({
                    updateOne: { filter: { id: s.id }, update: { $set: s }, upsert: true }
                })));
            }
        }

        await db.collection("routes").deleteMany({});
        await db.collection("routes").createIndex({ id: 1 });
        if (manifest.length) {
            await db.collection("routes").insertMany(manifest);
        }

        console.log('Skapar realtidsmappning (route-directions.json & trip-to-route.json)...');
        const routeDirectionStats: any = {};
        const tripToRouteIdJson: any = {};

        for (const [tripId, trip] of tripsProcessed.entries()) {
            tripToRouteIdJson[tripId] = {
                r: trip.routeId,
                h: trip.destinationName
            };
        }

        await streamCsvFromEntry(entries.get('trips.txt'), (row) => {
            if (validRouteIds.has(row.route_id)) {
                const dir = row.direction_id;
                let destination = row.trip_headsign || "";
                if (!destination) {
                     const trip = tripsProcessed.get(row.trip_id);
                     if (trip) destination = trip.destinationName;
                }

                if (dir !== undefined && dir !== '' && destination) {
                    if (!routeDirectionStats[row.route_id]) routeDirectionStats[row.route_id] = {};
                    if (!routeDirectionStats[row.route_id][dir]) routeDirectionStats[row.route_id][dir] = {};
                    
                    const currentCount = routeDirectionStats[row.route_id][dir][destination] || 0;
                    routeDirectionStats[row.route_id][dir][destination] = currentCount + 1;
                }
            }
        });

        const routeDirections: any = {};
        for (const [rId, dirs] of Object.entries(routeDirectionStats) as any) {
            routeDirections[rId] = {};
            for (const [dId, counts] of Object.entries(dirs) as any) {
                let bestHeadsign = '';
                let maxCount = 0;
                for (const [h, countVal] of Object.entries(counts) as any) {
                    const c = Number(countVal);
                    if (c > maxCount) {
                        maxCount = c;
                        bestHeadsign = h;
                    }
                }
                if (bestHeadsign) {
                    routeDirections[rId][dId] = bestHeadsign;
                }
            }
        }

        fs.writeFileSync(path.join(OUT_DIR, 'trip-to-route.json'), JSON.stringify(tripToRouteIdJson));
        fs.writeFileSync(path.join(OUT_DIR, 'route-directions.json'), JSON.stringify(routeDirections));


        console.log(`✅ Bearbetning klar! ${manifest.length} linjer sparade.`);
    } catch (error) {
        console.error("KRITISKT FEL:", error);
    } finally {
        try {
            await zipfile.close();
        } catch (e) {
        }
        await client.close();
    }
}

processGTFS().catch(console.error);
