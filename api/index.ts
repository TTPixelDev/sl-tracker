import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { getTripTrail, getTripStopEvents, getIngestStatus } from "../scripts/ingest-rt.ts";

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

// Trafiklab GTFS-RT Vehicle Positions
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

// Trafiklab GTFS-RT Trip Updates
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

// SL Contractor info
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
      // LINE SEARCH ONLY: Never return stops
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

// Line route geometry and ordered stops from static files
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

// Line stops from static route definitions
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
    const path = await getTripTrail(tripId);
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
    const events = await getTripStopEvents(tripId);
    res.setHeader("Cache-Control", "public, max-age=3, s-maxage=5, stale-while-revalidate=5");
    return res.status(200).json(events);
  } catch (e: any) {
    return res.status(200).json([]);
  }
});

// System & ingest status
app.get("/api/status", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=5, s-maxage=10, stale-while-revalidate=5");
  res.status(200).json(getIngestStatus());
});

// Deprecated history archives (zero DB storage costs)
app.get("/api/history", (_req, res) => res.status(200).json([]));
app.get("/api/data-range", (_req, res) => res.status(200).json({ days: 0 }));

export default app;
