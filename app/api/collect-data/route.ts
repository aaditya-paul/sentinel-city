import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Defaults (Greater Kolkata)
const DEFAULT_MIN_LAT = 22.45;
const DEFAULT_MAX_LAT = 22.65;
const DEFAULT_MIN_LNG = 88.28;
const DEFAULT_MAX_LNG = 88.42;
const DEFAULT_STEP = 0.002;
const MAX_CELLS = 10000; // Safety cap

async function safeJsonParse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn("Overpass non-JSON response:", text.substring(0, 100));
    return { elements: [] };
  }
}

async function fetchWeather(lat: number, lng: number) {
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m`,
    );
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

async function fetchAQI(lat: number, lng: number): Promise<number> {
  const waqiToken = process.env.WAQI_API_TOKEN;
  if (waqiToken) {
    try {
      const res = await fetch(
        `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${waqiToken}`,
      );
      const data = await res.json();
      if (data.status === "ok" && data.data?.aqi)
        return Math.min(data.data.aqi, 500);
    } catch {}
  }
  try {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5`,
    );
    const data = await res.json();
    return Math.min(300, Math.round((data.current?.pm2_5 ?? 50) * 2));
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

async function fetchRoadDensity(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
  step: number,
): Promise<Map<string, { roadScore: number; poiScore: number }>> {
  const cellScores = new Map<string, { roadScore: number; poiScore: number }>();
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  const roadCountPerCell = new Map<string, number>();
  const poiCountPerCell = new Map<string, number>();

  try {
    const roadQuery = `[out:json][timeout:60];way["highway"~"primary|secondary|tertiary|trunk|motorway"](${bbox});out center;`;
    const roadRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(roadQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const roadData = await safeJsonParse(roadRes);
    for (const el of roadData.elements || []) {
      if (el.center) {
        const key = `${(Math.floor(el.center.lat / step) * step).toFixed(4)}_${(Math.floor(el.center.lon / step) * step).toFixed(4)}`;
        roadCountPerCell.set(key, (roadCountPerCell.get(key) || 0) + 1);
      }
    }
    console.log(`🛣️  ${roadData.elements?.length ?? 0} roads`);
  } catch (err) {
    console.warn("Road fetch failed:", err);
  }

  await new Promise((r) => setTimeout(r, 2000));

  try {
    const poiQuery = `[out:json][timeout:60];(node["amenity"~"restaurant|cafe|bar|fast_food|bank|hospital|school|college"](${bbox});node["shop"](${bbox}););out;`;
    const poiRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(poiQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const poiData = await safeJsonParse(poiRes);
    for (const el of poiData.elements || []) {
      if (el.lat && el.lon) {
        const key = `${(Math.floor(el.lat / step) * step).toFixed(4)}_${(Math.floor(el.lon / step) * step).toFixed(4)}`;
        poiCountPerCell.set(key, (poiCountPerCell.get(key) || 0) + 1);
      }
    }
    console.log(`📍 ${poiData.elements?.length ?? 0} POIs`);
  } catch (err) {
    console.warn("POI fetch failed:", err);
  }

  const maxRoads = Math.max(1, ...[...roadCountPerCell.values(), 1]);
  const maxPOIs = Math.max(1, ...[...poiCountPerCell.values(), 1]);

  for (let lat = minLat; lat <= maxLat; lat += step) {
    for (let lng = minLng; lng <= maxLng; lng += step) {
      const key = `${(Math.floor(lat / step) * step).toFixed(4)}_${(Math.floor(lng / step) * step).toFixed(4)}`;
      cellScores.set(key, {
        roadScore: Math.min(
          100,
          ((roadCountPerCell.get(key) || 0) / maxRoads) * 100,
        ),
        poiScore: Math.min(
          100,
          ((poiCountPerCell.get(key) || 0) / maxPOIs) * 100,
        ),
      });
    }
  }

  return cellScores;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minLat = parseFloat(
    searchParams.get("minLat") || String(DEFAULT_MIN_LAT),
  );
  const maxLat = parseFloat(
    searchParams.get("maxLat") || String(DEFAULT_MAX_LAT),
  );
  const minLng = parseFloat(
    searchParams.get("minLng") || String(DEFAULT_MIN_LNG),
  );
  const maxLng = parseFloat(
    searchParams.get("maxLng") || String(DEFAULT_MAX_LNG),
  );
  const step = parseFloat(searchParams.get("step") || String(DEFAULT_STEP));

  // Estimate cell count and cap
  const latCells = Math.ceil((maxLat - minLat) / step);
  const lngCells = Math.ceil((maxLng - minLng) / step);
  const estimatedCells = latCells * lngCells;

  if (estimatedCells > MAX_CELLS) {
    return NextResponse.json(
      {
        error: `Too many cells (${estimatedCells}). Max ${MAX_CELLS}. Increase grid size or zoom in.`,
      },
      { status: 400 },
    );
  }

  console.log(
    `🔄 Collecting data: ${minLat.toFixed(3)}-${maxLat.toFixed(3)}°N, ${minLng.toFixed(3)}-${maxLng.toFixed(3)}°E, step=${step}, ~${estimatedCells} cells`,
  );
  const startTime = Date.now();

  try {
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;

    const weather = await fetchWeather(centerLat, centerLng);
    const tempScore = normalizeTemperature(weather.temperature);
    const rawAQI = await fetchAQI(centerLat, centerLng);
    const aqiScore = normalizeAQI(rawAQI);

    console.log(`🌡️ ${weather.temperature}°C  🌫️ AQI: ${rawAQI}`);

    const cellScores = await fetchRoadDensity(
      minLat,
      minLng,
      maxLat,
      maxLng,
      step,
    );

    const rows = [];
    for (let lat = minLat; lat <= maxLat; lat += step) {
      for (let lng = minLng; lng <= maxLng; lng += step) {
        const key = `${(Math.floor(lat / step) * step).toFixed(4)}_${(Math.floor(lng / step) * step).toFixed(4)}`;
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

    // Delete old data in this bounds region, then insert new
    await supabase
      .from("locations_grid")
      .delete()
      .gte("latitude", minLat - step)
      .lte("latitude", maxLat + step)
      .gte("longitude", minLng - step)
      .lte("longitude", maxLng + step);

    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await supabase
        .from("locations_grid")
        .insert(rows.slice(i, i + 1000));
      if (error) throw error;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ ${rows.length} cells in ${elapsed}s`);

    return NextResponse.json({
      success: true,
      count: rows.length,
      elapsed_seconds: elapsed,
      sources: {
        temperature: `${weather.temperature}°C`,
        aqi: `${rawAQI}`,
        road_density: "OSM Overpass",
        poi_density: "OSM Overpass",
      },
    });
  } catch (error: any) {
    console.error("❌ Failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
