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

    let dynamicTitle = "SL-Tracker";
    if (hLine && hStop) {
      dynamicTitle = `SL-Tracker - Linje ${hLine} ${hStop}`;
    } else if (hLine) {
      dynamicTitle = `SL-Tracker - Linje ${hLine}`;
    } else if (lines && vehicle) {
      dynamicTitle = `SL-Tracker - Linje ${lines} Vagn ${vehicle}`;
    } else if (lines) {
      dynamicTitle = `SL-Tracker - Linje ${lines}`;
    } else if (vehicle) {
      dynamicTitle = `SL-Tracker - Vagn ${vehicle}`;
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
      mongoClient.close().catch(() => { });
    } catch (e) { }
  }
  mongoClient = null;
  clientPromise = null;
}

async function ensureIndexes(db: any) {
  if (indexesPromise) return;

  indexesPromise = Promise.all([
    db.collection("stop_events").createIndex({ d: 1, l: 1, s: 1, sdm: 1 }).catch(console.error),
    db.collection("stop_events").createIndex({ t: 1, ts: -1 }).catch(console.error),
    db.collection("stop_events").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }).catch(console.error),
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

    // Look up trip in trips collection to accurately identify regleringshållplatser
    const tripDoc = await db.collection("trips").findOne({ _id: tripId as any });
    const regleringStopIds = new Set<string>();

    if (tripDoc && Array.isArray(tripDoc.stops) && tripDoc.stops.length > 0) {
      const hasInterpolated = tripDoc.stops.some((s: any) =>
        (s.arr && !s.arr.endsWith(':00')) || (s.dep && !s.dep.endsWith(':00'))
      );
      tripDoc.stops.forEach((s: any, idx: number) => {
        const isTerminal = idx === 0 || idx === tripDoc.stops.length - 1;
        const isDwell = s.arr && s.dep && s.arr !== s.dep;
        const isTimepoint = hasInterpolated && (s.arr?.endsWith(':00') || s.dep?.endsWith(':00'));
        if (isTerminal || isDwell || isTimepoint) {
          regleringStopIds.add(String(s.id));
        }
      });
    }

    const formatTime = (secs: any) => {
      if (secs == null || isNaN(Number(secs))) return null;
      let h = Math.floor(Number(secs) / 3600) % 24;
      const m = Math.floor((Number(secs) % 3600) / 60);
      const s = Number(secs) % 60;
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    res.status(200).json(events.map(e => {
      const isReg = e.reg != null
        ? Boolean(e.reg)
        : (regleringStopIds.has(String(e.s)) || (e.sa != null && e.sd != null && e.sa !== e.sd));
      return {
        stopId: e.s,
        stopped: e.st,
        isReglering: isReg,
        actualArrival: formatTime(e.aa),
        actualDeparture: formatTime(e.ad),
        scheduledDeparture: formatTime(e.sd != null ? e.sd * 60 : null),
        scheduledArrival: formatTime(e.sa != null ? e.sa * 60 : null)
      };
    }));
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
      if (allPoints[i].ts - allPoints[i - 1].ts > 1.5 * 60 * 60 * 1000) {
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
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoffDateStr = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(cutoffDate);
    const cutoffTs = cutoffDate.getTime();

    // Asynchronously delete any legacy documents exceeding the 90-day retention window
    db.collection("stop_events").deleteMany({
      $or: [
        { d: { $lt: cutoffDateStr } },
        { ts: { $lt: cutoffTs } },
        { expireAt: { $lt: new Date() } }
      ]
    }).catch((err: any) => console.warn("Background history cleanup warning:", err?.message || err));

    const earliest = await db.collection("stop_events").find({ d: { $gte: cutoffDateStr } }, { projection: { d: 1 } }).sort({ d: 1 }).limit(1).toArray();
    if (!earliest.length || !earliest[0].d) return res.status(200).json({ days: 0 });
    const date = new Date(earliest[0].d);
    const diff = Math.max(0, new Date().getTime() - date.getTime());
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    const days = Math.min(90, Math.ceil(diff / (1000 * 3600 * 24)));
    res.status(200).json({ days });
  } catch (e: any) {
    console.error("Data range error:", e);
    handleDbError(e);
    res.status(200).json({ days: 0 });
  }
});

app.get("/api/stop", async (req, res) => {
  try {
    const { id } = req.query;
    if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing stop id" });
    const db = await getDb("sl-times");
    const stop = await db.collection("stops").findOne({ id: String(id) });
    if (!stop) return res.status(404).json({ error: "Stop not found" });
    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json(stop);
  } catch (e: any) {
    handleDbError(e);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/search", async (req, res) => {
  try {
    const { q, type, agency } = req.query;
    if (typeof q !== "string" || !q.trim()) return res.status(200).json([]);
    const db = await getDb("sl-times");
    const queryStr = q.trim();

    // A line query is either explicitly requested (type === "line")
    // or type is not "stop" AND query starts with digits or "linje"/"line"/"l "
    const isLineQuery = type === "line" || (
      type !== "stop" && (
        /^\d{1,3}[a-zA-Z]?$/i.test(queryStr) ||
        /^(linje|line|l)\s*([0-9a-zA-Z]+)?$/i.test(queryStr)
      )
    );

    if (type === "stop" || (!isLineQuery && type !== "line")) {
      // STOP SEARCH ONLY: Never return routes
      const escaped = queryStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let filter: any = { name: new RegExp(escaped, 'i') };
      if (agency && (agency === 'SL' || agency === 'WAAB')) {
        filter.agency = agency;
      }

      const rawStops = await db.collection("stops").find(filter).limit(80).toArray();

      // Deduplicate stops by name
      const seenNames = new Set<string>();
      const stops: any[] = [];
      for (const s of rawStops) {
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
        if (stops.length >= 25) break;
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

      return res.status(200).json(stops);
    } else {
      // LINE SEARCH ONLY: Never return stops or match endpoints
      const cleanLineQ = queryStr.replace(/^(linje|line|l)\s*/i, '').trim();
      const escaped = cleanLineQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      let baseFilter: any = {};
      if (agency && (agency === 'SL' || agency === 'WAAB')) {
        baseFilter.agency = agency;
      }

      // Try startsWith first (e.g. searching '4' gives lines starting with 4)
      let routes = await db.collection("routes")
        .find({ ...baseFilter, line: new RegExp(`^${escaped}`, 'i') })
        .limit(30)
        .toArray();

      if (routes.length === 0 && escaped.length > 0) {
        routes = await db.collection("routes")
          .find({ ...baseFilter, line: new RegExp(escaped, 'i') })
          .limit(30)
          .toArray();
      }

      // Sort lines numerically
      routes.sort((a, b) => {
        const numA = parseInt(a.line.replace(/\D/g, ''));
        const numB = parseInt(b.line.replace(/\D/g, ''));
        if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
          return numA - numB;
        }
        return a.line.localeCompare(b.line);
      });

      return res.status(200).json(routes.map(r => ({
        type: "line",
        id: r.id,
        title: `Linje ${r.line}`,
        subtitle: `${r.from} - ${r.to}`,
        agency: r.agency || 'SL'
      })));
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
    return res.status(200).json({ stops: stops.sort((a, b) => a.name.localeCompare(b.name)) });
  } catch (e: any) {
    handleDbError(e);
    res.status(200).json({ stops: [] });
  }
});

app.get("/api/line-route", async (req, res) => {
  try {
    const { routeId } = req.query;
    if (!routeId || typeof routeId !== "string") return res.status(400).json({ error: "Missing routeId" });
    const db = await getDb("sl-times");
    const route = await db.collection("routes").findOne({ id: routeId });
    const trips = await db.collection("trips").find({ routeId }).toArray();
    if (!trips.length) return res.status(404).json({ error: "Route not found" });

    trips.sort((a, b) => (b.stops?.length || 0) - (a.stops?.length || 0));
    const bestTrip = trips[0];

    const hasInterpolated = bestTrip.stops?.some((s: any) =>
      (s.arr && !s.arr.endsWith(':00')) || (s.dep && !s.dep.endsWith(':00'))
    );

    const stopIds = new Set<string>();
    trips.forEach(t => t.stops?.forEach((s: any) => stopIds.add(String(s.id))));
    const dbStops = await db.collection("stops").find({ id: { $in: Array.from(stopIds) } }).toArray();
    const stopDocMap = new Map(dbStops.map(s => [String(s.id), s]));

    const stops: any[] = [];
    bestTrip.stops?.forEach((st: any, idx: number) => {
      const sDoc = stopDocMap.get(String(st.id));
      if (sDoc) {
        const isTerminal = idx === 0 || idx === bestTrip.stops.length - 1;
        const isDwell = st.arr && st.dep && st.arr !== st.dep;
        const isTimepoint = hasInterpolated && (st.arr?.endsWith(':00') || st.dep?.endsWith(':00'));
        const isReg = isTerminal || isDwell || isTimepoint;

        stops.push({
          id: sDoc.id,
          name: sDoc.name,
          lat: sDoc.lat,
          lng: sDoc.lng,
          agency: route?.agency || 'SL',
          isReglering: isReg,
          scheduledArrival: st.arr,
          scheduledDeparture: st.dep
        });
      }
    });

    const lineData = {
      id: routeId,
      line: route?.line || bestTrip.routeId,
      agency: route?.agency || 'SL',
      path: stops.map(s => [s.lat, s.lng]),
      stops: stops
    };

    res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=86400, stale-while-revalidate=3600");
    return res.status(200).json(lineData);
  } catch (e: any) {
    handleDbError(e);
    res.status(500).json({ error: e.message });
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
      query.$or = [{ d: startDate, sdm: { $gte: startMin } }, { d: { $gt: startDate } }];
      sort = { d: 1, sdm: 1, _id: 1 };
    } else {
      query.$or = [{ d: startDate, sdm: { $lt: startMin } }, { d: { $lt: startDate } }];
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
  } catch (e: any) {
    handleDbError(e);
    res.status(200).json([]);
  }
});

export default app;
