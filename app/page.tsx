"use client";

import MapClient from "@/components/MapClient";
import Legend from "@/components/Legend";
import {
  Activity,
  MapPin,
  Navigation,
  Zap,
  Shield,
  RefreshCw,
} from "lucide-react";
import { useState, useCallback } from "react";

export default function Home() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    // Dispatch event that Map.tsx listens for
    window.dispatchEvent(new Event("refresh-stress-data"));
    // Visual feedback for 3 seconds minimum
    setTimeout(() => setIsRefreshing(false), 3000);
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
          {/* Refresh button */}
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
            <span className="text-zinc-300 font-medium">Kolkata, IN</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 relative overflow-hidden">
        {/* Sidebar */}
        <aside className="w-80 border-r border-[#1b2332] bg-[#0d1117]/80 backdrop-blur-xl flex flex-col z-10">
          <div className="p-5 border-b border-[#1b2332]">
            <div className="flex items-center gap-2 mb-2">
              <Navigation size={16} className="text-emerald-400" />
              <h2 className="text-base font-bold text-white">Route Finder</h2>
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Find the calmest route to your destination. We analyze noise,
              crowds, air quality, traffic, and temperature along each path.
            </p>
          </div>

          <div className="p-5 space-y-4 flex-1">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                Origin
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/30" />
                <input
                  disabled
                  type="text"
                  placeholder="e.g. Park Street"
                  className="w-full rounded-lg border border-[#1b2332] bg-[#111827] py-2.5 pl-8 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all disabled:opacity-40"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 text-zinc-700">
              <div className="flex-1 h-px bg-[#1b2332]" />
              <Zap size={12} />
              <div className="flex-1 h-px bg-[#1b2332]" />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em]">
                Destination
              </label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-red-500 ring-2 ring-red-500/30" />
                <input
                  disabled
                  type="text"
                  placeholder="e.g. Salt Lake Sector V"
                  className="w-full rounded-lg border border-[#1b2332] bg-[#111827] py-2.5 pl-8 pr-4 text-sm text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all disabled:opacity-40"
                />
              </div>
            </div>

            <button
              disabled
              className="mt-3 w-full rounded-lg bg-emerald-500/10 border border-emerald-500/20 py-2.5 text-sm font-semibold text-emerald-400/60 shadow-sm transition-all hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Find Calmest Route
            </button>

            <p className="text-[10px] text-zinc-600 text-center">
              Route comparison coming soon
            </p>
          </div>

          {/* Info footer */}
          <div className="p-4 border-t border-[#1b2332] bg-[#0a0d12]">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2.5 rounded-lg bg-[#111827] border border-[#1b2332]">
                <div className="text-[10px] text-zinc-600 uppercase tracking-wider">
                  Resolution
                </div>
                <div className="text-lg font-bold text-emerald-400 font-mono">
                  100m
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

        {/* Map Container */}
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
