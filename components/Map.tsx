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

const REFRESH_INTERVAL = 5 * 60 * 1000;
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
function getStressLabel(s: number) {
  return s >= 75
    ? "Chaotic"
    : s >= 50
      ? "Stressful"
      : s >= 25
        ? "Moderate"
        : "Calm";
}
function getStressOpacity(s: number) {
  return 0.25 + (s / 100) * 0.45;
}

function buildPopupHTML(p: any, lat: number, lng: number, res: string) {
  const c = getStressColor(p.stress_index);
  const bars = [
    ["🔊 Noise", p.noise_score],
    ["👥 Crowd", p.crowd_score],
    ["🌫️ AQI", p.aqi_score],
    ["🚗 Traffic", p.traffic_score],
    ["🌡️ Temp", p.temperature_score],
  ]
    .map(
      ([l, v]: any) =>
        `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;"><span style="color:#94a3b8;">${l}</span><div style="display:flex;align-items:center;gap:8px;"><div style="width:70px;height:4px;background:#1e293b;border-radius:2px;overflow:hidden;"><div style="width:${Math.round(v)}%;height:100%;background:${getStressColor(v)};border-radius:2px;"></div></div><span style="font-family:monospace;font-size:11px;color:#e0e6f0;min-width:22px;text-align:right;">${Math.round(v)}</span></div></div>`,
    )
    .join("");
  return `<div style="padding:16px;min-width:230px;"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;"><div><div style="font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;margin-bottom:2px;">Stress Score</div><div style="font-size:30px;font-weight:800;color:${c};line-height:1;">${Math.round(p.stress_index)}</div></div><div style="background:${c}18;color:${c};padding:4px 12px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid ${c}30;">${getStressLabel(p.stress_index)}</div></div><div style="border-top:1px solid #1e293b;padding-top:12px;display:grid;gap:8px;">${bars}</div><div style="margin-top:12px;font-size:9px;color:#475569;text-align:center;">📍 ${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E · ${res}m × ${res}m</div></div>`;
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isRemovedRef = useRef(false);
  const rectLayersRef = useRef<L.Rectangle[]>([]);
  const loadingRef = useRef(false);
  const resolutionRef = useRef("200");
  const previewRectRef = useRef<L.Rectangle | null>(null);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cellCount, setCellCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ cells: number; bounds: any } | null>(
    null,
  );

  // ── Clear existing rectangles ──
  const clearRects = useCallback(() => {
    const map = mapInstanceRef.current;
    for (const r of rectLayersRef.current) {
      try {
        map?.removeLayer(r);
      } catch {}
    }
    rectLayersRef.current = [];
  }, []);

  // ── Remove preview rectangle ──
  const clearPreview = useCallback(() => {
    if (previewRectRef.current && mapInstanceRef.current) {
      try {
        mapInstanceRef.current.removeLayer(previewRectRef.current);
      } catch {}
      previewRectRef.current = null;
    }
    setPreview(null);
  }, []);

  // ── Load + render stress data ──
  const loadStressData = useCallback(
    async (collectFresh: boolean, stepOverride?: number) => {
      const map = mapInstanceRef.current;
      if (!map || isRemovedRef.current || loadingRef.current) return;
      loadingRef.current = true;
      setIsRefreshing(true);
      setError(null);
      clearPreview();

      const step = stepOverride || RESOLUTIONS[resolutionRef.current] || 0.002;

      try {
        const bounds = map.getBounds();
        const minLat = bounds.getSouth(),
          maxLat = bounds.getNorth();
        const minLng = bounds.getWest(),
          maxLng = bounds.getEast();

        if (collectFresh) {
          try {
            const url = `/api/collect-data?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&step=${step}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) {
              setError(data.error);
              loadingRef.current = false;
              setIsRefreshing(false);
              return;
            }
          } catch (e) {
            console.warn("Collection failed");
          }
        }

        const url = `/api/stress-map?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`;
        const res = await fetch(url);
        const geojson = await res.json();
        if (geojson.error || isRemovedRef.current) return;

        const features = geojson.features || [];
        clearRects();
        if (isRemovedRef.current || !mapInstanceRef.current) return;

        const halfStep = step / 2;
        const currentRes = resolutionRef.current;
        for (const f of features) {
          if (isRemovedRef.current) break;
          const lng = f.geometry.coordinates[0],
            lat = f.geometry.coordinates[1];
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
        console.error("Load failed:", err);
      } finally {
        loadingRef.current = false;
        setIsRefreshing(false);
        setIsLoaded(true);
      }
    },
    [clearRects, clearPreview],
  );

  // ── Show region preview rectangle ──
  const showPreview = useCallback(
    (res: string) => {
      const map = mapInstanceRef.current;
      if (!map) return;

      clearPreview();
      const step = RESOLUTIONS[res] || 0.002;
      const bounds = map.getBounds();
      const latRange = bounds.getNorth() - bounds.getSouth();
      const lngRange = bounds.getEast() - bounds.getWest();
      const cells = Math.ceil(latRange / step) * Math.ceil(lngRange / step);

      const previewRect = L.rectangle(bounds, {
        color: cells > 10000 ? "#ef4444" : "#10b981",
        weight: 2,
        fillColor: cells > 10000 ? "#ef4444" : "#10b981",
        fillOpacity: 0.06,
        dashArray: "8 4",
        interactive: false,
      });

      if (!isRemovedRef.current && mapInstanceRef.current) {
        previewRect.addTo(mapInstanceRef.current);
        previewRectRef.current = previewRect;
      }

      setPreview({
        cells,
        bounds: {
          minLat: bounds.getSouth(),
          maxLat: bounds.getNorth(),
          minLng: bounds.getWest(),
          maxLng: bounds.getEast(),
        },
      });
    },
    [clearPreview],
  );

  // ── Confirm and collect data ──
  const confirmCollect = useCallback(() => {
    const step = RESOLUTIONS[resolutionRef.current] || 0.002;
    clearPreview();
    loadStressData(true, step);
  }, [loadStressData, clearPreview]);

  // ── Cancel preview ──
  const cancelPreview = useCallback(() => {
    clearPreview();
  }, [clearPreview]);

  // ── Event listeners ──
  useEffect(() => {
    const refreshHandler = () => loadStressData(true);
    const resHandler = (e: Event) => {
      const newRes = (e as CustomEvent).detail;
      resolutionRef.current = newRes;
      showPreview(newRes);
    };
    const confirmHandler = () => confirmCollect();
    const cancelHandler = () => cancelPreview();

    window.addEventListener("refresh-stress-data", refreshHandler);
    window.addEventListener("change-resolution", resHandler);
    window.addEventListener("confirm-collect", confirmHandler);
    window.addEventListener("cancel-collect", cancelHandler);
    return () => {
      window.removeEventListener("refresh-stress-data", refreshHandler);
      window.removeEventListener("change-resolution", resHandler);
      window.removeEventListener("confirm-collect", confirmHandler);
      window.removeEventListener("cancel-collect", cancelHandler);
    };
  }, [loadStressData, showPreview, confirmCollect, cancelPreview]);

  // ── Init map (runs ONCE) ──
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    isRemovedRef.current = false;

    const map = L.map(mapRef.current, {
      center: [22.55, 88.35],
      zoom: 12,
      zoomControl: true,
      preferCanvas: true,
    });
    mapInstanceRef.current = map;

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution: "&copy; OSM &copy; CARTO",
        maxZoom: 19,
        subdomains: "abcd",
      },
    ).addTo(map);

    map.whenReady(() => loadStressData(false));

    const interval = setInterval(() => loadStressData(true), REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      isRemovedRef.current = true;
      rectLayersRef.current = [];
      mapInstanceRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden glow-border">
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {/* Loading */}
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

      {/* Refreshing pill */}
      {isRefreshing && isLoaded && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="text-xs text-zinc-400">
            Collecting & rendering...
          </span>
        </div>
      )}

      {/* Status bar */}
      {isLoaded && lastUpdated && !preview && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg text-xs text-zinc-500">
          <span>{cellCount.toLocaleString()} cells</span>
          <span className="text-zinc-700">·</span>
          <span>Updated {lastUpdated}</span>
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-red-950/90 backdrop-blur-xl border border-red-800/50 px-4 py-3 rounded-xl shadow-2xl max-w-md">
          <div className="text-red-400 text-lg">⚠️</div>
          <div>
            <div className="text-xs font-semibold text-red-300">
              Collection Failed
            </div>
            <div className="text-xs text-red-400/80 mt-0.5">{error}</div>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-300 transition-colors text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Region Preview Overlay */}
      {preview && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-30 bg-[#111827]/95 backdrop-blur-xl border border-[#1b2332] px-5 py-4 rounded-xl shadow-2xl min-w-[320px]">
          <div className="text-xs font-bold text-zinc-300 mb-3 flex items-center gap-2">
            <span className="text-emerald-400">📐</span> Region Preview
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div className="bg-[#0d1117] rounded-lg p-2.5 border border-[#1b2332]">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wider">
                Estimated Cells
              </div>
              <div
                className={`text-xl font-bold font-mono ${preview.cells > 10000 ? "text-red-400" : "text-emerald-400"}`}
              >
                {preview.cells.toLocaleString()}
              </div>
            </div>
            <div className="bg-[#0d1117] rounded-lg p-2.5 border border-[#1b2332]">
              <div className="text-[9px] text-zinc-600 uppercase tracking-wider">
                Resolution
              </div>
              <div className="text-xl font-bold font-mono text-zinc-300">
                {resolutionRef.current}m
              </div>
            </div>
          </div>
          {preview.cells > 10000 && (
            <div className="text-[11px] text-red-400/80 bg-red-950/50 border border-red-800/30 rounded-lg px-3 py-2 mb-3">
              ⚠️ Too many cells ({preview.cells.toLocaleString()}/10,000 max).
              Zoom in or increase grid size.
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => window.dispatchEvent(new Event("cancel-collect"))}
              className="flex-1 py-2 rounded-lg bg-[#1b2332] text-zinc-400 text-xs font-medium hover:bg-[#253040] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => window.dispatchEvent(new Event("confirm-collect"))}
              disabled={preview.cells > 10000}
              className="flex-1 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Confirm & Collect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
