import "dotenv/config";
import express from "express";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json());

let mongoClient: MongoClient | null = null;
let indexesCreated = false;

if (process.env.MONGODB_URI) {
  mongoClient = new MongoClient(process.env.MONGODB_URI);
  mongoClient.connect().then(() => {
    console.log("Connected to MongoDB");
    // Auto-create indexes in the background to prevent Vercel crashes
    const db = mongoClient!.db("sl-times");
    Promise.all([
      db.collection("stop_events").createIndex({ d: 1, l: 1, s: 1, sdm: 1 }).catch(console.error),
      db.collection("stop_events").createIndex({ t: 1, ts: -1 }).catch(console.error),
      db.collection("stop_events").createIndex({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }).catch(console.error),
      db.collection("vehicle_trails").createIndex({ tripId: 1 }, { unique: true }).catch(console.error),
      db.collection("vehicle_trails").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(console.error)
    ]).then(() => {
      indexesCreated = true;
      console.log("MongoDB indexes verified.");
    });
  }).catch(err => console.error("MongoDB start error:", err));
} else {
  console.warn("MONGODB_URI is fully empty! Functionality requiring database will crash.");
}

const getDb = (dbName: string) => {
  if (!mongoClient) throw new Error("No Mongo Client");
  return mongoClient.db(dbName);
};

app.get("/api/gtfs-rt", async (req, res) => {
  try {
    const apiKey = process.env.RT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing RT_API_KEY" });
    const apiRes = await fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb?key=${apiKey}`);
    if (!apiRes.ok) return res.status(apiRes.status).send(await apiRes.text());
    const buffer = await apiRes.arrayBuffer();
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate=1");
    res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/trip-updates", async (req, res) => {
  try {
    const apiKey = process.env.RT_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "Missing RT_API_KEY" });
    const apiRes = await fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/TripUpdatesSweden.pb?key=${apiKey}`);
    if (!apiRes.ok) return res.status(apiRes.status).send(await apiRes.text());
    const buffer = await apiRes.arrayBuffer();
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate=1");
    res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/trip-events", async (req, res) => {
  try {
    const { tripId } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });
    const db = getDb("sl-times");
    
    // Fetch the most recent event to determine the date of the latest run
    const latestEvent = await db.collection("stop_events").findOne({ t: tripId }, { sort: { ts: -1 } });
    if (!latestEvent) return res.status(200).json([]);

    // If the latest event is older than 8 hours, it's from a previous day's run and shouldn't be matched with current live trip
    if (Date.now() - latestEvent.ts > 8 * 60 * 60 * 1000) {
      return res.status(200).json([]);
    }

    // Fetch all events for that specific trip run (same date as the recent event)
    const events = await db.collection("stop_events").find({ t: tripId, d: latestEvent.d }).toArray();
    
    res.status(200).json(events.map(e => ({
      stopId: e.s,
      stopped: e.st,
      actualArrival: e.aa,
      actualDeparture: e.ad,
      scheduledDeparture: e.sd,
      scheduledArrival: e.sa
    })));
  } catch (e: any) {
    res.status(200).json([]);
  }
});

app.get("/api/trip-history", async (req, res) => {
  try {
    const { tripId } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });
    const db = getDb("sl-times");
    const trip = await db.collection("vehicle_trails").findOne({ tripId }, { projection: { trail: 1, _id: 0 } });
    if (!trip || !trip.trail) return res.status(200).json({ path: [] });
    
    // Filter out old points from previous days
    const allPoints = (trip.trail as any[]).sort((a: any, b: any) => a.ts - b.ts);
    let currentRunStartIndex = 0;
    for (let i = 1; i < allPoints.length; i++) {
        // If there's a gap of more than 1.5 hours between points, consider it a new run
        if (allPoints[i].ts - allPoints[i-1].ts > 1.5 * 60 * 60 * 1000) {
            currentRunStartIndex = i;
        }
    }
    const path = allPoints.slice(currentRunStartIndex).map(p => ({ lat: p.lat, lng: p.lng, ts: p.ts, delay: p.delay }));
      
    res.status(200).json({ path });
  } catch (e: any) {
    res.status(200).json({ path: [] });
  }
});

app.get("/api/status", async (req, res) => {
  try {
    const db = getDb("sl-times");
    const status = await db.collection("status").findOne({ _id: "ingest_status" as any });
    if (!status) return res.status(200).json({ online: false, text: "Ingen status", lastUpdate: null });
    const isOnline = (Date.now() - (status.lastUpdate ? new Date(status.lastUpdate).getTime() : 0)) < 180000;
    res.status(200).json({
      online: isOnline,
      text: status.text || "Väntar...",
      lastUpdate: status.lastUpdate,
      tracking: status.tracking || 0,
      savedToday: status.savedToday || 0
    });
  } catch (e) {
    res.status(200).json({ online: false, text: "Ingen status", lastUpdate: null });
  }
});

app.get("/api/data-range", async (req, res) => {
  try {
    const db = getDb("sl-times");
    const earliest = await db.collection("stop_events").find({}, { projection: { d: 1 } }).sort({ d: 1 }).limit(1).toArray();
    if (!earliest.length || !earliest[0].d) return res.status(200).json({ days: 0 });
    const date = new Date(earliest[0].d);
    const diff = Math.max(0, new Date().getTime() - date.getTime());
    res.status(200).json({ days: Math.ceil(diff / (1000 * 3600 * 24)) });
  } catch (e: any) {
    console.error("Data range error:", e);
    res.status(200).json({ days: 0 });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { q, type } = req.query;
    if (typeof q !== "string" || !q) return res.status(200).json([]);
    if (!mongoClient) return res.status(200).json([]);
    const db = getDb("sl-times");
    if (type === "stop") {
      const stops = await db.collection("stops").find({ name: { $regex: q, $options: "i" } }).limit(15).toArray();
      return res.status(200).json(stops.map(s => ({ type: "stop", id: s.id, title: s.name, subtitle: "Hållplats" })));
    } else {
      const routes = await db.collection("routes").find({
        $or: [ { shortName: { $regex: q, $options: "i" } }, { longName: { $regex: q, $options: "i" } } ]
      }).limit(15).toArray();
      return res.status(200).json(routes.map(r => ({ type: "line", id: r.id, title: `Linje ${r.shortName}`, subtitle: r.longName })));
    }
  } catch (e) {
    res.status(200).json([]);
  }
});

app.get("/api/line-stops", async (req, res) => {
  try {
    const { lineId } = req.query;
    if (typeof lineId !== "string" || !lineId) return res.status(200).json({ stops: [] });
    const db = getDb("sl-times");
    const trips = await db.collection("trips").find({ routeId: lineId }).toArray();
    const sIds = new Set<string>();
    trips.forEach(t => t.stops?.forEach((s: any) => { if (s.id) sIds.add(String(s.id)); }));
    const stops = await db.collection("stops").find({ id: { $in: Array.from(sIds) } }).toArray();
    return res.status(200).json({ stops: stops.sort((a,b) => a.name.localeCompare(b.name)) });
  } catch (e) {
    res.status(200).json({ stops: [] });
  }
});

app.get("/api/contractors", async (req, res) => {
  try {
    const response = await fetch('https://transport.integration.sl.se/v1/lines?transport_authority_id=1');
    if (!response.ok) throw new Error(response.statusText);

    let text = await response.text();
    text = text.replace(/"gid":\s*([0-9]+)/g, '"gid": "$1"');
    const data = JSON.parse(text);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json(data);
  } catch (error) {
    console.error("Contractor fetch error:", error);
    return res.status(500).json({ error: 'Failed to fetch contractor data' });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const { date, lineId, stopId, time, offset = 0, limit = 5, direction = "next" } = req.query;
    if (!date || !lineId || !stopId || !time) return res.status(400).json({ error: "Missing parameters" });
    const db = getDb("sl-times");
    const timeStr = time as string;
    const [h, m] = timeStr.split(":").map(Number);
    const searchMinutes = h * 60 + m;
    const stopIds = (stopId as string).split(",").map(s => s.trim()).filter(Boolean);
    const sOpts = stopIds.flatMap(s => [s, parseInt(s)]);
    let query: any = { l: lineId, s: sOpts.length > 1 ? { $in: sOpts } : sOpts[0] };
    const dateStr = date as string;

    let sort: any = { d: 1, sdm: 1 };
    const refDate = req.query.refDate as string;
    const refSdm = parseInt(req.query.refSdm as string);
    
    const startMin = (!isNaN(refSdm) && refDate) ? refSdm : searchMinutes;
    const startDate = (!isNaN(refSdm) && refDate) ? refDate : dateStr;

    if (direction === "next") {
      query.$or = [ { d: startDate, sdm: { $gte: startMin } }, { d: { $gt: startDate } } ];
      sort = { d: 1, sdm: 1, _id: 1 };
    } else {
      query.$or = [ { d: startDate, sdm: { $lt: startMin } }, { d: { $lt: startDate } } ];
      sort = { d: -1, sdm: -1, _id: -1 };
    }

    const rawEvents = await db.collection("stop_events").find(query).sort(sort).skip(Math.max(0, parseInt(offset as string) || 0)).limit(Math.min(50, Math.max(1, parseInt(limit as string) || 5))).toArray();
    const formatTime = (secs: any) => {
      if (secs == null || isNaN(Number(secs))) return null;
      let h = Math.floor(secs / 3600) % 24;
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    const events = rawEvents.map(e => ({
      id: e._id, tripId: e.t, line: e.l, stopId: e.s, destinationName: e.dn || "", date: e.d, timestamp: e.ts,
      scheduledArrival: formatTime(e.sa * 60), scheduledDeparture: formatTime(e.sd * 60), actualArrival: formatTime(e.aa), actualDeparture: formatTime(e.ad),
      stopped: e.st, scheduledDepartureMinutes: e.sdm
    }));

    for (const ev of events) {
      if (!ev.destinationName) {
         const tr = await db.collection("trips").findOne({ _id: ev.tripId }, { projection: { destinationName: 1 } });
         if (tr?.destinationName) ev.destinationName = tr.destinationName;
      }
    }

    if (direction === "prev") events.reverse();
    return res.status(200).json(events);
  } catch(e) {
    res.status(200).json([]);
  }
});

export default app;
