import "dotenv/config";
import express from "express";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json());

app.get("/", async (req, res, next) => {
  try {
    const { vehicle, lines, hLine, hStop } = req.query;

    if (!vehicle && !lines && !hLine && !hStop) {
      return next(); // Pass to Next (Vite or Static)
    }

    // Skip interception if we are already fetching internally to avoid loops
    if (req.headers["x-internal-fetch"]) {
      return next();
    }

    let dynamicTitle = "SL Tracker";
    if (hLine && hStop) {
      dynamicTitle = `SL Tracker - Linje ${hLine} ${hStop}`;
    } else if (hLine) {
      dynamicTitle = `SL Tracker - Linje ${hLine}`;
    } else if (lines && vehicle) {
      dynamicTitle = `SL Tracker - Linje ${lines} Vagn ${vehicle}`;
    } else if (lines) {
      dynamicTitle = `SL Tracker - Linje ${lines}`;
    } else if (vehicle) {
      dynamicTitle = `SL Tracker - Vagn ${vehicle}`;
    }

    // Fetch the underlying static HTML page from the Vercel edge/deployment
    const host = req.headers.host;
    const protocol = host?.includes("localhost") ? "http" : "https";
    
    // Use x-internal-fetch header to avoid intercepting our own fetch locally
    const htmlRes = await fetch(`${protocol}://${host}/`, {
      headers: {
        "x-internal-fetch": "true"
      }
    });
    
    if(!htmlRes.ok) {
       return next();
    }
    let html = await htmlRes.text();
    
    const titleTag = `<title>${dynamicTitle}</title>\n    <meta property="og:title" content="${dynamicTitle}" />\n    <meta name="twitter:title" content="${dynamicTitle}" />`;
    html = html.replace(/<title>.*?<\/title>/i, titleTag);
    
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(html);
  } catch (err) {
    console.error("Failed to serve dynamic HTML", err);
    next();
  }
});

let mongoClient: MongoClient | null = null;
let clientPromise: Promise<MongoClient> | null = null;
let indexesPromise: Promise<any> | null = null;

function handleDbError(err: any) {
  if (!err) return;
  const errMsg = String(err.message || err || "");
  if (
    errMsg.toLowerCase().includes("closed") || 
    errMsg.toLowerCase().includes("topology") || 
    err.name === "MongoTopologyClosedError" || 
    err.name === "MongoNetworkError"
  ) {
    console.warn("Database connection issue detected (such as closed topology). Resetting connection cache so next operation triggers a fresh reconnect:", errMsg);
    resetConnection();
  }
}

function resetConnection() {
  if (mongoClient) {
    try {
      mongoClient.close().catch(() => {});
    } catch (e) {}
  }
  mongoClient = null;
  clientPromise = null;
}

async function ensureIndexes(db: any) {
  if (indexesPromise) return;
  
  indexesPromise = Promise.all([
    db.collection("stop_events").createIndex({ d: 1, l: 1, s: 1, sdm: 1 }).catch(console.error),
    db.collection("stop_events").createIndex({ t: 1, ts: -1 }).catch(console.error),
    db.collection("stop_events").createIndex({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }).catch(console.error),
    db.collection("vehicle_trails").createIndex({ tripId: 1 }, { unique: true }).catch(console.error),
    db.collection("vehicle_trails").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(console.error)
  ]).then(() => {
    console.log("MongoDB indexes verified.");
  }).catch((err) => {
    console.error("Failed to verify indexes:", err);
    indexesPromise = null;
  });
}

async function getConnectedClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is fully empty! Cannot connect to database.");
  }

  if (!clientPromise) {
    console.log("Initializing a fresh MongoClient instance...");
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 1,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });

    clientPromise = client.connect().then((connectedClient) => {
      console.log("Connected to MongoDB successfully.");
      mongoClient = connectedClient;

      connectedClient.on("close", () => {
        console.warn("MongoClient received a 'close' event. Deregistering cached client.");
        if (mongoClient === connectedClient) {
          mongoClient = null;
          clientPromise = null;
        }
      });

      ensureIndexes(connectedClient.db("sl-times"));
      return connectedClient;
    }).catch((err) => {
      console.error("MongoDB connection failed:", err);
      mongoClient = null;
      clientPromise = null;
      throw err;
    });
  }

  try {
    return await clientPromise;
  } catch (err) {
    mongoClient = null;
    clientPromise = null;
    throw err;
  }
}

const getDb = async (dbName: string) => {
  try {
    const client = await getConnectedClient();
    return client.db(dbName);
  } catch (err) {
    handleDbError(err);
    throw err;
  }
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
    const { tripId, date } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });
    const db = await getDb("sl-times");
    
    let targetDate = date as string;

    if (!targetDate) {
      // Fetch the most recent event to determine the date of the latest run
      const latestEvent = await db.collection("stop_events").findOne({ t: tripId }, { sort: { ts: -1 } });
      if (!latestEvent) return res.status(200).json([]);
  
      // If the latest event is older than 8 hours, it's from a previous day's run and shouldn't be matched with current live trip
      if (Date.now() - latestEvent.ts > 8 * 60 * 60 * 1000) {
        return res.status(200).json([]);
      }
      targetDate = latestEvent.d;
    }

    // Fetch all events for that specific trip run (same date as the recent event)
    const events = await db.collection("stop_events").find({ t: tripId, d: targetDate }).sort({ ts: 1 }).toArray();
    
    const formatTime = (secs: any) => {
      if (secs == null || isNaN(Number(secs))) return null;
      let h = Math.floor(Number(secs) / 3600) % 24;
      const m = Math.floor((Number(secs) % 3600) / 60);
      const s = Number(secs) % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    res.status(200).json(events.map(e => ({
      stopId: e.s,
      stopped: e.st,
      actualArrival: formatTime(e.aa),
      actualDeparture: formatTime(e.ad),
      scheduledDeparture: formatTime(e.sd != null ? e.sd * 60 : null),
      scheduledArrival: formatTime(e.sa != null ? e.sa * 60 : null)
    })));
  } catch (e: any) {
    handleDbError(e);
    res.status(200).json([]);
  }
});

app.get("/api/trip-history", async (req, res) => {
  try {
    const { tripId } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });
    const db = await getDb("sl-times");
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
    handleDbError(e);
    res.status(200).json({ path: [] });
  }
});

app.get("/api/status", async (req, res) => {
  try {
    const db = await getDb("sl-times");
    const status = await db.collection("status").findOne({ _id: "ingest_status" as any });
    if (!status) return res.status(200).json({ online: false, text: "Ingen status", lastUpdate: null });
    const isOnline = (Date.now() - (status.lastUpdate ? new Date(status.lastUpdate).getTime() : 0)) < 180000;
    res.setHeader("Cache-Control", "public, max-age=15, s-maxage=30, stale-while-revalidate=10");
    res.status(200).json({
      online: isOnline,
      text: status.text || "Väntar...",
      lastUpdate: status.lastUpdate,
      tracking: status.tracking || 0,
      savedToday: status.savedToday || 0
    });
  } catch (e: any) {
    handleDbError(e);
    res.status(200).json({ online: false, text: "Ingen status", lastUpdate: null });
  }
});

app.get("/api/data-range", async (req, res) => {
  try {
    const db = await getDb("sl-times");
    const earliest = await db.collection("stop_events").find({}, { projection: { d: 1 } }).sort({ d: 1 }).limit(1).toArray();
    if (!earliest.length || !earliest[0].d) return res.status(200).json({ days: 0 });
    const date = new Date(earliest[0].d);
    const diff = Math.max(0, new Date().getTime() - date.getTime());
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    res.status(200).json({ days: Math.ceil(diff / (1000 * 3600 * 24)) });
  } catch (e: any) {
    console.error("Data range error:", e);
    handleDbError(e);
    res.status(200).json({ days: 0 });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { q, type } = req.query;
    if (typeof q !== "string" || !q) return res.status(200).json([]);
    const db = await getDb("sl-times");
    if (type === "stop") {
      const stops = await db.collection("stops").find({ name: { $regex: q, $options: "i" } }).limit(15).toArray();
      return res.status(200).json(stops.map(s => ({ type: "stop", id: s.id, title: s.name, subtitle: "Hållplats" })));
    } else {
      const routes = await db.collection("routes").find({
        $or: [ { shortName: { $regex: q, $options: "i" } }, { longName: { $regex: q, $options: "i" } } ]
      }).limit(15).toArray();
      return res.status(200).json(routes.map(r => ({ type: "line", id: r.id, title: `Linje ${r.shortName}`, subtitle: r.longName })));
    }
  } catch (e: any) {
    handleDbError(e);
    res.status(200).json([]);
  }
});

app.get("/api/line-stops", async (req, res) => {
  try {
    const { lineId } = req.query;
    if (typeof lineId !== "string" || !lineId) return res.status(200).json({ stops: [] });
    const db = await getDb("sl-times");
    const trips = await db.collection("trips").find({ routeId: lineId }).toArray();
    const sIds = new Set<string>();
    trips.forEach(t => t.stops?.forEach((s: any) => { if (s.id) sIds.add(String(s.id)); }));
    const stops = await db.collection("stops").find({ id: { $in: Array.from(sIds) } }).toArray();
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({ stops: stops.sort((a,b) => a.name.localeCompare(b.name)) });
  } catch (e: any) {
    handleDbError(e);
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
    const db = await getDb("sl-times");
    const timeStr = time as string;
    const [h, m] = timeStr.split(":").map(Number);
    const searchMinutes = h * 60 + m;
    const stopIds = (stopId as string).split(",").map(s => s.trim()).filter(Boolean);
    
    // Fallback: lookup stop names to find other platform/direction stop IDs automatically
    let expandedStopIds = [...stopIds];
    try {
      const sOpts = stopIds.flatMap(s => [s, parseInt(s)].filter(val => !isNaN(Number(val))));
      const inputStops = await db.collection("stops").find({ id: { $in: sOpts } }).toArray();
      const names = Array.from(new Set(inputStops.map(s => s.name).filter(Boolean)));
      if (names.length > 0) {
        const matchingStops = await db.collection("stops").find({ name: { $in: names } }).toArray();
        matchingStops.forEach(s => {
          if (s.id && !expandedStopIds.includes(String(s.id))) {
            expandedStopIds.push(String(s.id));
          }
        });
      }
    } catch (e) {
      console.warn("Stop expansion failed, falling back to query parameters", e);
    }

    const sOptsFinal = expandedStopIds.flatMap(s => [s, parseInt(s)].filter(val => !isNaN(Number(val))));
    let query: any = { l: lineId, s: sOptsFinal.length > 1 ? { $in: sOptsFinal } : sOptsFinal[0] };
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
  } catch(e: any) {
    handleDbError(e);
    res.status(200).json([]);
  }
});

export default app;
