// Build data/catalog.json, the fictional store's parts catalog.
//
//   npm run catalog:build
//
// Everything here is invented: part numbers, prices and fitment. It stands in for the
// store's own product system, the thing a forward-deployed engineer connects an agent
// to. It is generated from two small tables instead of written by hand, so a reviewer
// reads the tables, and a test checks the committed file still matches them.
//
// Vehicle makes and models are real, because the recall data is. No retailer's name,
// part numbers or prices are used.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { BodyStyle } from "../src/tools/nhtsa.ts";

export type Part = {
  sku: string;
  name: string;
  price: number;
  fits: { make: string; model: string; years: [number, number]; bodies: BodyStyle[] };
};

export type Catalog = { note: string; parts: Part[] };

const CATEGORIES: { key: string; name: string; base: number; onlyBodies?: BodyStyle[] }[] = [
  { key: "BRK-F", name: "Front brake pads, ceramic", base: 42 },
  { key: "BRK-R", name: "Rear brake pads, ceramic", base: 38 },
  { key: "ROT-F", name: "Front brake rotor", base: 64 },
  { key: "ROT-R", name: "Rear brake rotor", base: 54 },
  { key: "WIP-F", name: "Front wiper blade set", base: 24 },
  { key: "WIP-R", name: "Rear wiper blade", base: 12, onlyBodies: ["hatchback", "suv", "wagon"] },
  { key: "FLT-C", name: "Cabin air filter", base: 16 },
  { key: "FLT-E", name: "Engine air filter", base: 19 },
  { key: "FLT-O", name: "Oil filter", base: 8 },
  { key: "PLG", name: "Spark plug set", base: 34 },
  { key: "BAT", name: "12V battery", base: 159 },
  { key: "BLB-H", name: "Headlight bulb pair", base: 29 },
];

// The Civic is split on purpose: sedan and coupe share parts, the hatchback has its own,
// and the Type R is a separate model. That split is what the fitment rule is tested on.
const GROUPS: { key: string; make: string; model: string; years: [number, number]; bodies: BodyStyle[]; factor: number }[] = [
  { key: "CIV-SC", make: "Honda", model: "Civic", years: [2016, 2021], bodies: ["sedan", "coupe"], factor: 1 },
  { key: "CIV-HB", make: "Honda", model: "Civic", years: [2017, 2021], bodies: ["hatchback"], factor: 1.05 },
  { key: "CTR", make: "Honda", model: "Civic Type R", years: [2017, 2021], bodies: ["hatchback"], factor: 1.8 },
  { key: "ACC", make: "Honda", model: "Accord", years: [2018, 2022], bodies: ["sedan"], factor: 1.15 },
  { key: "CRV", make: "Honda", model: "CR-V", years: [2017, 2022], bodies: ["suv"], factor: 1.2 },
  { key: "RNG", make: "Ford", model: "Ranger", years: [2006, 2011], bodies: ["pickup"], factor: 1.1 },
  { key: "F150", make: "Ford", model: "F-150", years: [2015, 2020], bodies: ["pickup"], factor: 1.3 },
  { key: "TUC", make: "Hyundai", model: "Tucson", years: [2016, 2021], bodies: ["suv"], factor: 1.15 },
];

export function buildCatalog(): Catalog {
  const parts: Part[] = [];
  for (const g of GROUPS) {
    for (const c of CATEGORIES) {
      if (c.onlyBodies && !g.bodies.some((b) => c.onlyBodies!.includes(b))) continue;
      parts.push({
        sku: `DP-${c.key}-${g.key}`,
        name: c.name,
        price: Math.floor(c.base * g.factor) + 0.99,
        fits: { make: g.make, model: g.model, years: g.years, bodies: g.bodies },
      });
    }
  }
  return { note: "Fictional catalog for a demo. Part numbers, prices and fitment are invented.", parts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(import.meta.dirname, "..", "data", "catalog.json");
  const catalog = buildCatalog();
  writeFileSync(out, JSON.stringify(catalog, null, 2) + "\n");
  console.log(`${catalog.parts.length} parts -> ${out}`);
}
