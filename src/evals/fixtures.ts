// The fetchJson the evals run on: the recordings in fixtures/nhtsa, plus two things the
// recordings alone cannot do.
//
// 1. Full VINs. The recorded decodes are partial VINs (positions 1-8, `*` for the check
//    digit, then the model-year and plant codes; scripts/record-fixtures.ts), so no real
//    car's VIN is in the repo. decode_vehicle asks for the full 17 characters, so a full
//    VIN is looked up under its partial form. The partial form keeps every position vPIC
//    uses for make, model, year and body.
// 2. A planted complaint. One eval case needs an instruction planted in
//    complaint text. None of the 606 recorded 2017 Civic complaints carries one,
//    so that case adds one invented complaint to the reply in memory, for that case only.
//    The files on disk are never changed.

import type { PlantedComplaint } from "./cases.ts";
import type { FetchJson } from "../tools/http.ts";
import { recordedFetch } from "../tools/recorded.ts";

const VIN_DECODE = /\/DecodeVinValues\/([A-HJ-NPR-Z0-9]{17})\?format=json$/;
const COMPLAINTS = "https://api.nhtsa.gov/complaints/complaintsByVehicle";

// An ODI number NHTSA has not used, so the planted complaint can never pass for a real one.
export const PLANTED_ODI = 99999999;

export function recordingUrl(url: string): string {
  const m = VIN_DECODE.exec(url);
  if (!m) return url;
  const vin = m[1];
  return url.replace(vin, `${vin.slice(0, 8)}*${vin.slice(9, 11)}`);
}

export function evalFetch(opts: { plant?: PlantedComplaint; base?: FetchJson } = {}): FetchJson {
  const base = opts.base ?? recordedFetch();
  return async (url) => {
    const reply = await base(recordingUrl(url));
    const p = opts.plant;
    if (!p || !url.startsWith(COMPLAINTS)) return reply;
    const q = new URL(url).searchParams;
    const same = q.get("make") === p.make.toLowerCase() && q.get("model") === p.model.toLowerCase() && q.get("modelYear") === String(p.year);
    if (!same) return reply;
    const body = reply as { results?: unknown[] };
    const planted = {
      odiNumber: PLANTED_ODI,
      crash: false,
      fire: false,
      numberOfInjuries: 0,
      numberOfDeaths: 0,
      dateComplaintFiled: p.filed,
      components: p.components,
      summary: p.summary,
    };
    return { ...body, results: [planted, ...(body.results ?? [])] };
  };
}
