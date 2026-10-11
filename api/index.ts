import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";

const app = express();
app.use(express.json());

// Dynamic SEO meta tags for direct links
app.get("/", async (req, res, next) => {
  try {
    const { vehicle, lines } = req.query;

    if (!vehicle && !lines) {
      return next(); // Pass to Vite or Static
    }

    if (req.headers["x-internal-fetch"]) {
      return next();
    }

    let dynamicTitle = "SL-Tracker";
    if (lines && vehicle) {
      dynamicTitle = `SL-Tracker - Linje ${lines} Vagn ${vehicle}`;
    } else if (lines) {
      dynamicTitle = `SL-Tracker - Linje ${lines}`;
    } else if (vehicle) {
      dynamicTitle = `SL-Tracker - Vagn ${vehicle}`;
    }

    const host = req.headers.host;
    const protocol = host?.includes("localhost") ? "http" : "https";

    const htmlRes = await fetch(`${protocol}://${host}/`, {
      headers: {
        "x-internal-fetch": "true"
      }
    });

    if (!htmlRes.ok) {
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

// Load static transit data into memory for instant, zero-database search
const DATA_DIR = path.resolve(process.cwd(), "public/data");
const LINES_DIR = path.join(DATA_DIR, "lines");

interface ManifestRoute {
  id: string;
  line: string;
  from: string;
  to: string;
  agency?: string;
}

interface StaticStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  agency?: string;
}

let manifestRoutes: ManifestRoute[] = [];
let allStops: StaticStop[] = [];
const stopsMap = new Map<string, StaticStop>();

try {
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  if (fs.existsSync(manifestPath)) {
    manifestRoutes = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  }
  const stopsPath = path.join(DATA_DIR, "stops.json");
  if (fs.existsSync(stopsPath)) {
    allStops = JSON.parse(fs.readFileSync(stopsPath, "utf-8"));
    for (const s of allStops) {
      stopsMap.set(String(s.id), s);
    }
  }
  console.log(`Loaded ${manifestRoutes.length} routes and ${allStops.length} stops into memory.`);
} catch (err) {
  console.error("Error loading static transit data:", err);
}

// Leak-free, singleton MongoDB client for serverless and long-running Node environments
let cachedMongoClient: MongoClient | null = null;
let clientConnectingPromise: Promise<MongoClient | null> | null = null;

function handleDbError(err: any) {
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
    console.warn("Databasanslutningsfel upptäckt i API, nollställer klienten:", msg);
    if (cachedMongoClient) {
      try {
        cachedMongoClient.close().catch(() => { });
      } catch { }
    }
    cachedMongoClient = null;
    clientConnectingPromise = null;
  }
}

async function getMongoClient(): Promise<MongoClient | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (cachedMongoClient) return cachedMongoClient;
  if (clientConnectingPromise) return clientConnectingPromise;

  clientConnectingPromise = (async () => {
    try {
      const client = new MongoClient(uri, {
        maxPoolSize: 5,
        connectTimeoutMS: 6000,
        serverSelectionTimeoutMS: 6000,
        socketTimeoutMS: 20000
      });
      await client.connect();
      cachedMongoClient = client;
      return client;
    } catch (err: any) {
      console.warn("MongoDB connection warning in API route:", err?.message || err);
      cachedMongoClient = null;
      return null;
    } finally {
      clientConnectingPromise = null;
    }
  })();

  return clientConnectingPromise;
}

// Trafiklab GTFS-RT Vehicle Positions
app.get("/api/gtfs-rt", async (req, res) => {
  try {
    const apiKey = process.env.RT_API_KEY;
    if (!apiKey) {
      console.warn("RT_API_KEY saknas i miljövariabler.");
      return res.status(503).json({ error: "Missing RT_API_KEY on server" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const apiRes = await fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/VehiclePositionsSweden.pb?key=${apiKey}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      return res.status(apiRes.status).send(await apiRes.text());
    }
    const buffer = await apiRes.arrayBuffer();
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate=1");
    return res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("Fel i /api/gtfs-rt:", e?.message || e);
    return res.status(502).json({ error: e?.message || "Failed to fetch vehicle positions" });
  }
});

// Trafiklab GTFS-RT Trip Updates
app.get("/api/trip-updates", async (req, res) => {
  try {
    const apiKey = process.env.RT_API_KEY;
    if (!apiKey) {
      console.warn("RT_API_KEY saknas i miljövariabler.");
      return res.status(503).json({ error: "Missing RT_API_KEY on server" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const apiRes = await fetch(`https://opendata.samtrafiken.se/gtfs-rt-sweden/sl/TripUpdatesSweden.pb?key=${apiKey}`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      return res.status(apiRes.status).send(await apiRes.text());
    }
    const buffer = await apiRes.arrayBuffer();
    res.setHeader("Content-Type", "application/x-protobuf");
    res.setHeader("Cache-Control", "s-maxage=1, stale-while-revalidate=1");
    return res.status(200).send(Buffer.from(buffer));
  } catch (e: any) {
    console.error("Fel i /api/trip-updates:", e?.message || e);
    return res.status(502).json({ error: e?.message || "Failed to fetch trip updates" });
  }
});

// SL Contractor info (with timeout and fallback to avoid 500 error on frontend)
app.get("/api/contractors", async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch('https://transport.integration.sl.se/v1/lines?transport_authority_id=1', {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let text = await response.text();
    text = text.replace(/"gid":\s*([0-9]+)/g, '"gid": "$1"');
    const data = JSON.parse(text);

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=172800');
    return res.status(200).json(data);
  } catch (error: any) {
    console.warn("Contractor fetch non-fatal warning:", error?.message || error);
    // Return empty lines object with 200 so UI continues smoothly
    return res.status(200).json({});
  }
});

// Fast in-memory stop & line search
app.get("/api/search", (req, res) => {
  try {
    const { q, type, agency } = req.query;
    if (typeof q !== "string" || !q.trim()) return res.status(200).json([]);
    const queryStr = q.trim();

    const isLineQuery = type === "line" || (
      type !== "stop" && (
        /^\d{1,3}[a-zA-Z]?$/i.test(queryStr) ||
        /^(linje|line|l)\s*([0-9a-zA-Z]+)?$/i.test(queryStr)
      )
    );

    if (type === "stop" || (!isLineQuery && type !== "line")) {
      // STOP SEARCH ONLY: Never return routes
      const escaped = queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(escaped, 'i');

      const seenNames = new Set<string>();
      const stops: any[] = [];

      for (const s of allStops) {
        if (agency && agency !== 'ALL' && s.agency && s.agency !== agency) continue;
        if (!reg.test(s.name)) continue;

        const norm = s.name.trim().toLowerCase();
        if (!seenNames.has(norm)) {
          seenNames.add(norm);
          stops.push({
            type: "stop",
            id: s.id,
            title: s.name,
            subtitle: s.agency === 'WAAB' ? "Brygga" : "Hållplats",
            agency: s.agency || 'SL',
            lat: s.lat,
            lng: s.lng
          });
        }
        if (stops.length >= 80) break;
      }

      // Sort stops: exact match first, then startsWith, then others alphabetically
      const qLower = queryStr.toLowerCase();
      stops.sort((a, b) => {
        const aLower = a.title.toLowerCase();
        const bLower = b.title.toLowerCase();
        if (aLower === qLower && bLower !== qLower) return -1;
        if (bLower === qLower && aLower !== qLower) return 1;
        const aStarts = aLower.startsWith(qLower);
        const bStarts = bLower.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return a.title.localeCompare(b.title);
      });

      return res.status(200).json(stops.slice(0, 25));
    } else {
      // LINE SEARCH
      const cleanLineQ = queryStr.replace(/^(linje|line|l)\s*/i, '').trim();
      const escaped = cleanLineQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const startsReg = new RegExp(`^${escaped}`, 'i');
      const includesReg = new RegExp(escaped, 'i');

      let filtered = manifestRoutes.filter(r => {
        if (agency && agency !== 'ALL' && r.agency && r.agency !== agency) return false;
        return startsReg.test(r.line);
      });

      if (filtered.length === 0 && escaped.length > 0) {
        filtered = manifestRoutes.filter(r => {
          if (agency && agency !== 'ALL' && r.agency && r.agency !== agency) return false;
          return includesReg.test(r.line);
        });
      }

      filtered.sort((a, b) => {
        const numA = parseInt(a.line.replace(/\D/g, ''));
        const numB = parseInt(b.line.replace(/\D/g, ''));
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          return numA - numB;
        }
        return a.line.localeCompare(b.line);
      });

      return res.status(200).json(filtered.slice(0, 30).map(r => ({
        type: "line",
        id: r.id,
        title: `Linje ${r.line}`,
        subtitle: `${r.from} - ${r.to}`,
        agency: r.agency || 'SL'
      })));
    }
  } catch (e: any) {
    console.error("Search error:", e);
    res.status(200).json([]);
  }
});

// Route geometry & stops
app.get("/api/line-route", (req, res) => {
  try {
    const { routeId } = req.query;
    if (!routeId || typeof routeId !== "string") return res.status(400).json({ error: "Missing routeId" });

    const filePath = path.join(LINES_DIR, `${routeId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Route not found" });
    }

    const data = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).send(data);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Line stops for a given line
app.get("/api/line-stops", (req, res) => {
  try {
    const { lineId } = req.query;
    if (!lineId || typeof lineId !== "string") return res.status(200).json({ stops: [] });

    const filePath = path.join(LINES_DIR, `${lineId}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(200).json({ stops: [] });
    }

    const lineData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const stops = (lineData.stops || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      lat: s.lat,
      lng: s.lng,
      agency: s.agency
    }));

    stops.sort((a: any, b: any) => a.name.localeCompare(b.name));
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json({ stops });
  } catch (e: any) {
    res.status(200).json({ stops: [] });
  }
});

// Single stop lookup
app.get("/api/stop", (req, res) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing stop id" });
    const stop = stopsMap.get(String(id));
    if (!stop) return res.status(404).json({ error: "Stop not found" });
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json(stop);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Live trip history (trails for current running buses, auto-purged after 4 hours)
app.get("/api/trip-history", async (req, res) => {
  try {
    const { tripId } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });

    const client = await getMongoClient();
    if (!client) return res.status(200).json({ path: [] });

    const cleanTripId = String(tripId).trim();
    let trip: any = null;
    try {
      trip = await client.db("sl-times").collection("vehicle_trails").findOne(
        { tripId: cleanTripId },
        { projection: { trail: 1, _id: 0 } }
      );
    } catch (dbErr) {
      handleDbError(dbErr);
      return res.status(200).json({ path: [] });
    }

    if (!trip || !Array.isArray(trip.trail) || trip.trail.length === 0) {
      return res.status(200).json({ path: [] });
    }

    const allPoints = trip.trail.sort((a: any, b: any) => a.ts - b.ts);
    let currentRunStartIndex = 0;
    for (let i = 1; i < allPoints.length; i++) {
      if (allPoints[i].ts - allPoints[i - 1].ts > 1.5 * 60 * 60 * 1000) {
        currentRunStartIndex = i;
      }
    }

    let pathPoints = allPoints.slice(currentRunStartIndex);
    if (pathPoints.length < 2 && allPoints.length >= 2) {
      pathPoints = allPoints.slice(-50);
    }

    const path = pathPoints.map((p: any) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
      speed: p.speed,
      delay: p.delay
    }));

    res.setHeader("Cache-Control", "public, max-age=3, s-maxage=5, stale-while-revalidate=5");
    return res.status(200).json({ path });
  } catch (e: any) {
    return res.status(200).json({ path: [] });
  }
});

// Live trip events (stopped and passed stops for current running trips)
app.get("/api/trip-events", async (req, res) => {
  try {
    const { tripId } = req.query;
    if (!tripId || typeof tripId !== "string") return res.status(400).json({ error: "Missing tripId" });

    const client = await getMongoClient();
    if (!client) return res.status(200).json([]);

    const cleanTripId = String(tripId).trim();
    let events: any[] = [];
    try {
      events = await client.db("sl-times").collection("stop_events").find({ t: cleanTripId }).sort({ ts: 1 }).toArray();
    } catch (dbErr) {
      handleDbError(dbErr);
      return res.status(200).json([]);
    }

    const formatTime = (secs: any) => {
      if (secs == null || isNaN(Number(secs))) return null;
      let h = Math.floor(Number(secs) / 3600) % 24;
      const m = Math.floor((Number(secs) % 3600) / 60);
      const s = Number(secs) % 60;
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    };

    res.setHeader("Cache-Control", "public, max-age=3, s-maxage=5, stale-while-revalidate=5");
    return res.status(200).json(events.map((e: any) => ({
      stopId: e.s,
      stopName: e.stopName || e.dn || "",
      stopped: Boolean(e.st),
      isReglering: Boolean(e.reg),
      actualArrival: formatTime(e.aa),
      actualDeparture: formatTime(e.ad),
      scheduledArrival: formatTime(e.sa != null ? (e.sa > 3600 ? e.sa : e.sa * 60) : null),
      scheduledDeparture: formatTime(e.sd != null ? (e.sd > 3600 ? e.sd : e.sd * 60) : null)
    })));
  } catch (e: any) {
    return res.status(200).json([]);
  }
});

// System & ingest status
app.get("/api/status", async (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=10, stale-while-revalidate=5");
  try {
    const client = await getMongoClient();
    if (client) {
      const statusDoc: any = await client.db("sl-times").collection("status").findOne({ _id: "ingest_status" as any });
      if (statusDoc) {
        const isOnline = Date.now() - (statusDoc.lastUpdate ? new Date(statusDoc.lastUpdate).getTime() : 0) < 3 * 60 * 1000;
        return res.status(200).json({
          online: isOnline,
          tracking: statusDoc.tracking || 0,
          lastUpdate: statusDoc.lastUpdate,
          text: statusDoc.text || "Live spårning aktiv"
        });
      }
    }
  } catch (err) {
    handleDbError(err);
  }

  return res.status(200).json({
    online: true,
    tracking: 0,
    lastUpdate: new Date().toISOString(),
    text: "Live realtidsspårning aktiv"
  });
});

// Deprecated history archives (zero DB storage costs)
app.get("/api/history", (_req, res) => res.status(200).json([]));
app.get("/api/data-range", (_req, res) => res.status(200).json({ days: 0 }));

export default app;
