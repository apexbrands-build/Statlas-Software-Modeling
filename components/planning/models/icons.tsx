/** Small inline illustrations for the Models info page (no icon library needed). They use the accent colour and the text colour of the page. */

const ACC = "var(--apex-accent, #7cf39b)";

export function GrowthIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-full" role="img" aria-label="Bars rising with an arrow">
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={14 + i * 28} y={78 - (14 + i * 11)} width={20} height={14 + i * 11} rx={3} fill="currentColor" opacity={0.18 + i * 0.1} />
      ))}
      <path d="M16 56 C 52 52, 80 30, 140 16" fill="none" stroke={ACC} strokeWidth={3} strokeLinecap="round" />
      <path d="M130 12 L142 15 L136 26" fill="none" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={8} x2={152} y1={80} y2={80} stroke="currentColor" opacity={0.25} />
    </svg>
  );
}

export function RetentionIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-full" role="img" aria-label="Stacked bars with repeat revenue on top">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <rect x={14 + i * 28} y={78 - (18 + i * 9)} width={20} height={18 + i * 9} rx={3} fill="currentColor" opacity={0.3 + i * 0.1} />
          <rect x={14 + i * 28} y={78 - (18 + i * 9) - (12 - i)} width={20} height={12 - i} rx={3} fill={ACC} opacity={0.75} />
          <path d={`M${24 + i * 28} ${70 - (18 + i * 9) - (12 - i)} l-4 5 h8 z`} fill={ACC} />
        </g>
      ))}
      <line x1={8} x2={152} y1={80} y2={80} stroke="currentColor" opacity={0.25} />
    </svg>
  );
}

export function EventIllustration() {
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-full" role="img" aria-label="Calendar with highlighted event days and a spike">
      <rect x={14} y={14} width={64} height={62} rx={8} fill="none" stroke="currentColor" opacity={0.4} strokeWidth={2} />
      <line x1={14} x2={78} y1={30} y2={30} stroke="currentColor" opacity={0.4} strokeWidth={2} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={20 + (i % 4) * 14} y={36 + Math.floor(i / 4) * 13} width={9} height={8} rx={2} fill={i === 5 || i === 6 ? ACC : "currentColor"} opacity={i === 5 || i === 6 ? 0.9 : 0.2} />
      ))}
      <path d="M92 70 L106 70 L114 46 L122 20 L130 54 L138 66 L152 66" fill="none" stroke={ACC} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <line x1={90} x2={154} y1={76} y2={76} stroke="currentColor" opacity={0.25} />
    </svg>
  );
}

export function CreativeIllustration() {
  const tiles = [
    [16, 52, 22, 30],
    [44, 36, 22, 46],
    [72, 24, 22, 58],
  ];
  return (
    <svg viewBox="0 0 160 100" className="h-24 w-full" role="img" aria-label="Ad tiles of growing height beside a score dial">
      {tiles.map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx={4} fill={i === 2 ? ACC : "currentColor"} opacity={i === 2 ? 0.9 : 0.25} />
      ))}
      <path d="M104 78 A30 30 0 1 1 152 78" fill="none" stroke="currentColor" opacity={0.25} strokeWidth={6} strokeLinecap="round" />
      <path d="M104 78 A30 30 0 0 1 136 38" fill="none" stroke={ACC} strokeWidth={6} strokeLinecap="round" />
      <text x={128} y={72} textAnchor="middle" fontSize={16} fontWeight={700} fill="currentColor">
        61
      </text>
    </svg>
  );
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export type BulletIcon = "scatter" | "target" | "cohort" | "layers" | "calendar" | "bolt";

/** 20px line icons for the bullet points. */
export function BulletGlyph({ name }: { name: BulletIcon }) {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0" style={{ color: ACC }} aria-hidden>
      {name === "scatter" && (
        <>
          <path d="M4 4v16h16" {...stroke} />
          <circle cx={9} cy={14} r={1.2} fill="currentColor" />
          <circle cx={12} cy={11} r={1.2} fill="currentColor" />
          <circle cx={15} cy={12.5} r={1.2} fill="currentColor" />
          <circle cx={18} cy={8} r={1.2} fill="currentColor" />
          <path d="M6 16 L19 7" {...stroke} />
        </>
      )}
      {name === "target" && (
        <>
          <circle cx={12} cy={12} r={8} {...stroke} />
          <circle cx={12} cy={12} r={4} {...stroke} />
          <circle cx={12} cy={12} r={1} fill="currentColor" />
        </>
      )}
      {name === "cohort" && (
        <>
          <rect x={4} y={14} width={4} height={6} rx={1} {...stroke} />
          <rect x={10} y={10} width={4} height={10} rx={1} {...stroke} />
          <rect x={16} y={5} width={4} height={15} rx={1} {...stroke} />
        </>
      )}
      {name === "layers" && (
        <>
          <path d="M12 4 L21 9 L12 14 L3 9 Z" {...stroke} />
          <path d="M3 13 L12 18 L21 13" {...stroke} />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x={4} y={5} width={16} height={15} rx={2} {...stroke} />
          <path d="M4 10h16M9 3v4M15 3v4" {...stroke} />
        </>
      )}
      {name === "bolt" && <path d="M13 3 L5 14 h6 l-1 7 8-11 h-6 z" {...stroke} />}
    </svg>
  );
}
