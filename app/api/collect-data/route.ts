import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Grid config — Greater Kolkata coverage
const MIN_LAT = 22.45;
const MAX_LAT = 22.65;
const MIN_LNG = 88.28;
const MAX_LNG = 88.42;
const STEP = 0.002; // ~200m grid

// ── Safe JSON parser for Overpass ───────────────────────────────────────
async function safeJsonParse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // Overpass returns XML on error/overload
    console.warn(
      "Overpass returned non-JSON (likely overloaded):",
      text.substring(0, 200),
    );
    return { elements: [] };
  }
}

// ── 1. WEATHER from Open-Meteo (FREE, no API key) ──────────────────────
async function fetchWeather(lat: number, lng: number) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      temperature: data.current?.temperature_2m ?? 30,
      humidity: data.current?.relative_humidity_2m ?? 60,
    };
  } catch {
    return { temperature: 30, humidity: 60 };
  }
}

function normalizeTemperature(tempC: number): number {
  if (tempC >= 20 && tempC <= 25) return 10 + Math.random() * 10;
  if (tempC < 20) return Math.min(100, (25 - tempC) * 5);
  return Math.min(100, 20 + (tempC - 25) * 5);
}

// ── 2. AIR QUALITY ─────────────────────────────────────────────────────
async function fetchAQI(lat: number, lng: number): Promise<number> {
  const waqiToken = process.env.WAQI_API_TOKEN;
  if (waqiToken) {
    try {
      const url = `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${waqiToken}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status === "ok" && data.data?.aqi)
        return Math.min(data.data.aqi, 500);
    } catch {}
  }
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,pm10`;
    const res = await fetch(url);
    const data = await res.json();
    const pm25 = data.current?.pm2_5 ?? 50;
    return Math.min(300, Math.round(pm25 * 2));
  } catch {
    return 75;
  }
}

function normalizeAQI(aqi: number): number {
  if (aqi <= 50) return (aqi / 50) * 25;
  if (aqi <= 100) return 25 + ((aqi - 50) / 50) * 25;
  if (aqi <= 200) return 50 + ((aqi - 100) / 100) * 25;
  return Math.min(100, 75 + ((aqi - 200) / 300) * 25);
}

// ── 3. ROAD + POI DENSITY from OSM Overpass ────────────────────────────
async function fetchRoadDensity(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<Map<string, { roadScore: number; poiScore: number }>> {
  const cellScores = new Map<string, { roadScore: number; poiScore: number }>();
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;

  const roadCountPerCell = new Map<string, number>();
  const poiCountPerCell = new Map<string, number>();

  try {
    // Fetch road centers
    const roadQuery = `[out:json][timeout:60];way["highway"~"primary|secondary|tertiary|trunk|motorway"](${bbox});out center;`;
    const roadRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(roadQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const roadData = await safeJsonParse(roadRes);

    for (const el of roadData.elements || []) {
      if (el.center) {
        const cellLat = Math.floor(el.center.lat / STEP) * STEP;
        const cellLng = Math.floor(el.center.lon / STEP) * STEP;
        const key = `${cellLat.toFixed(4)}_${cellLng.toFixed(4)}`;
        roadCountPerCell.set(key, (roadCountPerCell.get(key) || 0) + 1);
      }
    }
    console.log(`🛣️  Roads mapped: ${roadData.elements?.length ?? 0} ways`);
  } catch (err) {
    console.warn("Road density fetch failed:", err);
  }

  // Small delay to avoid Overpass rate limiting
  await new Promise((r) => setTimeout(r, 2000));

  try {
    // Fetch POI nodes
    const poiQuery = `[out:json][timeout:60];(node["amenity"~"restaurant|cafe|bar|fast_food|bank|hospital|school|college"](${bbox});node["shop"](${bbox}););out;`;
    const poiRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(poiQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const poiData = await safeJsonParse(poiRes);

    for (const el of poiData.elements || []) {
      if (el.lat && el.lon) {
        const cellLat = Math.floor(el.lat / STEP) * STEP;
        const cellLng = Math.floor(el.lon / STEP) * STEP;
        const key = `${cellLat.toFixed(4)}_${cellLng.toFixed(4)}`;
        poiCountPerCell.set(key, (poiCountPerCell.get(key) || 0) + 1);
      }
    }
    console.log(`📍 POIs mapped: ${poiData.elements?.length ?? 0} nodes`);
  } catch (err) {
    console.warn("POI density fetch failed:", err);
  }

  // Normalize
  const maxRoads = Math.max(1, ...[...roadCountPerCell.values(), 1]);
  const maxPOIs = Math.max(1, ...[...poiCountPerCell.values(), 1]);

  for (let lat = MIN_LAT; lat <= MAX_LAT; lat += STEP) {
    for (let lng = MIN_LNG; lng <= MAX_LNG; lng += STEP) {
      const key = `${(Math.floor(lat / STEP) * STEP).toFixed(4)}_${(Math.floor(lng / STEP) * STEP).toFixed(4)}`;
      const roads = roadCountPerCell.get(key) || 0;
      const pois = poiCountPerCell.get(key) || 0;
      cellScores.set(key, {
        roadScore: Math.min(100, (roads / maxRoads) * 100),
        poiScore: Math.min(100, (pois / maxPOIs) * 100),
      });
    }
  }

  return cellScores;
}

// ── MAIN ────────────────────────────────────────────────────────────────
export async function GET() {
  console.log("🔄 Starting real data collection...");
  const startTime = Date.now();

  try {
    const centerLat = (MIN_LAT + MAX_LAT) / 2;
    const centerLng = (MIN_LNG + MAX_LNG) / 2;

    // 1. Weather
    const weather = await fetchWeather(centerLat, centerLng);
    const tempScore = normalizeTemperature(weather.temperature);
    console.log(
      `🌡️  Temperature: ${weather.temperature}°C → score: ${Math.round(tempScore)}`,
    );

    // 2. AQI
    const rawAQI = await fetchAQI(centerLat, centerLng);
    const aqiScore = normalizeAQI(rawAQI);
    console.log(`🌫️  AQI: ${rawAQI} → score: ${Math.round(aqiScore)}`);

    // 3. Road + POI density
    console.log("🗺️  Fetching road & POI density from OpenStreetMap...");
    const cellScores = await fetchRoadDensity(
      MIN_LAT,
      MIN_LNG,
      MAX_LAT,
      MAX_LNG,
    );
    console.log(`📊 Density data for ${cellScores.size} cells`);

    // 4. Build grid
    const rows = [];
    for (let lat = MIN_LAT; lat <= MAX_LAT; lat += STEP) {
      for (let lng = MIN_LNG; lng <= MAX_LNG; lng += STEP) {
        const key = `${(Math.floor(lat / STEP) * STEP).toFixed(4)}_${(Math.floor(lng / STEP) * STEP).toFixed(4)}`;
        const density = cellScores.get(key) || { roadScore: 15, poiScore: 10 };

        const noise = Math.min(
          100,
          Math.max(0, density.roadScore * 0.85 + Math.random() * 15),
        );
        const crowd = Math.min(
          100,
          Math.max(0, density.poiScore * 0.9 + Math.random() * 10),
        );
        const traffic = Math.min(
          100,
          Math.max(0, density.roadScore * 0.75 + Math.random() * 20),
        );

        const stress_index = Math.min(
          100,
          Math.max(
            0,
            0.3 * noise +
              0.25 * crowd +
              0.2 * aqiScore +
              0.15 * tempScore +
              0.1 * traffic,
          ),
        );

        rows.push({
          latitude: lat,
          longitude: lng,
          stress_index,
          noise_score: noise,
          crowd_score: crowd,
          aqi_score: aqiScore,
          temperature_score: tempScore,
          traffic_score: traffic,
        });
      }
    }

    // 5. Insert
    await supabase.from("locations_grid").delete().neq("id", 0);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await supabase.from("locations_grid").insert(chunk);
      if (error) throw error;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Done: ${rows.length} cells in ${elapsed}s`);

    return NextResponse.json({
      success: true,
      count: rows.length,
      elapsed_seconds: elapsed,
      sources: {
        temperature: `${weather.temperature}°C (Open-Meteo)`,
        aqi: `${rawAQI} (${process.env.WAQI_API_TOKEN ? "WAQI" : "Open-Meteo AQ"})`,
        road_density: "OSM Overpass",
        poi_density: "OSM Overpass",
      },
    });
  } catch (error: any) {
    console.error("❌ Data collection failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
