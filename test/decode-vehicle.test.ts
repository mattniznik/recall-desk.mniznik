// decode_vehicle turns a VIN into the few facts the agent needs, above all the body
// style: whether a recall applies to a 2017 Civic depends on it (17V706000 covers the
// Sedan and Coupe, 18V266000 the Hatchback and Type R). A malformed VIN is refused
// before anything is sent to NHTSA.

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeVehicle, isValidVin } from "../src/tools/nhtsa.ts";
import { fakeFetch, fixture } from "./helpers.ts";

// Made up for tests, never sent anywhere: the fake fetch answers instead of NHTSA.
const SEDAN_VIN = "19XFC2F5XHE000000";
const HATCH_VIN = "SHHFK7H5XHU000000";
const url = (vin: string) => `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`;

test("a VIN is 17 characters from the VIN alphabet, which has no I, O or Q", () => {
  assert.equal(isValidVin(SEDAN_VIN), true);
  assert.equal(isValidVin(" 19xfc2f5xhe000000 "), true, "case and spaces are forgiven");
  assert.equal(isValidVin(SEDAN_VIN.slice(1)), false, "16 characters");
  assert.equal(isValidVin("19XFC2F5XHE00000I"), false, "I");
  assert.equal(isValidVin("19XFC2F5XHE00000O"), false, "O");
  assert.equal(isValidVin("19XFC2F5XHE00000Q"), false, "Q");
  assert.equal(isValidVin(""), false);
});

test("a sedan VIN decodes to make, model, year and body style", async () => {
  const { fetchJson, calls } = fakeFetch({ [url(SEDAN_VIN)]: fixture("vin-19XFC2F5_HE.json") });
  const v = await decodeVehicle(SEDAN_VIN, { fetchJson });
  assert.deepEqual(v, {
    ok: true,
    make: "HONDA",
    model: "Civic",
    year: 2017,
    bodyClass: "Sedan/Saloon",
    bodyStyle: "sedan",
    trim: "LX",
  });
  assert.deepEqual(calls, [url(SEDAN_VIN)]);
});

test("a hatchback VIN decodes to body style hatchback", async () => {
  const { fetchJson } = fakeFetch({ [url(HATCH_VIN)]: fixture("vin-SHHFK7H5_HU.json") });
  const v = await decodeVehicle(HATCH_VIN, { fetchJson });
  assert.equal(v.ok && v.bodyStyle, "hatchback");
});

test("a malformed VIN is refused without calling NHTSA", async () => {
  const { fetchJson, calls } = fakeFetch({});
  const v = await decodeVehicle("19XFC2F5XHE00000O", { fetchJson });
  assert.equal(v.ok, false);
  assert.match(v.ok ? "" : v.error, /17 characters/);
  assert.equal(calls.length, 0);
});
