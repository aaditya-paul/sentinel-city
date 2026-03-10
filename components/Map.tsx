"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";

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

function getStressColor(s: number): string {
  if (s <= 25) return lerpC([34, 197, 94], [132, 204, 22], s / 25);
  if (s <= 50) return lerpC([132, 204, 22], [234, 179, 8], (s - 25) / 25);
  if (s <= 75) return lerpC([234, 179, 8], [249, 115, 22], (s - 50) / 25);
  return lerpC([249, 115, 22], [220, 38, 38], (s - 75) / 25);
}
function lerpC(a: number[], b: number[], t: number) {
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

// Custom pulsing location icon
function createLocationIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="position:relative;width:20px;height:20px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(59,130,246,0.3);animation:pulse-loc 2s infinite;"></div>
      <div style="position:absolute;top:4px;left:4px;width:12px;height:12px;border-radius:50%;background:#3b82f6;border:2px solid white;box-shadow:0 0 8px rgba(59,130,246,0.6);"></div>
    </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export default function Map() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const isRemovedRef = useRef(false);
  const rectLayersRef = useRef<L.Rectangle[]>([]);
  const loadingRef = useRef(false);
  const resolutionRef = useRef("200");
  const previewRectRef = useRef<L.Rectangle | null>(null);
  const locationMarkerRef = useRef<L.Marker | null>(null);
  const routeLayersRef = useRef<L.Polyline[]>([]);
  const routeMarkersRef = useRef<L.Marker[]>([]);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [cellCount, setCellCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ cells: number } | null>(null);

  const clearRects = useCallback(() => {
    const map = mapInstanceRef.current;
    for (const r of rectLayersRef.current) {
      try {
        map?.removeLayer(r);
      } catch {}
    }
    rectLayersRef.current = [];
  }, []);

  const clearPreview = useCallback(() => {
    if (previewRectRef.current && mapInstanceRef.current) {
      try {
        mapInstanceRef.current.removeLayer(previewRectRef.current);
      } catch {}
      previewRectRef.current = null;
    }
    setPreview(null);
  }, []);

  const clearRoutes = useCallback(() => {
    const map = mapInstanceRef.current;
    for (const l of routeLayersRef.current) {
      try {
        map?.removeLayer(l);
      } catch {}
    }
    for (const m of routeMarkersRef.current) {
      try {
        map?.removeLayer(m);
      } catch {}
    }
    routeLayersRef.current = [];
    routeMarkersRef.current = [];
  }, []);

  // ── Load stress grid data ──
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
            const res = await fetch(
              `/api/collect-data?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&step=${step}`,
            );
            const data = await res.json();
            if (data.error) {
              setError(data.error);
              loadingRef.current = false;
              setIsRefreshing(false);
              return;
            }
          } catch {
            console.warn("Collection failed");
          }
        }

        const res = await fetch(
          `/api/stress-map?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}`,
        );
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

  // ── Show preview rectangle ──
  const showPreview = useCallback(
    (res: string) => {
      const map = mapInstanceRef.current;
      if (!map) return;
      clearPreview();
      const step = RESOLUTIONS[res] || 0.002;
      const bounds = map.getBounds();
      const cells =
        Math.ceil((bounds.getNorth() - bounds.getSouth()) / step) *
        Math.ceil((bounds.getEast() - bounds.getWest()) / step);

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
      setPreview({ cells });
    },
    [clearPreview],
  );

  const confirmCollect = useCallback(() => {
    clearPreview();
    loadStressData(true, RESOLUTIONS[resolutionRef.current] || 0.002);
  }, [loadStressData, clearPreview]);

  // ── Show current location ──
  const showLocation = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map || !navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        // Remove old marker
        if (locationMarkerRef.current) {
          try {
            map.removeLayer(locationMarkerRef.current);
          } catch {}
        }
        const marker = L.marker([latitude, longitude], {
          icon: createLocationIcon(),
        })
          .bindPopup(
            `<div style="padding:8px;font-size:13px;"><b>📍 Your Location</b><br/><span style="color:#94a3b8;">${latitude.toFixed(5)}°N, ${longitude.toFixed(5)}°E</span></div>`,
          )
          .addTo(map);
        locationMarkerRef.current = marker;
        map.flyTo([latitude, longitude], 14, { duration: 1.5 });

        // Dispatch location to page for origin input
        window.dispatchEvent(
          new CustomEvent("user-location", {
            detail: { lat: latitude, lng: longitude },
          }),
        );
      },
      (err) => {
        setError("Location access denied: " + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // ── Render routes on map ──
  const renderRoutes = useCallback(
    (routes: any[]) => {
      const map = mapInstanceRef.current;
      if (!map || isRemovedRef.current) return;
      clearRoutes();

      // Draw routes from last to first (so calmest is on top)
      for (let i = routes.length - 1; i >= 0; i--) {
        const route = routes[i];
        const latLngs = route.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression,
        );

        // Shadow
        try {
          const shadow = L.polyline(latLngs, {
            color: "#000",
            weight: i === 0 ? 8 : 5,
            opacity: 0.3,
            interactive: false,
          });
          if (!isRemovedRef.current && mapInstanceRef.current) {
            shadow.addTo(mapInstanceRef.current);
            routeLayersRef.current.push(shadow);
          }
        } catch {}

        // Main line
        try {
          const line = L.polyline(latLngs, {
            color: route.color,
            weight: i === 0 ? 5 : 3,
            opacity: i === 0 ? 1 : 0.6,
            dashArray: i === 0 ? undefined : "6 6",
          });
          line.bindPopup(
            `<div style="padding:12px;min-width:180px;">
          <div style="font-size:14px;font-weight:700;margin-bottom:8px;">${route.name}</div>
          <div style="display:grid;gap:4px;font-size:12px;">
            <div style="display:flex;justify-content:space-between;"><span style="color:#94a3b8;">Distance</span><span style="font-weight:600;">${route.distance_km} km</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#94a3b8;">Duration</span><span style="font-weight:600;">${route.duration_min} min</span></div>
            <div style="display:flex;justify-content:space-between;"><span style="color:#94a3b8;">Stress</span><span style="font-weight:600;color:${route.color};">${route.stress_score} (${route.stress_label})</span></div>
          </div>
        </div>`,
            { maxWidth: 250 },
          );
          if (!isRemovedRef.current && mapInstanceRef.current) {
            line.addTo(mapInstanceRef.current);
            routeLayersRef.current.push(line);
          }
        } catch {}
      }

      // Fit map to routes
      if (routes.length > 0 && routes[0].coordinates.length > 0) {
        const allCoords = routes[0].coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as L.LatLngExpression,
        );
        try {
          map.fitBounds(L.latLngBounds(allCoords), { padding: [40, 40] });
        } catch {}
      }
    },
    [clearRoutes],
  );

  // ── Event listeners ──
  useEffect(() => {
    const onRefresh = () => loadStressData(true);
    const onResChange = (e: Event) => {
      resolutionRef.current = (e as CustomEvent).detail;
      showPreview((e as CustomEvent).detail);
    };
    const onConfirm = () => confirmCollect();
    const onCancel = () => clearPreview();
    const onLocate = () => showLocation();
    const onRoutes = (e: Event) => renderRoutes((e as CustomEvent).detail);
    const onClearRoutes = () => clearRoutes();

    window.addEventListener("refresh-stress-data", onRefresh);
    window.addEventListener("change-resolution", onResChange);
    window.addEventListener("confirm-collect", onConfirm);
    window.addEventListener("cancel-collect", onCancel);
    window.addEventListener("locate-me", onLocate);
    window.addEventListener("render-routes", onRoutes);
    window.addEventListener("clear-routes", onClearRoutes);
    return () => {
      window.removeEventListener("refresh-stress-data", onRefresh);
      window.removeEventListener("change-resolution", onResChange);
      window.removeEventListener("confirm-collect", onConfirm);
      window.removeEventListener("cancel-collect", onCancel);
      window.removeEventListener("locate-me", onLocate);
      window.removeEventListener("render-routes", onRoutes);
      window.removeEventListener("clear-routes", onClearRoutes);
    };
  }, [
    loadStressData,
    showPreview,
    confirmCollect,
    clearPreview,
    showLocation,
    renderRoutes,
    clearRoutes,
  ]);

  // ── Init map ONCE ──
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
      routeLayersRef.current = [];
      routeMarkersRef.current = [];
      mapInstanceRef.current = null;
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden glow-border">
      <style>{`@keyframes pulse-loc { 0%,100%{transform:scale(1);opacity:0.4} 50%{transform:scale(2.2);opacity:0} }`}</style>
      <div ref={mapRef} className="absolute inset-0 z-0" />

      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07090e] z-30">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
            <span className="text-sm text-zinc-500">
              Initializing stress grid...
            </span>
          </div>
        </div>
      )}

      {isRefreshing && isLoaded && (
        <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg">
          <div className="h-3.5 w-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
          <span className="text-xs text-zinc-400">
            Collecting & rendering...
          </span>
        </div>
      )}

      {isLoaded && lastUpdated && !preview && (
        <div className="absolute top-4 left-4 z-30 flex items-center gap-3 bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-3 py-2 rounded-lg text-xs text-zinc-500">
          <span>{cellCount.toLocaleString()} cells</span>
          <span className="text-zinc-700">·</span>
          <span>Updated {lastUpdated}</span>
        </div>
      )}

      {error && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 bg-red-950/90 backdrop-blur-xl border border-red-800/50 px-4 py-3 rounded-xl shadow-2xl max-w-md">
          <span className="text-red-400 text-lg">⚠️</span>
          <div>
            <div className="text-xs font-semibold text-red-300">Error</div>
            <div className="text-xs text-red-400/80 mt-0.5">{error}</div>
          </div>
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-300 text-sm"
          >
            ✕
          </button>
        </div>
      )}

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
