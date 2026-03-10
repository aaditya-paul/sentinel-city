import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Grid config for Kolkata
const MIN_LAT = 22.52;
const MAX_LAT = 22.58;
const MIN_LNG = 88.33;
const MAX_LNG = 88.38;
const STEP = 0.001; // ~100m

// ── 1. WEATHER from Open-Meteo (FREE, no API key) ──────────────────────
async function fetchWeather(
  lat: number,
  lng: number,
): Promise<{ temperature: number; humidity: number }> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m`;
    const res = await fetch(url, { next: { revalidate: 600 } }); // cache 10 min
    const data = await res.json();
    return {
      temperature: data.current?.temperature_2m ?? 30,
      humidity: data.current?.relative_humidity_2m ?? 60,
    };
  } catch {
    return { temperature: 30, humidity: 60 };
  }
}

// Normalize temperature to 0-100 stress score
// Comfortable: 20-25°C → low stress. Below 10 or above 38 → high stress.
function normalizeTemperature(tempC: number): number {
  if (tempC >= 20 && tempC <= 25) return 10 + Math.random() * 10;
  if (tempC < 20) return Math.min(100, (25 - tempC) * 5);
  // Above 25
  return Math.min(100, 20 + (tempC - 25) * 5);
}

// ── 2. AIR QUALITY from WAQI (FREE tier, needs token) ─────────────────
// If no token, fall back to Open-Meteo air quality
async function fetchAQI(lat: number, lng: number): Promise<number> {
  const waqiToken = process.env.WAQI_API_TOKEN;

  if (waqiToken) {
    try {
      const url = `https://api.waqi.info/feed/geo:${lat};${lng}/?token=${waqiToken}`;
      const res = await fetch(url, { next: { revalidate: 600 } });
      const data = await res.json();
      if (data.status === "ok" && data.data?.aqi) {
        return Math.min(data.data.aqi, 500);
      }
    } catch {
      /* fallback below */
    }
  }

  // Fallback: Open-Meteo Air Quality API (free, no key)
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=pm2_5,pm10,nitrogen_dioxide`;
    const res = await fetch(url, { next: { revalidate: 600 } });
    const data = await res.json();
    const pm25 = data.current?.pm2_5 ?? 50;
    const pm10 = data.current?.pm10 ?? 60;
    // Simple AQI-like score from PM2.5
    return Math.min(300, Math.round(pm25 * 2));
  } catch {
    return 75; // Kolkata baseline average
  }
}

// Normalize AQI (0-500 scale) to 0-100 stress
function normalizeAQI(aqi: number): number {
  if (aqi <= 50) return (aqi / 50) * 25; // Good
  if (aqi <= 100) return 25 + ((aqi - 50) / 50) * 25; // Moderate
  if (aqi <= 200) return 50 + ((aqi - 100) / 100) * 25; // Unhealthy
  return Math.min(100, 75 + ((aqi - 200) / 300) * 25); // Very unhealthy+
}

// ── 3. ROAD DENSITY from OSM Overpass (FREE, no key) → Noise & Traffic ─
async function fetchRoadDensity(
  minLat: number,
  minLng: number,
  maxLat: number,
  maxLng: number,
): Promise<Map<string, { roadScore: number; poiScore: number }>> {
  const cellScores = new Map<string, { roadScore: number; poiScore: number }>();

  try {
    // Query: count road segments and POIs per grid area
    const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
    const query = `
      [out:json][timeout:30];
      (
        way["highway"~"primary|secondary|tertiary|trunk|motorway|residential"](${bbox});
      );
      out count;
    `;
    const roadRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const roadData = await roadRes.json();
    const totalRoads = roadData.elements?.[0]?.tags?.total ?? 0;

    // Query POIs (shops, restaurants, offices) for crowd estimation
    const poiQuery = `
      [out:json][timeout:30];
      (
        node["amenity"~"restaurant|cafe|bar|fast_food|bank|hospital|school|college|cinema|theatre"](${bbox});
        node["shop"](${bbox});
        node["office"](${bbox});
      );
      out count;
    `;
    const poiRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(poiQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const poiData = await poiRes.json();
    const totalPOIs = poiData.elements?.[0]?.tags?.total ?? 0;

    // We get region-level counts. Now fetch individual road ways to distribute per cell.
    const detailQuery = `
      [out:json][timeout:45];
      way["highway"~"primary|secondary|tertiary|trunk|motorway"](${bbox});
      out center;
    `;
    const detailRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(detailQuery)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const detailData = await detailRes.json();

    // Count roads per cell
    const roadCountPerCell = new Map<string, number>();
    for (const el of detailData.elements || []) {
      if (el.center) {
        const cellLat = Math.floor(el.center.lat / STEP) * STEP;
        const cellLng = Math.floor(el.center.lon / STEP) * STEP;
        const key = `${cellLat.toFixed(4)}_${cellLng.toFixed(4)}`;
        roadCountPerCell.set(key, (roadCountPerCell.get(key) || 0) + 1);
      }
    }

    // Fetch POI locations
    const poiDetailQuery = `
      [out:json][timeout:45];
      (
        node["amenity"~"restaurant|cafe|bar|fast_food|bank|hospital|school|college"](${bbox});
        node["shop"](${bbox});
      );
      out;
    `;
    const poiDetailRes = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        body: `data=${encodeURIComponent(poiDetailQuery)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );
    const poiDetailData = await poiDetailRes.json();

    const poiCountPerCell = new Map<string, number>();
    for (const el of poiDetailData.elements || []) {
      if (el.lat && el.lon) {
        const cellLat = Math.floor(el.lat / STEP) * STEP;
        const cellLng = Math.floor(el.lon / STEP) * STEP;
        const key = `${cellLat.toFixed(4)}_${cellLng.toFixed(4)}`;
        poiCountPerCell.set(key, (poiCountPerCell.get(key) || 0) + 1);
      }
    }

    // Normalize: find max values
    const maxRoads = Math.max(1, ...roadCountPerCell.values());
    const maxPOIs = Math.max(1, ...poiCountPerCell.values());

    // Build scores for each cell
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
  } catch (err) {
    console.error("Overpass API error:", err);
  }

  return cellScores;
}

// ── MAIN: Collect and calculate stress ──────────────────────────────────
export async function GET() {
  console.log("🔄 Starting real data collection...");
  const startTime = Date.now();

  try {
    // 1. Fetch weather (one call covers the whole area)
    const centerLat = (MIN_LAT + MAX_LAT) / 2;
    const centerLng = (MIN_LNG + MAX_LNG) / 2;
    const weather = await fetchWeather(centerLat, centerLng);
    const tempScore = normalizeTemperature(weather.temperature);
    console.log(
      `🌡️  Temperature: ${weather.temperature}°C → stress score: ${Math.round(tempScore)}`,
    );

    // 2. Fetch AQI (one call covers the area)
    const rawAQI = await fetchAQI(centerLat, centerLng);
    const aqiScore = normalizeAQI(rawAQI);
    console.log(`🌫️  AQI: ${rawAQI} → stress score: ${Math.round(aqiScore)}`);

    // 3. Fetch road + POI density per cell from OSM
    console.log("🗺️  Fetching road & POI density from OpenStreetMap...");
    const cellScores = await fetchRoadDensity(
      MIN_LAT,
      MIN_LNG,
      MAX_LAT,
      MAX_LNG,
    );
    console.log(`📊 Got density data for ${cellScores.size} cells`);

    // 4. Build grid rows
    const rows = [];
    for (let lat = MIN_LAT; lat <= MAX_LAT; lat += STEP) {
      for (let lng = MIN_LNG; lng <= MAX_LNG; lng += STEP) {
        const key = `${(Math.floor(lat / STEP) * STEP).toFixed(4)}_${(Math.floor(lng / STEP) * STEP).toFixed(4)}`;
        const density = cellScores.get(key) || { roadScore: 20, poiScore: 15 };

        // Noise: correlated with road density + some randomness
        const noise = Math.min(
          100,
          Math.max(0, density.roadScore * 0.85 + Math.random() * 15),
        );

        // Crowd: correlated with POI density
        const crowd = Math.min(
          100,
          Math.max(0, density.poiScore * 0.9 + Math.random() * 10),
        );

        // Traffic: correlated with road density (slightly different weighting)
        const traffic = Math.min(
          100,
          Math.max(0, density.roadScore * 0.75 + Math.random() * 20),
        );

        // Stress index
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

    // 5. Upsert into database
    await supabase.from("locations_grid").delete().neq("id", 0);
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await supabase.from("locations_grid").insert(chunk);
      if (error) throw error;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `✅ Real data collection complete: ${rows.length} cells in ${elapsed}s`,
    );

    return NextResponse.json({
      success: true,
      count: rows.length,
      elapsed_seconds: elapsed,
      sources: {
        temperature: `${weather.temperature}°C (Open-Meteo)`,
        aqi: `${rawAQI} (${process.env.WAQI_API_TOKEN ? "WAQI" : "Open-Meteo AQ"})`,
        road_density: "OpenStreetMap Overpass",
        poi_density: "OpenStreetMap Overpass",
      },
    });
  } catch (error: any) {
    console.error("❌ Data collection failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
