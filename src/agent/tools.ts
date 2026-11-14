// The tools as the model sees them: a name, a description, an input schema, and the
// function that runs. Shared by the agent loop and the ask CLI, so both run exactly the
// same code. Every tool validates its own input, so the schemas here describe the
// arguments for the model rather than guard them; only submit_answer is strict, because
// its fields are what the rules check.

import type { Deps } from "../tools/http.ts";
import { decodeVehicle, getRecalls, getSafetyRating, listModels, searchComplaints } from "../tools/nhtsa.ts";
import { searchCatalog } from "../tools/catalog.ts";
import { createHandoff, HANDOFF_REASONS } from "../tools/handoff.ts";
import { SUBMIT_ANSWER_TOOL } from "./answer-schema.ts";

type Args = Record<string, unknown>;

// Arguments come from the model (or the command line) untyped. The casts only hand them
// through; the tool checks them and answers { ok: false, error } when they are wrong.
export const TOOLS: Record<string, (a: Args, d: Deps) => Promise<unknown> | unknown> = {
  decode_vehicle: (a, d) => decodeVehicle(String(a.vin ?? ""), d),
  list_models: (a, d) => listModels(a as never, d),
  get_recalls: (a, d) => getRecalls(a as never, d),
  search_complaints: (a, d) => searchComplaints(a as never, d),
  get_safety_rating: (a, d) => getSafetyRating(a as never, d),
  search_catalog: (a) => searchCatalog(a as never),
  create_handoff: (a) => createHandoff(a as never),
};

export async function runTool(name: string, args: Args, deps: Deps): Promise<unknown> {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`unknown tool "${name}". Tools: ${Object.keys(TOOLS).join(", ")}`);
  return tool(args, deps);
}

const BODY_STYLES = ["sedan", "coupe", "hatchback", "convertible", "wagon", "suv", "pickup", "van", "other"];

const str = (description: string) => ({ type: "string", description });
const vehicle = {
  make: str("Make as NHTSA writes it, e.g. Honda."),
  model: str("Model as NHTSA writes it, e.g. Civic or Civic Type R. Use list_models when unsure."),
  year: { type: "integer", description: "Model year, e.g. 2017." },
};
const bodyStyle = { type: "string", enum: BODY_STYLES, description: "Only when the VIN or the customer has settled it." };
const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required });

export type ToolDef = { name: string; description: string; input_schema: Record<string, unknown>; strict?: boolean };

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "decode_vehicle",
    description: "Decode a 17-character VIN into make, model, year, trim and body style. Use it whenever the customer gives a VIN.",
    input_schema: schema({ vin: str("The VIN, 17 characters.") }, ["vin"]),
  },
  {
    name: "list_models",
    description: "List NHTSA's model names for a make and year, narrowed by a search word. Use it to find the exact model name.",
    input_schema: schema({ make: vehicle.make, year: vehicle.year, query: str("A word in the model name, e.g. civic.") }, ["make", "year"]),
  },
  {
    name: "get_recalls",
    description: "NHTSA recalls for a make, model and year. The only source of recall campaign numbers you may cite.",
    input_schema: schema(vehicle, ["make", "model", "year"]),
  },
  {
    name: "search_complaints",
    description: "Owners' complaints to NHTSA for a vehicle: totals, top components, and the 5 newest matching ones. Complaints are not recalls.",
    input_schema: schema({ ...vehicle, component: str("NHTSA component name or part of one, e.g. SERVICE BRAKES or brake.") }, ["make", "model", "year"]),
  },
  {
    name: "get_safety_rating",
    description: "NHTSA 5-Star Safety Ratings for each variant of a vehicle.",
    input_schema: schema({ ...vehicle, bodyStyle }, ["make", "model", "year"]),
  },
  {
    name: "search_catalog",
    description: "Search the store's parts catalog for a vehicle. A part is confirmed only when the body style is given and listed.",
    input_schema: schema({ part: str("What the customer needs, e.g. front brake pads."), ...vehicle, bodyStyle }, ["part", "make", "model", "year"]),
  },
  {
    name: "create_handoff",
    description: "Pass the customer to a person. Use it for refunds, orders, an upset customer, a request for a person, or anything you cannot answer from your tools.",
    input_schema: schema({ reason: { type: "string", enum: [...HANDOFF_REASONS] }, summary: str("What the person needs to know, 1-600 characters.") }, ["reason", "summary"]),
  },
  SUBMIT_ANSWER_TOOL as unknown as ToolDef,
];
