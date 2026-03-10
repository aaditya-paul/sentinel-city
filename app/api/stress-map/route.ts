import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const minLat = searchParams.get("minLat");
  const maxLat = searchParams.get("maxLat");
  const minLng = searchParams.get("minLng");
  const maxLng = searchParams.get("maxLng");

  try {
    // Paginate to fetch ALL rows (Supabase default limit is 1000)
    const allData: any[] = [];
    const PAGE_SIZE = 1000;
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      let query = supabase.from("locations_grid").select("*");

      if (minLat && maxLat && minLng && maxLng) {
        query = query
          .gte("latitude", parseFloat(minLat))
          .lte("latitude", parseFloat(maxLat))
          .gte("longitude", parseFloat(minLng))
          .lte("longitude", parseFloat(maxLng));
      }

      const { data, error } = await query
        .range(from, from + PAGE_SIZE - 1)
        .order("id", { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        allData.push(...data);
        from += PAGE_SIZE;
        if (data.length < PAGE_SIZE) hasMore = false;
      } else {
        hasMore = false;
      }
    }

    const geoJson = {
      type: "FeatureCollection",
      features: allData.map((point) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [point.longitude, point.latitude],
        },
        properties: {
          stress_index: point.stress_index,
          noise_score: point.noise_score,
          crowd_score: point.crowd_score,
          aqi_score: point.aqi_score,
          temperature_score: point.temperature_score,
          traffic_score: point.traffic_score,
        },
      })),
    };

    return NextResponse.json(geoJson);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
