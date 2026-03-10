export default function Legend() {
  const levels = [
    {
      color: "#22c55e",
      glow: "rgba(34,197,94,0.4)",
      label: "Calm",
      range: "0-25",
    },
    {
      color: "#eab308",
      glow: "rgba(234,179,8,0.4)",
      label: "Moderate",
      range: "25-50",
    },
    {
      color: "#f97316",
      glow: "rgba(249,115,22,0.4)",
      label: "Stressful",
      range: "50-75",
    },
    {
      color: "#ef4444",
      glow: "rgba(239,68,68,0.4)",
      label: "Chaotic",
      range: "75-100",
    },
  ];

  return (
    <div className="absolute bottom-5 left-5 z-[1000] bg-[#111827]/90 backdrop-blur-xl border border-[#1b2332] px-4 py-3 rounded-xl shadow-2xl text-white glow-border">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.15em]">
          Stress Index
        </h4>
      </div>
      <div className="flex items-center gap-2">
        {levels.map((l) => (
          <div key={l.label} className="flex flex-col items-center gap-1.5">
            <div
              className="w-3.5 h-3.5 rounded-full"
              style={{
                backgroundColor: l.color,
                boxShadow: `0 0 10px ${l.glow}`,
              }}
            />
            <span className="text-[9px] text-zinc-500 font-medium">
              {l.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
