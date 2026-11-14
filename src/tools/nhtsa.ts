// Tools over NHTSA's public APIs: vPIC for VINs and model names, api.nhtsa.gov for
// recalls, complaints and safety ratings. No key is needed (all 5 endpoints answered
// 200 on 2026-11-12, n=1 each).
//
// Each tool returns `{ ok: true, ...fields }` or `{ ok: false, error }`, never throws
// for bad input: the result goes back to the model as data, and the model has to be
// able to read why a call failed. Each tool also cuts NHTSA's reply down to the fields
// the agent uses, because every extra field is paid for in tokens on every later call.
//
// Everything a tool returns came from NHTSA, and NHTSA's text (recall summaries,
// complaint narratives) is written by manufacturers and the public. The agent treats it
// as data, never as instructions.

import type { Deps } from "./http.ts";

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";

export type Failure = { ok: false; error: string };

// ---------------------------------------------------------------- arguments

// Make and model go into URL paths and query strings, and they come from the model,
// which read them from a customer. Letters, digits, spaces, dots and dashes cover every
// name NHTSA uses for cars ("CR-V", "Civic Type R", "F-150") and nothing that could
// change the path.
const NAME = /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,39}$/;

export function checkName(kind: "make" | "model", value: string): string | null {
  return NAME.test(value ?? "") ? null : `"${value}" is not a ${kind} name NHTSA would use.`;
}

export function checkYear(year: number): string | null {
  const latest = new Date().getUTCFullYear() + 2;
  return Number.isInteger(year) && year >= 1950 && year <= latest ? null : `${year} is not a model year between 1950 and ${latest}.`;
}

// ---------------------------------------------------------------- VIN

// 17 characters. The VIN alphabet leaves out I, O and Q so they cannot be misread as
// 1 and 0. The check digit is not verified: it is only mandatory for North American
// VINs, and NHTSA's decoder reports a bad one in its own error code.
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;

export const normalizeVin = (vin: string) => vin.trim().toUpperCase();
export const isValidVin = (vin: string) => VIN.test(normalizeVin(vin));

// vPIC's BodyClass values are long ("Hatchback/Liftback/Notchback"). Recall summaries
// name body styles in plain words ("Civic Sedan and Coupe"), so the rules compare on
// these short names.
export type BodyStyle = "sedan" | "coupe" | "hatchback" | "convertible" | "wagon" | "suv" | "pickup" | "van" | "other";

export function bodyStyleOf(bodyClass: string): BodyStyle {
  const b = bodyClass.toLowerCase();
  if (b.includes("sedan")) return "sedan";
  if (b.includes("coupe")) return "coupe";
  if (b.includes("hatchback")) return "hatchback";
  if (b.includes("convertible")) return "convertible";
  if (b.includes("wagon")) return "wagon";
  if (b.includes("sport utility")) return "suv";
  if (b.includes("pickup")) return "pickup";
  if (b.includes("van")) return "van";
  return "other";
}

export type Vehicle = {
  ok: true;
  make: string;
  model: string;
  year: number;
  bodyClass: string;
  bodyStyle: BodyStyle;
  trim: string;
};

export async function decodeVehicle(vin: string, { fetchJson }: Deps): Promise<Vehicle | Failure> {
  const v = normalizeVin(vin);
  if (!VIN.test(v)) {
    return { ok: false, error: "A VIN is 17 characters of letters and digits, without I, O or Q. Ask the customer to check it." };
  }
  const reply = (await fetchJson(`${VPIC}/DecodeVinValues/${v}?format=json`)) as { Results?: Record<string, string>[] };
  const r = reply.Results?.[0];
  if (!r || !r.Make) return { ok: false, error: "NHTSA could not decode this VIN." };
  return {
    ok: true,
    make: r.Make,
    model: r.Model,
    year: Number(r.ModelYear),
    bodyClass: r.BodyClass,
    bodyStyle: bodyStyleOf(r.BodyClass ?? ""),
    trim: r.Trim,
  };
}

// ---------------------------------------------------------------- models

// NHTSA's list for a make and year mixes cars, motorcycles and ATVs (68 names for
// Honda 2017). A search word narrows it; without one the reply is capped so a long
// list does not fill the model's context.
const MODEL_CAP = 30;

export type ModelList = { ok: true; make: string; year: number; total: number; models: string[]; truncated: boolean };

export async function listModels(
  args: { make: string; year: number; query?: string },
  { fetchJson }: Deps,
): Promise<ModelList | Failure> {
  const bad = checkName("make", args.make) ?? checkYear(args.year);
  if (bad) return { ok: false, error: bad };
  const url = `${VPIC}/GetModelsForMakeYear/make/${encodeURIComponent(args.make.toLowerCase())}/modelyear/${args.year}?format=json`;
  const reply = (await fetchJson(url)) as { Results?: { Model_Name: string }[] };
  const all = [...new Set((reply.Results ?? []).map((r) => r.Model_Name))].sort();
  const q = args.query?.trim().toLowerCase();
  const matches = q ? all.filter((m) => m.toLowerCase().includes(q)) : all;
  return {
    ok: true,
    make: args.make,
    year: args.year,
    total: all.length,
    models: matches.slice(0, MODEL_CAP),
    truncated: matches.length > MODEL_CAP,
  };
}

// ---------------------------------------------------------------- recalls

const API = "https://api.nhtsa.gov";

// Some vehicles have many recalls (24 for a 2002 Civic on 2026-11-13). The cap keeps a
// long history from crowding out everything else the model has to read.
const RECALL_CAP = 25;

// The report date is left out: NHTSA sends it as "09/11/2017", and whether that is
// 9 November or 11 September was not confirmed. A date the agent might misread is
// worse than no date. `Notes` is left out because it is the same contact boilerplate
// on every recall.
export type Recall = {
  campaign: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  parkIt: boolean;
  parkOutSide: boolean;
};

export type RecallList = { ok: true; make: string; model: string; year: number; count: number; recalls: Recall[]; truncated: boolean };

type RawRecall = {
  NHTSACampaignNumber: string;
  Component: string;
  Summary: string;
  Consequence: string;
  Remedy: string;
  parkIt?: boolean;
  parkOutSide?: boolean;
};

export async function getRecalls(
  args: { make: string; model: string; year: number },
  { fetchJson }: Deps,
): Promise<RecallList | Failure> {
  const bad = checkName("make", args.make) ?? checkName("model", args.model) ?? checkYear(args.year);
  if (bad) return { ok: false, error: bad };
  const q = (s: string) => encodeURIComponent(s.toLowerCase());
  const url = `${API}/recalls/recallsByVehicle?make=${q(args.make)}&model=${q(args.model)}&modelYear=${args.year}`;
  const reply = (await fetchJson(url)) as { results?: RawRecall[] };
  const all = reply.results ?? [];
  return {
    ok: true,
    make: args.make,
    model: args.model,
    year: args.year,
    count: all.length,
    recalls: all.slice(0, RECALL_CAP).map((r) => ({
      campaign: r.NHTSACampaignNumber,
      component: r.Component,
      summary: r.Summary,
      consequence: r.Consequence,
      remedy: r.Remedy,
      parkIt: r.parkIt === true,
      parkOutSide: r.parkOutSide === true,
    })),
    truncated: all.length > RECALL_CAP,
  };
}

// ---------------------------------------------------------------- complaints

// NHTSA's complaints reply for one vehicle is large (606 complaints, 577 KB for a 2017
// Civic) and written by the public. The agent gets the shape of it instead: totals,
// the most-reported components, and the newest few matching complaints cut short.
const RECENT = 5;
const SUMMARY_CHARS = 300;
const TOP_COMPONENTS = 8;

// Component names are NHTSA's own ("SERVICE BRAKES", "FUEL/PROPULSION SYSTEM").
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9 /\-]{0,39}$/;

export type Complaint = {
  odiNumber: number;
  filed: string;
  components: string[];
  crash: boolean;
  fire: boolean;
  injuries: number;
  deaths: number;
  summary: string;
};

export type ComplaintSearch = {
  ok: true;
  make: string;
  model: string;
  year: number;
  component: string | null;
  total: number;
  matching: number;
  byComponent: { component: string; count: number }[];
  recent: Complaint[];
  note: string;
};

type RawComplaint = {
  odiNumber: number;
  crash?: boolean;
  fire?: boolean;
  numberOfInjuries?: number;
  numberOfDeaths?: number;
  dateComplaintFiled?: string;
  components?: string;
  summary?: string;
};

// Complaint dates are MM/DD/YYYY: across 606 complaints the first part never passed
// 12 and the second reached 31 (measured 2026-11-13).
function isoDate(mdy = ""): string {
  const [m, d, y] = mdy.split("/");
  return y && m && d ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : "";
}

const shorten = (s = "") => (s.length <= SUMMARY_CHARS ? s : s.slice(0, SUMMARY_CHARS - 3).trimEnd() + "...");
const componentsOf = (c: RawComplaint) => (c.components ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function searchComplaints(
  args: { make: string; model: string; year: number; component?: string },
  { fetchJson }: Deps,
): Promise<ComplaintSearch | Failure> {
  const bad =
    checkName("make", args.make) ??
    checkName("model", args.model) ??
    checkYear(args.year) ??
    (args.component !== undefined && !COMPONENT.test(args.component)
      ? `"${args.component}" is not a component name. Use NHTSA's names, like SERVICE BRAKES or STEERING.`
      : null);
  if (bad) return { ok: false, error: bad };

  const q = (s: string) => encodeURIComponent(s.toLowerCase());
  const url = `${API}/complaints/complaintsByVehicle?make=${q(args.make)}&model=${q(args.model)}&modelYear=${args.year}`;
  const all = ((await fetchJson(url)) as { results?: RawComplaint[] }).results ?? [];

  const counts = new Map<string, number>();
  for (const c of all) for (const name of componentsOf(c)) counts.set(name, (counts.get(name) ?? 0) + 1);

  const want = args.component?.toUpperCase();
  const matching = want ? all.filter((c) => componentsOf(c).some((n) => n.includes(want))) : all;

  // Only the listed fields are copied, so anything else in NHTSA's reply (the vin
  // above all) cannot leak through.
  const recent = matching
    .map((c) => ({
      odiNumber: c.odiNumber,
      filed: isoDate(c.dateComplaintFiled),
      components: componentsOf(c),
      crash: c.crash === true,
      fire: c.fire === true,
      injuries: c.numberOfInjuries ?? 0,
      deaths: c.numberOfDeaths ?? 0,
      summary: shorten(c.summary),
    }))
    .sort((a, b) => b.filed.localeCompare(a.filed))
    .slice(0, RECENT);

  return {
    ok: true,
    make: args.make,
    model: args.model,
    year: args.year,
    component: args.component ?? null,
    total: all.length,
    matching: matching.length,
    byComponent: [...counts].sort((a, b) => b[1] - a[1]).slice(0, TOP_COMPONENTS).map(([component, count]) => ({ component, count })),
    recent,
    note: "Complaints are owners' own reports to NHTSA. They are not verified and are not recalls.",
  };
}

// ---------------------------------------------------------------- safety ratings

// NHTSA rates each variant separately (a 2017 Civic has a 2-door, a 4-door and a 5-door
// hatchback). The list call only gives ids, so each variant costs one more call; a known
// body style cuts that to one.
const VARIANT_CAP = 6;

export type RatedVariant = {
  vehicleId: number;
  description: string;
  bodyStyle: BodyStyle;
  overall: number | null;
  frontCrash: number | null;
  sideCrash: number | null;
  rollover: number | null;
};

export type SafetyRating = { ok: true; make: string; model: string; year: number; variants: RatedVariant[]; note: string };

// NHTSA's variant descriptions are short codes: "2017 Honda Civic 2 DR FWD",
// "... 4 DR FWD", "... 5 HB FWD". This reading of them is a heuristic, checked on the
// three 2017 Civic variants only.
export function bodyStyleOfDescription(description: string): BodyStyle {
  const d = ` ${description.toUpperCase()} `;
  if (/ SUV /.test(d)) return "suv";
  if (/ (PU|PICKUP) /.test(d)) return "pickup";
  if (/ VAN /.test(d)) return "van";
  if (/ HB /.test(d)) return "hatchback";
  if (/ CONV /.test(d)) return "convertible";
  if (/ 2 DR /.test(d)) return "coupe";
  if (/ 4 DR /.test(d)) return "sedan";
  return "other";
}

const stars = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
};

export async function getSafetyRating(
  args: { make: string; model: string; year: number; bodyStyle?: BodyStyle },
  { fetchJson }: Deps,
): Promise<SafetyRating | Failure> {
  const bad = checkName("make", args.make) ?? checkName("model", args.model) ?? checkYear(args.year);
  if (bad) return { ok: false, error: bad };
  const q = (s: string) => encodeURIComponent(s.toLowerCase());
  const list = (await fetchJson(`${API}/SafetyRatings/modelyear/${args.year}/make/${q(args.make)}/model/${q(args.model)}`)) as {
    Results?: { VehicleId: number; VehicleDescription: string }[];
  };
  const chosen = (list.Results ?? [])
    .filter((v) => !args.bodyStyle || bodyStyleOfDescription(v.VehicleDescription) === args.bodyStyle)
    .slice(0, VARIANT_CAP);

  const variants = await Promise.all(
    chosen.map(async (v) => {
      const d = ((await fetchJson(`${API}/SafetyRatings/VehicleId/${v.VehicleId}`)) as { Results?: Record<string, unknown>[] }).Results?.[0] ?? {};
      return {
        vehicleId: v.VehicleId,
        description: v.VehicleDescription,
        bodyStyle: bodyStyleOfDescription(v.VehicleDescription),
        overall: stars(d.OverallRating),
        frontCrash: stars(d.OverallFrontCrashRating),
        sideCrash: stars(d.OverallSideCrashRating),
        rollover: stars(d.RolloverRating),
      };
    }),
  );

  return {
    ok: true,
    make: args.make,
    model: args.model,
    year: args.year,
    variants,
    note: "NHTSA 5-Star Safety Ratings. null means NHTSA did not rate that test.",
  };
}
