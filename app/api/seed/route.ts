import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "";

const supabase = createClient(supabaseUrl, supabaseKey);

const MIN_LAT = 22.52;
const MAX_LAT = 22.58;
const MIN_LNG = 88.33;
const MAX_LNG = 88.38;
const STEP = 0.002; // ~200m

// Known busy/stressful areas in Kolkata (lat, lng, intensity 0-1)
const HOTSPOTS = [
  {
    lat: 22.5726,
    lng: 88.3639,
    intensity: 0.9,
    radius: 0.012,
    name: "Park Street / Esplanade",
  },
  {
    lat: 22.5645,
    lng: 88.3433,
    intensity: 0.85,
    radius: 0.008,
    name: "Howrah Bridge / Station",
  },
  {
    lat: 22.535,
    lng: 88.342,
    intensity: 0.75,
    radius: 0.01,
    name: "Kalighat / Hazra",
  },
  {
    lat: 22.555,
    lng: 88.351,
    intensity: 0.8,
    radius: 0.007,
    name: "College Street",
  },
  {
    lat: 22.548,
    lng: 88.363,
    intensity: 0.7,
    radius: 0.008,
    name: "Gariahat / Ballygunge",
  },
  {
    lat: 22.575,
    lng: 88.37,
    intensity: 0.65,
    radius: 0.006,
    name: "Sealdah Station",
  },
  {
    lat: 22.54,
    lng: 88.355,
    intensity: 0.5,
    radius: 0.006,
    name: "Bhawanipore",
  },
];

// Known calm areas (parks, lakes)
const CALM_ZONES = [
  {
    lat: 22.547,
    lng: 88.337,
    intensity: 0.15,
    radius: 0.006,
    name: "Rabindra Sarobar",
  },
  {
    lat: 22.565,
    lng: 88.351,
    intensity: 0.2,
    radius: 0.01,
    name: "Maidan / Victoria Memorial",
  },
  {
    lat: 22.53,
    lng: 88.36,
    intensity: 0.25,
    radius: 0.005,
    name: "Southern Avenue area",
  },
];

function distanceBetween(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  return Math.sqrt((lat1 - lat2) ** 2 + (lng1 - lng2) ** 2);
}

function generateRealisticScores(lat: number, lng: number) {
  // Base: moderate urban levels
  let baseDensity = 35 + Math.random() * 15;

  // Apply hotspot influence
  for (const hs of HOTSPOTS) {
    const dist = distanceBetween(lat, lng, hs.lat, hs.lng);
    if (dist < hs.radius) {
      const influence = (1 - dist / hs.radius) * hs.intensity;
      baseDensity += influence * 55;
    }
  }

  // Apply calm zone influence
  for (const cz of CALM_ZONES) {
    const dist = distanceBetween(lat, lng, cz.lat, cz.lng);
    if (dist < cz.radius) {
      const influence = (1 - dist / cz.radius) * (1 - cz.intensity);
      baseDensity -= influence * 40;
    }
  }

  // Clamp
  baseDensity = Math.max(5, Math.min(95, baseDensity));

  // Generate individual scores with correlation to baseDensity
  const jitter = () => (Math.random() - 0.5) * 20;
  const noise = Math.min(100, Math.max(0, baseDensity * 1.1 + jitter()));
  const crowd = Math.min(100, Math.max(0, baseDensity * 0.95 + jitter()));
  const aqi = Math.min(100, Math.max(0, baseDensity * 0.85 + jitter()));
  const temp = Math.min(100, Math.max(0, 55 + baseDensity * 0.35 + jitter()));
  const traffic = Math.min(100, Math.max(0, baseDensity * 0.9 + jitter()));

  const stress_index = Math.min(
    100,
    Math.max(
      0,
      0.3 * noise + 0.25 * crowd + 0.2 * aqi + 0.15 * temp + 0.1 * traffic,
    ),
  );

  return { noise, crowd, aqi, temp, traffic, stress_index };
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Seed route disabled in production" },
      { status: 403 },
    );
  }

  const rows = [];

  for (let lat = MIN_LAT; lat <= MAX_LAT; lat += STEP) {
    for (let lng = MIN_LNG; lng <= MAX_LNG; lng += STEP) {
      const scores = generateRealisticScores(lat, lng);
      rows.push({
        latitude: lat,
        longitude: lng,
        stress_index: scores.stress_index,
        noise_score: scores.noise,
        crowd_score: scores.crowd,
        aqi_score: scores.aqi,
        temperature_score: scores.temp,
        traffic_score: scores.traffic,
      });
    }
  }

  try {
    await supabase.from("locations_grid").delete().neq("id", 0);

    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      const { error } = await supabase.from("locations_grid").insert(chunk);
      if (error) throw error;
    }

    return NextResponse.json({ success: true, count: rows.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
