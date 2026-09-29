// Single source of truth for Apex branding. Edit values here; nothing else hard-codes colours, fonts or logos.
// Replace the font with the official Apex font once it is known (see `fonts`).

export const theme = {
  brand: {
    name: "Apex Brands",
    logoIcon: "/brand/apex-icon.svg",
    logoIconAccent: "/brand/apex-icon-accent.svg",
    logoWordmark: "/brand/apex-wordmark-white.svg", // white lettering, transparent bg
  },
  colors: {
    bg: "#000000",
    surface: "#0d0d0d",
    surfaceRaised: "#161616",
    border: "#262626",
    text: "#ffffff",
    textMuted: "#a3a3a3",
    textFaint: "#6b6b6b",
    accent: "#3ad823", // Apex accent green (from accent logo variants)
    good: "#34d399", // status: better than expectation
    bad: "#f87171", // status: worse than expectation
    neutral: "#a3a3a3",
    chartPrimary: "#3ad823",
    chartSecondary: "#1f6b16",
    chartTarget: "#fbbf24",
    chartCompare: "#7c7c7c",
  },
  fonts: {
    // Placeholder wide geometric sans, chosen to echo the wordmark. Swap in layout.tsx (next/font) + here.
    heading: "var(--font-montserrat), 'Montserrat', system-ui, sans-serif",
    body: "var(--font-geist-sans), system-ui, sans-serif",
    mono: "var(--font-geist-mono), ui-monospace, monospace",
  },
  radius: { card: "12px", chip: "999px" },
} as const;

/** CSS custom properties injected on :root so Tailwind/CSS can use var(--apex-*). */
export function themeCss(): string {
  const c = theme.colors;
  const vars: Record<string, string> = {
    "--apex-bg": c.bg,
    "--apex-surface": c.surface,
    "--apex-surface-raised": c.surfaceRaised,
    "--apex-border": c.border,
    "--apex-text": c.text,
    "--apex-text-muted": c.textMuted,
    "--apex-text-faint": c.textFaint,
    "--apex-accent": c.accent,
    "--apex-good": c.good,
    "--apex-bad": c.bad,
    "--apex-neutral": c.neutral,
    "--apex-font-heading": theme.fonts.heading,
    "--apex-font-body": theme.fonts.body,
    "--apex-radius-card": theme.radius.card,
  };
  return `:root{${Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";")}}`;
}
