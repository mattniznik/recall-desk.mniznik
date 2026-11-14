// search_catalog: the fictional store's parts, filtered to one vehicle.
//
// The rule this tool exists for: a part "fits" only when the catalog lists that exact
// make, model, year and body style. A part listed for the model and year but for
// specific body styles comes back as "needs_body_style" while the body style is
// unknown, so the agent asks for it (or for the VIN) instead of guessing. A part for a
// different body style is not returned at all.

import catalogJson from "../../data/catalog.json" with { type: "json" };

import { checkName, checkYear, type BodyStyle, type Failure } from "./nhtsa.ts";
import type { Catalog } from "../../scripts/build-catalog.ts";

const catalog = catalogJson as Catalog;

export type CatalogHit = {
  sku: string;
  name: string;
  price: number;
  fit: "confirmed" | "needs_body_style";
  bodies: BodyStyle[];
  years: string;
};

export type CatalogSearch = { ok: true; query: string; vehicle: string; parts: CatalogHit[]; note: string };

const QUERY = /^[A-Za-z0-9][A-Za-z0-9 \-]{0,59}$/;
const RESULT_CAP = 10;

// "pads" should find "pad" and the other way round; nothing smarter is needed for a
// catalog of short names.
const words = (s: string) =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

export function searchCatalog(args: {
  part: string;
  make: string;
  model: string;
  year: number;
  bodyStyle?: BodyStyle;
}): CatalogSearch | Failure {
  const bad =
    (QUERY.test(args.part ?? "") ? null : `"${args.part}" is not a part name to search for.`) ??
    checkName("make", args.make) ??
    checkName("model", args.model) ??
    checkYear(args.year);
  if (bad) return { ok: false, error: bad };

  const wanted = words(args.part);
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const parts = catalog.parts
    .filter((p) => same(p.fits.make, args.make) && same(p.fits.model, args.model))
    .filter((p) => args.year >= p.fits.years[0] && args.year <= p.fits.years[1])
    .filter((p) => !args.bodyStyle || p.fits.bodies.includes(args.bodyStyle))
    .filter((p) => {
      const have = words(p.name);
      return wanted.every((w) => have.includes(w));
    })
    .slice(0, RESULT_CAP)
    .map((p) => ({
      sku: p.sku,
      name: p.name,
      price: p.price,
      fit: args.bodyStyle ? ("confirmed" as const) : ("needs_body_style" as const),
      bodies: p.fits.bodies,
      years: `${p.fits.years[0]}-${p.fits.years[1]}`,
    }));

  return {
    ok: true,
    query: args.part,
    vehicle: `${args.year} ${args.make} ${args.model}${args.bodyStyle ? ` ${args.bodyStyle}` : ""}`,
    parts,
    note: "Fitment data is invented for this demo. A part is confirmed only for the exact model, year and body style listed.",
  };
}
