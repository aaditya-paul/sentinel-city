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

const CELL_SIZE = 0.001; // ~100m grid step in degrees
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

function getStressColor(score: number): string {
  if (score <= 25) {
    const t = score / 25;
    return lerpColor([34, 197, 94], [132, 204, 22], t);
  } else if (score <= 50) {
    const t = (score - 25) / 25;
    return lerpColor([132, 204, 22], [234, 179, 8], t);
  } else if (score <= 75) {
    const t = (score - 50) / 25;
    return lerpColor([234, 179, 8], [249, 115, 22], t);
  } else {
    const t = (score - 75) / 25;
    return lerpColor([249, 115, 22], [220, 38, 38], t);
  }
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

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cellCount, setCellCount] = useState(0);

  const loadStressData = useCallback(
    async (map: L.Map, collectFresh: boolean) => {
      setIsRefreshing(true);

      try {
        // Optionally collect fresh data from real APIs first
        if (collectFresh) {
          const collectRes = await fetch("/api/collect-data");
          const collectData = await collectRes.json();
          if (collectData.error) {
            console.error("Data collection error:", collectData.error);
          } else {
            console.log("✅ Fresh data collected:", collectData);
          }
        }

        // Then fetch the grid data
        const res = await fetch("/api/stress-map");
        const geojson = await res.json();

        if (geojson.error) {
          console.error("API error:", geojson.error);
          return;
        }

        const features = geojson.features || [];

        // Clear existing grid layer
        if (gridLayerRef.current) {
          gridLayerRef.current.clearLayers();
        } else {
          gridLayerRef.current = L.layerGroup().addTo(map);
        }

        // Render grid cells
        features.forEach((f: any) => {
          const lng = f.geometry.coordinates[0];
          const lat = f.geometry.coordinates[1];
          const p = f.properties;
          const halfStep = CELL_SIZE / 2;

          const bounds: L.LatLngBoundsExpression = [
            [lat - halfStep, lng - halfStep],
            [lat + halfStep, lng + halfStep],
          ];

          const color = getStressColor(p.stress_index);
          const opacity = getStressOpacity(p.stress_index);

          const rect = L.rectangle(bounds, {
            color: "transparent",
            weight: 0,
            fillColor: color,
            fillOpacity: opacity,
            interactive: true,
          });

          rect.bindPopup(
            () => {
              const stressColor = getStressColor(p.stress_index);
              return `
            <div style="padding: 16px; min-width: 230px; font-family: inherit;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                <div>
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #64748b; margin-bottom: 2px;">Stress Score</div>
                  <div style="font-size: 30px; font-weight: 800; color: ${stressColor}; line-height: 1;">${Math.round(p.stress_index)}</div>
                </div>
                <div style="background: ${stressColor}18; color: ${stressColor}; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid ${stressColor}30;">
                  ${getStressLabel(p.stress_index)}
                </div>
              </div>
              <div style="border-top: 1px solid #1e293b; padding-top: 12px; display: grid; gap: 8px;">
                ${[
                  ["🔊 Noise", p.noise_score],
                  ["👥 Crowd", p.crowd_score],
                  ["🌫️ AQI", p.aqi_score],
                  ["🚗 Traffic", p.traffic_score],
                  ["🌡️ Temp", p.temperature_score],
                ]
                  .map(
                    ([label, val]: any) => `
                  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px;">
                    <span style="color: #94a3b8;">${label}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <div style="width: 70px; height: 4px; background: #1e293b; border-radius: 2px; overflow: hidden;">
                        <div style="width: ${Math.round(val as number)}%; height: 100%; background: ${getStressColor(val as number)}; border-radius: 2px;"></div>
                      </div>
                      <span style="font-family: monospace; font-size: 11px; color: #e0e6f0; min-width: 22px; text-align: right;">${Math.round(val as number)}</span>
                    </div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
              <div style="margin-top: 12px; font-size: 9px; color: #475569; text-align: center; letter-spacing: 0.5px;">
                📍 ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E · Grid 100m × 100m
              </div>
            </div>
          `;
            },
            { maxWidth: 320 },
          );

          rect.on("mouseover", function () {
            rect.setStyle({
              weight: 1.5,
              color: color,
              fillOpacity: Math.min(opacity + 0.15, 0.85),
            });
          });

          rect.on("mouseout", function () {
            rect.setStyle({
              weight: 0,
              color: "transparent",
              fillOpacity: opacity,
            });
          });

          gridLayerRef.current!.addLayer(rect);
        });

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
    },
    [],
  );

  // Manual refresh handler (exposed via custom event)
  useEffect(() => {
    const handler = () => {
      if (mapInstanceRef.current) {
        loadStressData(mapInstanceRef.current, true);
      }
    };
    window.addEventListener("refresh-stress-data", handler);
    return () => window.removeEventListener("refresh-stress-data", handler);
  }, [loadStressData]);

  // Init map + auto-refresh
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center: [22.5526, 88.35],
      zoom: 13,
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

    // Initial data load (just fetch cached, don't re-collect)
    loadStressData(map, false);

    // Auto-refresh every 5 minutes (collects fresh data)
    const interval = setInterval(() => {
      loadStressData(map, true);
    }, REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [loadStressData]);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden glow-border">
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Loading overlay */}
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

      {/* Refreshing indicator */}
      {isRefreshing && isLoaded && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="text-xs text-zinc-400">Refreshing data...</span>
        </div>
      )}

      {/* Status bar */}
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
