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

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Resolution options in meters → degrees (approximate)
const RESOLUTIONS: Record<string, number> = {
  "50": 0.0005,
  "100": 0.001,
  "200": 0.002,
  "400": 0.004,
  "800": 0.008,
};

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

function buildPopupHTML(p: any, lat: number, lng: number, resLabel: string) {
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
      <div style="border-top:1px solid #1e293b;padding-top:12px;display:grid;gap:8px;">${bars}</div>
      <div style="margin-top:12px;font-size:9px;color:#475569;text-align:center;">
        📍 ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E · ${resLabel}m × ${resLabel}m
      </div>
    </div>
  `;
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isRemovedRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cellCount, setCellCount] = useState(0);
  const [resolution, setResolution] = useState("200");

  const rectLayersRef = useRef<L.Rectangle[]>([]);
  const loadingRef = useRef(false);

  const clearRects = useCallback(() => {
    const map = mapInstanceRef.current;
    for (const rect of rectLayersRef.current) {
      try {
        if (map) map.removeLayer(rect);
      } catch {}
    }
    rectLayersRef.current = [];
  }, []);

  const loadStressData = useCallback(
    async (collectFresh: boolean, res?: string) => {
      const map = mapInstanceRef.current;
      if (!map || isRemovedRef.current || loadingRef.current) return;

      loadingRef.current = true;
      setIsRefreshing(true);

      const currentRes = res || resolution;
      const step = RESOLUTIONS[currentRes] || 0.002;

      try {
        // Get current map bounds
        const bounds = map.getBounds();
        const minLat = bounds.getSouth();
        const maxLat = bounds.getNorth();
        const minLng = bounds.getWest();
        const maxLng = bounds.getEast();

        if (collectFresh) {
          try {
            const collectUrl = `/api/collect-data?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&step=${step}`;
            const collectRes = await fetch(collectUrl);
            const collectData = await collectRes.json();
            if (collectData.error)
              console.error("Collection error:", collectData.error);
            else console.log("✅ Collected:", collectData);
          } catch (e) {
            console.warn("Collection failed, using cached data");
          }
        }

        // Fetch data for the visible area
        const url = `/api/stress-map?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`;
        const apiRes = await fetch(url);
        const geojson = await apiRes.json();

        if (geojson.error || isRemovedRef.current) {
          if (geojson.error) console.error("API error:", geojson.error);
          return;
        }

        const features = geojson.features || [];

        // Clear old
        clearRects();

        if (isRemovedRef.current || !mapInstanceRef.current) return;

        // Draw new
        const halfStep = step / 2;
        for (const f of features) {
          if (isRemovedRef.current) break;

          const lng = f.geometry.coordinates[0];
          const lat = f.geometry.coordinates[1];
          const p = f.properties;

          const color = getStressColor(p.stress_index);
          const opacity = getStressOpacity(p.stress_index);

          try {
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

            rect.bindPopup(() => buildPopupHTML(p, lat, lng, currentRes), {
              maxWidth: 320,
            });
            rect.on("mouseover", () =>
              rect.setStyle({
                weight: 1.5,
                color,
                fillOpacity: Math.min(opacity + 0.15, 0.85),
              }),
            );
            rect.on("mouseout", () =>
              rect.setStyle({
                weight: 0,
                color: "transparent",
                fillOpacity: opacity,
              }),
            );

            if (!isRemovedRef.current && mapInstanceRef.current) {
              rect.addTo(mapInstanceRef.current);
              rectLayersRef.current.push(rect);
            }
          } catch {}
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
        loadingRef.current = false;
        setIsRefreshing(false);
        setIsLoaded(true);
      }
    },
    [resolution, clearRects],
  );

  // Listen for manual refresh events
  useEffect(() => {
    const handler = () => loadStressData(true);
    window.addEventListener("refresh-stress-data", handler);
    return () => window.removeEventListener("refresh-stress-data", handler);
  }, [loadStressData]);

  // Listen for resolution changes from page
  useEffect(() => {
    const handler = (e: Event) => {
      const newRes = (e as CustomEvent).detail;
      setResolution(newRes);
      loadStressData(true, newRes);
    };
    window.addEventListener("change-resolution", handler);
    return () => window.removeEventListener("change-resolution", handler);
  }, [loadStressData]);

  // Init map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    isRemovedRef.current = false;

    const map = L.map(mapRef.current, {
      center: [22.55, 88.35],
      zoom: 12,
      zoomControl: true,
      preferCanvas: true, // Canvas renderer avoids DOM appendChild issues
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

    // Load data for initial view
    map.whenReady(() => {
      loadStressData(false);
    });

    // Auto-refresh every 5 minutes
    const interval = setInterval(() => {
      loadStressData(true);
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      isRemovedRef.current = true;
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
