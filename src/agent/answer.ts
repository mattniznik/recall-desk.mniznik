// The shape of the agent's final answer, as the submit_answer tool delivers it.
//
// The answer is structured so code can check it: every claim that matters (a recall
// cited, a recall said to apply, a part said to fit, a handoff) is a field, not a
// phrase buried in prose. The JSON schema the model is given lives beside this in the
// submit_answer step; this file is the type everything else agrees on.

export type Answer = {
  // What the customer reads.
  text: string;
  // Every recall campaign number the answer mentions.
  cited_recall_ids: string[];
  // Campaign numbers the answer says apply to the customer's vehicle.
  applies_to_vehicle: string[];
  // Catalog SKUs the answer says fit the customer's vehicle.
  fits: string[];
  // Whether the answer hands the customer to a person.
  handoff: boolean;
};
