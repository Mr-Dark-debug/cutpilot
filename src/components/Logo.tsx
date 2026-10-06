export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a7bff" />
          <stop offset="1" stopColor="#5b47f0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#cp-g)" />
      {/* Three clips on a timeline, the middle one cut out. */}
      <rect x="12" y="20" width="14" height="10" rx="3" fill="#fff" />
      <rect x="31" y="20" width="21" height="10" rx="3" fill="#fff" fillOpacity="0.45" />
      <rect x="12" y="35" width="24" height="10" rx="3" fill="#fff" fillOpacity="0.45" />
      <rect x="41" y="35" width="11" height="10" rx="3" fill="#fff" />
      <path d="M29 14 L35 50" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[16px] font-semibold tracking-tight">CutPilot</span>
    </div>
  );
}
