"use client";

import MapClient from "@/components/MapClient";
import Legend from "@/components/Legend";
import {
  MapPin,
  Navigation,
  Zap,
  Shield,
  RefreshCw,
  Grid3X3,
  Crosshair,
  Loader2,
  X,
} from "lucide-react";
import { useState, useCallback, useEffect } from "react";

const RES_OPTS = [
  { value: "50", label: "50m", desc: "Ultra-fine" },
  { value: "100", label: "100m", desc: "Fine" },
  { value: "200", label: "200m", desc: "Default" },
  { value: "400", label: "400m", desc: "Medium" },
  { value: "800", label: "800m", desc: "Coarse" },
];

// Free geocoding via Nominatim (OSM)
async function geocode(
  query: string,
): Promise<{ lat: number; lng: number; name: string } | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`,
    );
    const data = await res.json();
    if (data.length > 0)
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        name: data[0].display_name.split(",").slice(0, 2).join(","),
      };
  } catch {}
  return null;
}

interface RouteResult {
  name: string;
  distance_km: number;
  duration_min: number;
  stress_score: number;
  stress_label: string;
  color: string;
  coordinates: [number, number][];
}

export default function Home() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolution, setResolution] = useState("200");
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [originCoords, setOriginCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [destCoords, setDestCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Listen for location from map
  useEffect(() => {
    const handler = (e: Event) => {
      const { lat, lng } = (e as CustomEvent).detail;
      setOrigin("My Location");
      setOriginCoords({ lat, lng });
    };
    window.addEventListener("user-location", handler);
    return () => window.removeEventListener("user-location", handler);
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    window.dispatchEvent(new Event("refresh-stress-data"));
    setTimeout(() => setIsRefreshing(false), 3000);
  }, []);

  const handleResolutionChange = useCallback((newRes: string) => {
    setResolution(newRes);
    window.dispatchEvent(
      new CustomEvent("change-resolution", { detail: newRes }),
    );
  }, []);

  const handleLocateMe = useCallback(() => {
    setIsLocating(true);
    window.dispatchEvent(new Event("locate-me"));
    setTimeout(() => setIsLocating(false), 2000);
  }, []);

  const handleFindRoute = useCallback(async () => {
    setRouteError(null);
    setRoutes([]);

    // Geocode origin if needed
    let start = originCoords;
    if (!start && origin.trim()) {
      const result = await geocode(origin);
      if (result) {
        start = { lat: result.lat, lng: result.lng };
        setOriginCoords(start);
      } else {
        setRouteError("Could not find origin location");
        return;
      }
    }
    if (!start) {
      setRouteError("Please enter an origin or use your current location");
      return;
    }

    // Geocode destination
    let end = destCoords;
    if (!end && destination.trim()) {
      const result = await geocode(destination);
      if (result) {
        end = { lat: result.lat, lng: result.lng };
        setDestCoords(end);
      } else {
        setRouteError("Could not find destination");
        return;
      }
    }
    if (!end) {
      setRouteError("Please enter a destination");
      return;
    }

    setIsRouting(true);
    try {
      const res = await fetch(
        `/api/stress-route?startLat=${start.lat}&startLng=${start.lng}&endLat=${end.lat}&endLng=${end.lng}`,
      );
      const data = await res.json();
      if (data.error) {
        setRouteError(data.error);
        return;
      }

      setRoutes(data.routes);
      // Send routes to map
      window.dispatchEvent(
        new CustomEvent("render-routes", { detail: data.routes }),
      );
    } catch (err: any) {
      setRouteError(err.message);
    } finally {
      setIsRouting(false);
    }
  }, [origin, destination, originCoords, destCoords]);

  const handleClearRoutes = useCallback(() => {
    setRoutes([]);
    setRouteError(null);
    window.dispatchEvent(new Event("clear-routes"));
  }, []);

  return (
    <main className="flex h-screen flex-col bg-[#07090e] text-zinc-100 overflow-hidden font-sans">
      {/* Navbar */}
      <header className="flex h-14 items-center justify-between border-b border-[#1b2332] bg-[#0d1117]/90 px-5 backdrop-blur-xl z-20">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30">
            <Shield size={18} />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-zinc-100">
              SENTINEL CITY
            </h1>
            <p className="text-[10px] text-zinc-600 tracking-widest uppercase">
              Urban Stress Map
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleLocateMe}
            disabled={isLocating}
            className="flex items-center gap-2 rounded-full border border-[#1b2332] bg-[#111827] px-3 py-1.5 text-xs text-zinc-400 hover:text-blue-400 hover:border-blue-500/30 transition-all disabled:opacity-50"
          >
            <Crosshair
              size={12}
              className={isLocating ? "animate-pulse" : ""}
            />
            <span className="font-medium">
              {isLocating ? "Locating..." : "My Location"}
            </span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 rounded-full border border-[#1b2332] bg-[#111827] px-3 py-1.5 text-xs text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/30 transition-all disabled:opacity-50"
          >
            <RefreshCw
              size={12}
              className={isRefreshing ? "animate-spin" : ""}
            />
            <span className="font-medium">
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </span>
          </button>
          <div className="flex items-center gap-2 rounded-full border border-[#1b2332] bg-[#111827] px-3 py-1.5 text-xs text-zinc-400">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 pulse-live" />
            <span className="font-medium">Live</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#1b2332] bg-[#111827] px-4 py-1.5 text-xs">
            <MapPin size={12} className="text-emerald-400" />
            <span className="text-zinc-300 font-medium">Global</span>
          </div>
        </div>
      </header>

      <div className="flex flex-1 relative overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-[#1b2332] bg-[#0d1117]/80 backdrop-blur-xl flex flex-col z-10 overflow-y-auto">
          {/* Route Finder */}
          <div className="p-5 border-b border-[#1b2332]">
            <div className="flex items-center gap-2 mb-2">
              <Navigation size={16} className="text-emerald-400" />
              <h2 className="text-base font-bold text-white">Route Finder</h2>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Find the calmest route. We analyze noise, crowds, AQI, traffic,
              and temperature along each path.
            </p>
          </div>

          <div className="p-5 space-y-4 flex-1">
            {/* Origin */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                  Origin
                </label>
                <button
                  onClick={handleLocateMe}
                  className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
                >
                  📍 Use my location
                </button>
              </div>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
                <input
                  type="text"
                  placeholder="e.g. Park Street, Kolkata"
                  value={origin}
                  onChange={(e) => {
                    setOrigin(e.target.value);
                    setOriginCoords(null);
                  }}
                  onKeyDown={(e) =>
                    e.key === "Enter" && destination && handleFindRoute()
                  }
                  className="w-full rounded-lg border border-[#1b2332] bg-[#111827] py-2.5 pl-8 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-zinc-700">
              <div className="flex-1 h-px bg-[#1b2332]" />
              <Zap size={12} />
              <div className="flex-1 h-px bg-[#1b2332]" />
            </div>

            {/* Destination */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                Destination
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-500/30" />
                <input
                  type="text"
                  placeholder="e.g. Salt Lake Sector V"
                  value={destination}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setDestCoords(null);
                  }}
                  onKeyDown={(e) =>
                    e.key === "Enter" && origin && handleFindRoute()
                  }
                  className="w-full rounded-lg border border-[#1b2332] bg-[#111827] py-2.5 pl-8 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                />
              </div>
            </div>

            {/* Find Route Button */}
            <button
              onClick={handleFindRoute}
              disabled={isRouting || (!origin && !originCoords) || !destination}
              className="mt-3 w-full rounded-lg bg-emerald-500/15 border border-emerald-500/25 py-2.5 text-sm font-semibold text-emerald-400 shadow-sm transition-all hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isRouting ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Finding
                  routes...
                </>
              ) : (
                "Find Calmest Route"
              )}
            </button>

            {/* Route Error */}
            {routeError && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-800/20 rounded-lg px-3 py-2">
                ⚠️ {routeError}
              </div>
            )}

            {/* Route Results */}
            {routes.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                    Routes Found
                  </span>
                  <button
                    onClick={handleClearRoutes}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
                {routes.map((route, i) => (
                  <div
                    key={i}
                    className="bg-[#111827] border border-[#1b2332] rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: route.color }}
                        />
                        <span className="text-sm font-semibold text-zinc-200">
                          {route.name}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[9px] text-zinc-600 uppercase">
                          Distance
                        </div>
                        <div className="text-sm font-bold text-zinc-300 font-mono">
                          {route.distance_km}
                          <span className="text-[10px] text-zinc-500"> km</span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] text-zinc-600 uppercase">
                          Duration
                        </div>
                        <div className="text-sm font-bold text-zinc-300 font-mono">
                          {route.duration_min}
                          <span className="text-[10px] text-zinc-500">
                            {" "}
                            min
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] text-zinc-600 uppercase">
                          Stress
                        </div>
                        <div
                          className="text-sm font-bold font-mono"
                          style={{ color: route.color }}
                        >
                          {route.stress_score}
                        </div>
                      </div>
                    </div>
                    <div className="w-full h-1 rounded-full bg-[#1b2332] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${route.stress_score}%`,
                          background: route.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Resolution Selector */}
            <div className="mt-4 pt-4 border-t border-[#1b2332]">
              <div className="flex items-center gap-2 mb-3">
                <Grid3X3 size={14} className="text-emerald-400" />
                <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                  Grid Resolution
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {RES_OPTS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleResolutionChange(opt.value)}
                    className={`flex flex-col items-center py-2 px-1 rounded-lg border text-xs transition-all ${
                      resolution === opt.value
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                        : "bg-[#111827] border-[#1b2332] text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                    }`}
                  >
                    <span className="font-bold text-[11px]">{opt.label}</span>
                    <span className="text-[8px] mt-0.5 opacity-70">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#1b2332] bg-[#0a0d12]">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#111827] border border-[#1b2332]">
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                  Resolution
                </div>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  {resolution}m
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#111827] border border-[#1b2332]">
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                  Auto Refresh
                </div>
                <div className="text-lg font-bold text-zinc-300 font-mono">
                  5 min
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Map */}
        <div className="flex-1 relative">
          <div className="absolute inset-0">
            <MapClient />
          </div>
          <Legend />
        </div>
      </div>
    </main>
  );
}
