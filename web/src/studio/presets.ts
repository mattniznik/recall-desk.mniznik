// The layouts, colour sets and typefaces a visitor can pick in the Studio, and the site
// default. Ported from rag.irs.mniznik (cite-or-abstain/worker/public/presets.js, same
// author): the palettes and font pairings are copied, the layouts keep their ids and their
// sections, and their descriptions are rewritten for this page. Tested in
// test/web-studio.test.ts, contrast included.

export type Palette = {
  name: string;
  light?: boolean;
  bg: string;
  card: string;
  card2: string;
  line: string;
  tx: string;
  mu: string;
  a1: string;
  a2: string;
  a3: string;
  acc: string;
  on: string;
  mark: string;
  // a palette with its own button fill (paperRust): the button and its text
  fill?: string;
  onFill?: string;
};

export type Font = {
  name: string;
  head: string;
  body: string;
  // the Google Fonts families the pairing needs; pages load only the chosen one
  gf: string;
  // heading weight
  hw: number;
  // headings in capitals
  caps?: boolean;
};

export type LayoutCfg = {
  // the five map-first layouts (looks/), each drawn from one design reference
  look?: "canvas" | "waterfall" | "workshop" | "spec" | "garage";
  hero?: "search" | "console" | "split" | "editorial";
  features?: "bento" | "list" | "none";
  how?: "field" | "pipeline" | "story" | "player";
  proof?: "numbers" | "table" | "cards" | "versus";
  palette: string;
  font: string;
};

export type Option = { id: string; name: string; short: string; simple?: 1 | 2 | 3; cfg: LayoutCfg };

// Four layouts are built from sections (rich/); three are the one-column page (simple/); five are
// built around the system map (looks/), one per design reference (2026-11-14):
// patterns borrowed, nothing copied.
// cfg is each layout's own look; a visitor can then change the colours and type.
export const OPTIONS: Option[] = [
  { id: "01", name: "Ask anything", short: "The chat up front, each answer with its trace right under it, then a field of dots that shows one real run.", cfg: { hero: "search", features: "bento", how: "field", proof: "numbers", palette: "coverDark", font: "grotesk" } },
  { id: "04", name: "Under the hood", short: "For engineers: a real run as a log, the agent as a figure, the measured runs as a table.", cfg: { hero: "console", features: "none", how: "pipeline", proof: "table", palette: "mono", font: "mono" } },
  { id: "05", name: "Scroll story", short: "The NHTSA record beside the answer that read it; one run walks through the agent as you scroll.", cfg: { hero: "split", features: "list", how: "story", proof: "cards", palette: "coverDark", font: "grotesk" } },
  { id: "06", name: "Editorial", short: "Paper and serif: a real answer with its recalls as footnotes, one run stepped through in a player.", cfg: { hero: "editorial", features: "list", how: "player", proof: "versus", palette: "coverPaper", font: "serif" } },
  { id: "07", name: "Simple: moving line", simple: 1, short: "One plain column, the way the demo started. A dot carries the question through the steps.", cfg: { palette: "demo", font: "system" } },
  { id: "08", name: "Simple: golden field", simple: 2, short: "One column on black. One dot per owner complaint, narrowing to one checked answer.", cfg: { palette: "mono", font: "grotesk" } },
  { id: "09", name: "Simple: step-through", simple: 3, short: "One column on paper. A player walks one real run through every step.", cfg: { palette: "paperRust", font: "serif" } },
  { id: "10", name: "Run canvas", short: "A workflow canvas: the recorded runs in a rail, the system map in the middle lighting up step by step, the desk as its log panel.", cfg: { look: "canvas", palette: "canvasNight", font: "geist" } },
  { id: "11", name: "Trace waterfall", short: "An observability view: one real run as a tree of spans with measured bars, a detail panel, and the map lit by the row you pick.", cfg: { look: "waterfall", palette: "lilac", font: "jakarta" } },
  { id: "12", name: "Workshop sheet", short: "Cream and orange: a tab per tool beside the map on graph paper, each with the endpoint it reads and a real call.", cfg: { look: "workshop", palette: "workshop", font: "archivo" } },
  { id: "13", name: "Spec sheet", short: "Dark and technical: a numbered index down the side, the map as Fig. 1 with numbered callouts, the rules as a table.", cfg: { look: "spec", palette: "specNight", font: "newsreader" } },
  { id: "14", name: "Status cards", short: "Friendly, like a car app: each piece of the agent as a card with its status. Tap one to find it on the map.", cfg: { look: "garage", palette: "garage", font: "outfit" } },
];

// What a first-time visitor sees: Run canvas on Golden hour on paper with Barlow Condensed caps
// (chosen 2026-11-14; it was rag.irs's default, layout 01).
export const DEFAULT = { option: "10", palette: "coverPaper", font: "condensed" };

export const PALETTES: Record<string, Palette> = {
  coverDark: { name: "Golden hour on black", bg: "#070708", card: "#141416", card2: "#1b1b1e", line: "#26262c", tx: "#f3f3f5", mu: "#9a9aa3", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#f4a83a", on: "#111111", mark: "rgba(244,168,58,.28)" },
  coverTouch: { name: "Golden touch on black", bg: "#070708", card: "#141416", card2: "#1b1b1e", line: "#26262c", tx: "#f3f3f5", mu: "#9a9aa3", a1: "#f5a03a", a2: "#e9765e", a3: "#d9568a", acc: "#f5a03a", on: "#111111", mark: "rgba(245,160,58,.28)" },
  // acc #d9652f -> #b4471b and on #ffffff -> #111111 (rag.irs, 2026-11-13): white on the gold button was 2.0:1, the accent as text 3.2:1
  coverPaper: { name: "Golden hour on paper", light: true, bg: "#f6f0e6", card: "#ffffff", card2: "#fbf7f0", line: "#e3d9c8", tx: "#111111", mu: "#4a4743", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#b4471b", on: "#111111", mark: "rgba(244,168,58,.35)" },
  coverInk: { name: "Golden hour, all ink", light: true, bg: "#ec8a4c", card: "rgba(10,10,10,.07)", card2: "rgba(10,10,10,.11)", line: "rgba(10,10,10,.18)", tx: "#0a0a0a", mu: "#3b2219", a1: "#0a0a0a", a2: "#2b1a12", a3: "#0a0a0a", acc: "#0a0a0a", on: "#f6f0e6", mark: "rgba(255,255,255,.45)" },
  mono: { name: "Mono + golden", bg: "#0b0b0c", card: "#131315", card2: "#1a1a1d", line: "#2a2a2f", tx: "#f4f4f5", mu: "#8d8d94", a1: "#f4a83a", a2: "#ec8050", a3: "#d55c82", acc: "#f4a83a", on: "#111111", mark: "rgba(244,168,58,.25)" },
  // a3 #1baf7a -> #0f7a55 (rag.irs, 2026-11-13): white on the green end of the button gradient was 2.8:1.
  // a1 #2a78d6 -> #2975d2 (here, 2026-11-14): white on it was 4.42:1, under the 4.5 this file claims; now 4.60:1.
  demo: { name: "Live demo (blue)", light: true, bg: "#fcfcfb", card: "#ffffff", card2: "#f3f3f0", line: "#e1e0d9", tx: "#0b0b0b", mu: "#52514e", a1: "#2975d2", a2: "#2457c5", a3: "#0f7a55", acc: "#2457c5", on: "#ffffff", mark: "#fff1b8" },
  // Every palette here passes: text and muted text >= 4.5:1 on bg, accent >= 3:1, button text >= 4.5:1 on each of
  // a1-a3 (and on fill where a palette has its own button fill). test/web-studio.test.ts checks it.
  demoDark: { name: "Live demo, dark", bg: "#1a1a19", card: "#1f1f1e", card2: "#232321", line: "#2c2c2a", tx: "#f0efec", mu: "#a9a89e", a1: "#7aa2ff", a2: "#3987e5", a3: "#199e70", acc: "#7aa2ff", on: "#0b0b0b", mark: "#5a4a10" },
  paperRust: { name: "Paper and rust", light: true, bg: "#f6f0e6", card: "#fffdf8", card2: "#efe7d9", line: "#e0d5c3", tx: "#1a1714", mu: "#4a4743", a1: "#b4471b", a2: "#a8501c", a3: "#8a6d12", acc: "#b4471b", on: "#ffffff", fill: "#1a1714", onFill: "#f6f0e6", mark: "#f7d27a" },
  ocean: { name: "Ocean night", bg: "#06121a", card: "#0c1c26", card2: "#112634", line: "#1d3444", tx: "#e9f3f7", mu: "#93acba", a1: "#4fd1c5", a2: "#38bdf8", a3: "#a78bfa", acc: "#4fd1c5", on: "#04222a", mark: "rgba(79,209,197,.26)" },
  lavender: { name: "Lavender dusk", bg: "#110e1b", card: "#19152a", card2: "#211c36", line: "#2e2746", tx: "#f1edfb", mu: "#a69fc2", a1: "#c4b5fd", a2: "#f0abfc", a3: "#fda4af", acc: "#c4b5fd", on: "#140f24", mark: "rgba(196,181,253,.24)" },
  lime: { name: "Graphite and lime", bg: "#0c0d0c", card: "#151715", card2: "#1c1f1c", line: "#2a2e2a", tx: "#f2f5f0", mu: "#9aa39a", a1: "#c6f432", a2: "#7ee081", a3: "#2dd4bf", acc: "#c6f432", on: "#10140a", mark: "rgba(198,244,50,.22)" },
  forest: { name: "Forest and brass", light: true, bg: "#f2f4ee", card: "#ffffff", card2: "#e9eee3", line: "#d5ddca", tx: "#13201a", mu: "#46564b", a1: "#2f7d4f", a2: "#4d7f2f", a3: "#8a6d12", acc: "#2f7d4f", on: "#ffffff", mark: "rgba(201,162,39,.32)" },
  sunrise: { name: "Sunrise", light: true, bg: "#fffaf3", card: "#ffffff", card2: "#fff1e0", line: "#f0dcc4", tx: "#1f140b", mu: "#6b5646", a1: "#f76707", a2: "#f0507a", a3: "#b56bd6", acc: "#c2410c", on: "#1f140b", mark: "rgba(247,103,7,.2)" },
  nordic: { name: "Nordic ice", light: true, bg: "#f4f7fb", card: "#ffffff", card2: "#e9eff7", line: "#d5dfeb", tx: "#0f1b2d", mu: "#48596f", a1: "#2563eb", a2: "#0e7490", a3: "#7c3aed", acc: "#1d4ed8", on: "#ffffff", mark: "#dbeafe" },
  cherry: { name: "Cherry ink", light: true, bg: "#fbf6f4", card: "#ffffff", card2: "#f5e9e5", line: "#e8d4cd", tx: "#1f0f0c", mu: "#6b4b43", a1: "#be123c", a2: "#c2410c", a3: "#7e22ce", acc: "#be123c", on: "#ffffff", mark: "rgba(190,18,60,.16)" },
  // The five map-first layouts' own (2026-11-14). Contrast measured with theme.ts contrast(): text 16.2-16.8:1,
  // muted 6.5-7.4:1, accent 5.3-10.7:1, button text 5.2:1 or more on every gradient stop.
  canvasNight: { name: "Canvas, graphite and mint", bg: "#0f1113", card: "#16191c", card2: "#1c2024", line: "#2a2f35", tx: "#eef0f2", mu: "#9ba2ab", a1: "#3ddc97", a2: "#5cc8ff", a3: "#ffb454", acc: "#3ddc97", on: "#0a1410", mark: "rgba(61,220,151,.22)" },
  canvasDay: { name: "Canvas, daylight", light: true, bg: "#f4f4f6", card: "#ffffff", card2: "#ececf0", line: "#d9dbe1", tx: "#15171c", mu: "#525866", a1: "#13753a", a2: "#1d4fd8", a3: "#a3361f", acc: "#13753a", on: "#ffffff", mark: "rgba(19,117,58,.16)" },
  lilac: { name: "Trace lilac", light: true, bg: "#faf9fc", card: "#ffffff", card2: "#f2eff8", line: "#e1dbec", tx: "#1e1631", mu: "#5c5370", a1: "#6a4bd6", a2: "#a82f73", a3: "#2f5fbd", acc: "#5b3fc4", on: "#ffffff", mark: "rgba(106,75,214,.16)" },
  workshop: { name: "Workshop cream", light: true, bg: "#fff8e8", card: "#ffffff", card2: "#fdecc0", line: "#ead9b0", tx: "#1c1712", mu: "#5b5041", a1: "#ef5a1f", a2: "#f4a300", a3: "#ff8a3d", acc: "#b83e0c", on: "#1c1712", fill: "#1c1712", onFill: "#fff8e8", mark: "rgba(239,90,31,.22)" },
  specNight: { name: "Spec sheet, night", bg: "#090c13", card: "#0f131c", card2: "#141a26", line: "#222a39", tx: "#e7eaf1", mu: "#8e97a9", a1: "#ff6a3d", a2: "#ff9b45", a3: "#ffc56b", acc: "#ff6a3d", on: "#140904", mark: "rgba(255,106,61,.22)" },
  garage: { name: "Garage light", light: true, bg: "#eef0f3", card: "#ffffff", card2: "#f5f6f8", line: "#dbe0e6", tx: "#111418", mu: "#4d5562", a1: "#0b63d1", a2: "#0d7a63", a3: "#7a4bd1", acc: "#0a5ccc", on: "#ffffff", mark: "#fff1b8" },
};

const DMS = "DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700";
export const FONTS: Record<string, Font> = {
  grotesk: { name: "Space Grotesk + DM Sans", head: "'Space Grotesk', system-ui, sans-serif", body: "'DM Sans', system-ui, sans-serif", gf: "Space+Grotesk:wght@500;600;700&family=" + DMS, hw: 700 },
  serif: { name: "Instrument Serif + DM Sans", head: "'Instrument Serif', Georgia, serif", body: "'DM Sans', system-ui, sans-serif", gf: "Instrument+Serif:ital@0;1&family=" + DMS, hw: 400 },
  mono: { name: "JetBrains Mono + DM Sans", head: "'JetBrains Mono', ui-monospace, monospace", body: "'DM Sans', system-ui, sans-serif", gf: "JetBrains+Mono:wght@400;500;700&family=" + DMS, hw: 700 },
  condensed: { name: "Barlow Condensed caps + DM Sans", head: "'Barlow Condensed', 'Bahnschrift Condensed', sans-serif", body: "'DM Sans', system-ui, sans-serif", caps: true, gf: "Barlow+Condensed:wght@700;800&family=" + DMS, hw: 800 },
  system: { name: "System UI (the plain page)", head: "system-ui, -apple-system, 'Segoe UI', sans-serif", body: "system-ui, -apple-system, 'Segoe UI', sans-serif", gf: "", hw: 700 },
  inter: { name: "Inter", head: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif", gf: "Inter:wght@400;500;600;700;800", hw: 700 },
  sora: { name: "Sora + Manrope", head: "'Sora', system-ui, sans-serif", body: "'Manrope', system-ui, sans-serif", gf: "Sora:wght@500;600;700&family=Manrope:wght@400;500;600;700", hw: 700 },
  plex: { name: "IBM Plex Sans", head: "'IBM Plex Sans', system-ui, sans-serif", body: "'IBM Plex Sans', system-ui, sans-serif", gf: "IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500", hw: 600 },
  fraunces: { name: "Fraunces + Inter", head: "'Fraunces', Georgia, serif", body: "'Inter', system-ui, sans-serif", gf: "Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600", hw: 600 },
  playfair: { name: "Playfair Display + Source Sans 3", head: "'Playfair Display', Georgia, serif", body: "'Source Sans 3', system-ui, sans-serif", gf: "Playfair+Display:wght@500;600;700&family=Source+Sans+3:wght@400;500;600;700", hw: 600 },
  // the five map-first layouts' own; each Google Fonts request answered 200 (2026-11-14)
  geist: { name: "Geist + Geist Mono", head: "'Geist', system-ui, sans-serif", body: "'Geist', system-ui, sans-serif", gf: "Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500", hw: 600 },
  jakarta: { name: "Plus Jakarta Sans + IBM Plex Mono", head: "'Plus Jakarta Sans', system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, sans-serif", gf: "Plus+Jakarta+Sans:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500", hw: 700 },
  archivo: { name: "Archivo + Public Sans", head: "'Archivo', system-ui, sans-serif", body: "'Public Sans', system-ui, sans-serif", gf: "Archivo:wght@500;600;700;800&family=Public+Sans:wght@400;500;600;700", hw: 700 },
  newsreader: { name: "Newsreader light + Inter Tight", head: "'Newsreader', Georgia, serif", body: "'Inter Tight', system-ui, sans-serif", gf: "Newsreader:opsz,wght@6..72,300;6..72,400&family=Inter+Tight:wght@400;500;600", hw: 300 },
  outfit: { name: "Outfit + Nunito Sans", head: "'Outfit', system-ui, sans-serif", body: "'Nunito Sans', system-ui, sans-serif", gf: "Outfit:wght@400;500;600;700&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700", hw: 600 },
};

export type Presets = { OPTIONS: Option[]; PALETTES: Record<string, Palette>; FONTS: Record<string, Font>; DEFAULT: typeof DEFAULT };
export const PRESETS: Presets = { OPTIONS, PALETTES, FONTS, DEFAULT };
