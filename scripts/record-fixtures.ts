// Record NHTSA's replies into fixtures/nhtsa/ so tests and evals run on frozen data.
//
//   npm run fixtures:refresh
//
// Re-recording is a deliberate act, committed on its own: NHTSA adds recalls over time,
// and a moved eval score has to mean the agent changed, not the data. Every file is the
// reply as NHTSA sent it, with one exception: the `vin` field is removed from complaint
// records before they are written, so this public repo never holds a VIN.
//
// Vehicles are generic on purpose. The two VIN decodes use partial VINs with the check
// digit replaced by `*` and no serial number, which match a model, not a car.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "..", "fixtures", "nhtsa");
const API = "https://api.nhtsa.gov";
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";

type Recording = { key: string; file: string; url: string };

const recordings: Recording[] = [
  { key: "civic2017Recalls", file: "recalls-honda-civic-2017.json", url: `${API}/recalls/recallsByVehicle?make=honda&model=civic&modelYear=2017` },
  { key: "civic2017Complaints", file: "complaints-honda-civic-2017.json", url: `${API}/complaints/complaintsByVehicle?make=honda&model=civic&modelYear=2017` },
  { key: "civic2017Ratings", file: "ratings-honda-civic-2017.json", url: `${API}/SafetyRatings/modelyear/2017/make/honda/model/civic` },
  { key: "honda2017Models", file: "models-honda-2017.json", url: `${VPIC}/GetModelsForMakeYear/make/honda/modelyear/2017?format=json` },
  { key: "vinCivicSedan", file: "vin-19XFC2F5_HE.json", url: `${VPIC}/DecodeVinValues/19XFC2F5*HE?format=json` },
  { key: "vinCivicHatchback", file: "vin-SHHFK7H5_HU.json", url: `${VPIC}/DecodeVinValues/SHHFK7H5*HU?format=json` },
  // Safety-rule fixtures: a recall that says do not drive (parkIt) and one that says
  // park outside (parkOutSide). Found by probing candidates on 2026-11-13.
  { key: "ranger2006Recalls", file: "recalls-ford-ranger-2006.json", url: `${API}/recalls/recallsByVehicle?make=ford&model=ranger&modelYear=2006` },
  { key: "tucson2019Recalls", file: "recalls-hyundai-tucson-2019.json", url: `${API}/recalls/recallsByVehicle?make=hyundai&model=tucson&modelYear=2019` },
];

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(OUT, { recursive: true });
  const manifest = { recordedAt: new Date().toISOString(), files: {} as Record<string, { file: string; url: string }> };

  for (const r of recordings) {
    let body = await getJson(r.url);
    if (r.key === "civic2017Complaints") {
      const withVin = body.results.filter((c: object) => "vin" in c).length;
      body = { ...body, results: body.results.map(({ vin, ...rest }: { vin?: string }) => rest) };
      console.log(`  removed the vin field from ${withVin} of ${body.results.length} complaints`);
    }
    writeFileSync(join(OUT, r.file), JSON.stringify(body, null, 2) + "\n");
    manifest.files[r.key] = { file: r.file, url: r.url };
    console.log(`${r.file}  ${JSON.stringify(body).length} bytes`);
    await pause(300);
  }

  // Star ratings for every variant: the variant list above only carries ids, and the
  // ratings differ by body style (coupe, sedan, hatchback for a 2017 Civic).
  const variants: { VehicleId: number; VehicleDescription: string }[] = (await getJson(recordings[2].url)).Results ?? [];
  for (const v of variants) {
    const url = `${API}/SafetyRatings/VehicleId/${v.VehicleId}`;
    const file = `ratings-vehicle-${v.VehicleId}.json`;
    writeFileSync(join(OUT, file), JSON.stringify(await getJson(url), null, 2) + "\n");
    manifest.files[`civic2017Rating${v.VehicleId}`] = { file, url };
    console.log(`${file}  (variant: ${v.VehicleDescription})`);
    await pause(300);
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest: ${Object.keys(manifest.files).length} recordings at ${manifest.recordedAt}`);
}

await main();
