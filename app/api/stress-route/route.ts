import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

// Use OSRM public demo for routing (free, no API key)
const OSRM_BASE = "https://router.project-osrm.org";

interface RouteResult {
  name: string;
  distance_km: number;
  duration_min: number;
  stress_score: number;
  stress_label: string;
  coordinates: [number, number][];
  color: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const startLat = parseFloat(searchParams.get("startLat") || "0");
  const startLng = parseFloat(searchParams.get("startLng") || "0");
  const endLat = parseFloat(searchParams.get("endLat") || "0");
  const endLng = parseFloat(searchParams.get("endLng") || "0");

  if (!startLat || !startLng || !endLat || !endLng) {
    return NextResponse.json(
      {
        error: "Missing coordinates. Use ?startLat=&startLng=&endLat=&endLng=",
      },
      { status: 400 },
    );
  }

  try {
    // 1. Get routes from OSRM (request alternatives)
    const osrmUrl = `${OSRM_BASE}/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?alternatives=3&overview=full&geometries=geojson&steps=false`;
    const osrmRes = await fetch(osrmUrl);
    const osrmData = await osrmRes.json();

    if (osrmData.code !== "Ok" || !osrmData.routes?.length) {
      return NextResponse.json(
        {
          error:
            "No routes found. OSRM returned: " +
            (osrmData.message || osrmData.code),
        },
        { status: 404 },
      );
    }

    // 2. For each route, calculate stress by sampling waypoints
    const routes: RouteResult[] = [];

    for (let i = 0; i < osrmData.routes.length; i++) {
      const route = osrmData.routes[i];
      const coords: [number, number][] = route.geometry.coordinates; // [lng, lat]

      // Sample waypoints along the route (every ~10th point, max 50 samples)
      const sampleInterval = Math.max(1, Math.floor(coords.length / 50));
      const samples: { lat: number; lng: number }[] = [];
      for (let j = 0; j < coords.length; j += sampleInterval) {
        samples.push({ lat: coords[j][1], lng: coords[j][0] });
      }

      // Query stress grid near each sample point
      let totalStress = 0;
      let stressCount = 0;

      for (const sample of samples) {
        const { data } = await supabase
          .from("locations_grid")
          .select("stress_index")
          .gte("latitude", sample.lat - 0.003)
          .lte("latitude", sample.lat + 0.003)
          .gte("longitude", sample.lng - 0.003)
          .lte("longitude", sample.lng + 0.003)
          .limit(5);

        if (data && data.length > 0) {
          const avgStress =
            data.reduce((sum: number, d: any) => sum + d.stress_index, 0) /
            data.length;
          totalStress += avgStress;
          stressCount++;
        }
      }

      const avgRouteStress = stressCount > 0 ? totalStress / stressCount : 50;
      const stressLabel =
        avgRouteStress >= 75
          ? "Chaotic"
          : avgRouteStress >= 50
            ? "Stressful"
            : avgRouteStress >= 25
              ? "Moderate"
              : "Calm";

      routes.push({
        name: i === 0 ? "Fastest Route" : `Alternative ${i}`,
        distance_km: parseFloat((route.distance / 1000).toFixed(1)),
        duration_min: parseFloat((route.duration / 60).toFixed(1)),
        stress_score: Math.round(avgRouteStress),
        stress_label: stressLabel,
        coordinates: coords,
        color: "", // will be assigned below
      });
    }

    // 3. Sort: lowest stress = calmest
    routes.sort((a, b) => a.stress_score - b.stress_score);

    // Label the calmest and assign colors
    if (routes.length > 0) {
      routes[0].name = "🟢 Calmest Route";
      routes[0].color = "#22c55e";
    }
    if (routes.length > 1) {
      // Find the fastest (shortest duration)
      const fastestIdx = routes.reduce(
        (minI, r, i, arr) =>
          r.duration_min < arr[minI].duration_min ? i : minI,
        0,
      );
      if (fastestIdx !== 0) {
        routes[fastestIdx].name = "⚡ Fastest Route";
        routes[fastestIdx].color = "#3b82f6";
      }
      // Color remaining routes
      const altColors = ["#f97316", "#eab308", "#8b5cf6"];
      let colorIdx = 0;
      for (let i = 0; i < routes.length; i++) {
        if (!routes[i].color) {
          routes[i].color = altColors[colorIdx % altColors.length];
          routes[i].name = `Route ${i + 1}`;
          colorIdx++;
        }
      }
    }

    return NextResponse.json({ routes });
  } catch (error: any) {
    console.error("Route error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
