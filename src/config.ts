// Settings shared by the tools, the agent, the Lambda handler and the page.
//
// The store is fictional and has no brand: Mat chose the plain "Auto Parts Store" on
// 2026-11-13 so no real retailer's name can appear, and dropped the "(fictional)" suffix the
// same day (PLAN.md D4). The system prompt still tells the model the store is fictional.

export const STORE_NAME = "Auto Parts Store";

// Cloudflare Turnstile widget "recall-desk" (domain recall-desk.mniznik.com), created
// 2026-11-14. A site key is public by design; its secret lives only in Parameter Store.
export const TURNSTILE_SITE_KEY = "0x4AAAAAAGAjHfIX90QxLugf";
