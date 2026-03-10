"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";

// Fix default marker icon paths
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const CELL_SIZE = 0.002; // ~200m grid step in degrees
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function getStressColor(score: number): string {
  if (score <= 25) return lerpColor([34, 197, 94], [132, 204, 22], score / 25);
  if (score <= 50)
    return lerpColor([132, 204, 22], [234, 179, 8], (score - 25) / 25);
  if (score <= 75)
    return lerpColor([234, 179, 8], [249, 115, 22], (score - 50) / 25);
  return lerpColor([249, 115, 22], [220, 38, 38], (score - 75) / 25);
}

function lerpColor(a: number[], b: number[], t: number): string {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

function getStressLabel(score: number) {
  if (score >= 75) return "Chaotic";
  if (score >= 50) return "Stressful";
  if (score >= 25) return "Moderate";
  return "Calm";
}

function getStressOpacity(score: number): number {
  return 0.25 + (score / 100) * 0.45;
}

function buildPopupHTML(p: any, lat: number, lng: number) {
  const stressColor = getStressColor(p.stress_index);
  const signals = [
    ["🔊 Noise", p.noise_score],
    ["👥 Crowd", p.crowd_score],
    ["🌫️ AQI", p.aqi_score],
    ["🚗 Traffic", p.traffic_score],
    ["🌡️ Temp", p.temperature_score],
  ];
  const bars = signals
    .map(
      ([label, val]: any) => `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;">
      <span style="color:#94a3b8;">${label}</span>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:70px;height:4px;background:#1e293b;border-radius:2px;overflow:hidden;">
          <div style="width:${Math.round(val)}%;height:100%;background:${getStressColor(val)};border-radius:2px;"></div>
        </div>
        <span style="font-family:monospace;font-size:11px;color:#e0e6f0;min-width:22px;text-align:right;">${Math.round(val)}</span>
      </div>
    </div>
  `,
    )
    .join("");

  return `
    <div style="padding:16px;min-width:230px;font-family:inherit;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div>
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;margin-bottom:2px;">Stress Score</div>
          <div style="font-size:30px;font-weight:800;color:${stressColor};line-height:1;">${Math.round(p.stress_index)}</div>
        </div>
        <div style="background:${stressColor}18;color:${stressColor};padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid ${stressColor}30;">
          ${getStressLabel(p.stress_index)}
        </div>
      </div>
      <div style="border-top:1px solid #1e293b;padding-top:12px;display:grid;gap:8px;">
        ${bars}
      </div>
      <div style="margin-top:12px;font-size:9px;color:#475569;text-align:center;">
        � ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E · 200m × 200m
      </div>
    </div>
  `;
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cellCount, setCellCount] = useState(0);

  // Store all rectangle layers so we can remove them
  const rectLayersRef = useRef<L.Rectangle[]>([]);

  const loadStressData = useCallback(async (collectFresh: boolean) => {
    const map = mapInstanceRef.current;
    if (!map) return;

    setIsRefreshing(true);

    try {
      if (collectFresh) {
        try {
          const collectRes = await fetch("/api/collect-data");
          const collectData = await collectRes.json();
          if (collectData.error)
            console.error("Data collection error:", collectData.error);
          else console.log("✅ Fresh data collected:", collectData);
        } catch (e) {
          console.warn("Data collection failed, using cached data");
        }
      }

      const res = await fetch("/api/stress-map");
      const geojson = await res.json();

      if (geojson.error) {
        console.error("API error:", geojson.error);
        setIsRefreshing(false);
        setIsLoaded(true);
        return;
      }

      const features = geojson.features || [];

      // Safety: check map is still valid
      if (!mapInstanceRef.current) return;

      // Remove old rectangles
      for (const rect of rectLayersRef.current) {
        try {
          map.removeLayer(rect);
        } catch {}
      }
      rectLayersRef.current = [];

      // Draw new rectangles
      for (const f of features) {
        const lng = f.geometry.coordinates[0];
        const lat = f.geometry.coordinates[1];
        const p = f.properties;
        const halfStep = CELL_SIZE / 2;

        const color = getStressColor(p.stress_index);
        const opacity = getStressOpacity(p.stress_index);

        const rect = L.rectangle(
          [
            [lat - halfStep, lng - halfStep],
            [lat + halfStep, lng + halfStep],
          ],
          {
            color: "transparent",
            weight: 0,
            fillColor: color,
            fillOpacity: opacity,
            interactive: true,
          },
        );

        rect.bindPopup(() => buildPopupHTML(p, lat, lng), { maxWidth: 320 });

        rect.on("mouseover", () => {
          rect.setStyle({
            weight: 1.5,
            color,
            fillOpacity: Math.min(opacity + 0.15, 0.85),
          });
        });
        rect.on("mouseout", () => {
          rect.setStyle({
            weight: 0,
            color: "transparent",
            fillOpacity: opacity,
          });
        });

        rect.addTo(map);
        rectLayersRef.current.push(rect);
      }

      setCellCount(features.length);
      setLastUpdated(
        new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch (err) {
      console.error("Failed to load stress data:", err);
    } finally {
      setIsRefreshing(false);
      setIsLoaded(true);
    }
  }, []);

  // Listen for manual refresh events
  useEffect(() => {
    const handler = () => loadStressData(true);
    window.addEventListener("refresh-stress-data", handler);
    return () => window.removeEventListener("refresh-stress-data", handler);
  }, [loadStressData]);

  // Init map + auto-refresh
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [22.55, 88.35],
      zoom: 12,
      zoomControl: true,
    });

    mapInstanceRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
        subdomains: "abcd",
      },
    ).addTo(map);

    // Load existing data from DB first (fast)
    loadStressData(false);

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      loadStressData(true);
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      rectLayersRef.current = [];
      mapInstanceRef.current = null;
      map.remove();
    };
  }, [loadStressData]);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden glow-border">
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07090e] z-30">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            <span className="text-sm text-zinc-500 tracking-wide">
              Initializing stress grid...
            </span>
          </div>
        </div>
      )}

      {isRefreshing && isLoaded && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="text-xs text-zinc-400">Refreshing data...</span>
        </div>
      )}

      {isLoaded && lastUpdated && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg text-xs text-zinc-500">
          <span>{cellCount.toLocaleString()} cells</span>
          <span className="text-zinc-700">·</span>
          <span>Updated {lastUpdated}</span>
        </div>
      )}
    </div>
  );
}
