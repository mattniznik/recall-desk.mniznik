// Settings shared by the tools, the agent, the Lambda handler and the page.
//
// The store is fictional and has no brand: the plain "Auto Parts Store" (chosen 2026-11-13)
// means no real retailer's name can appear, and the "(fictional)" suffix was dropped the same
// day. The system prompt still tells the model the store is fictional.

export const STORE_NAME = "Auto Parts Store";

// Cloudflare Turnstile widget "recall-desk" (domain recall-desk.mniznik.com), created
// 2026-11-14. A site key is public by design; its secret lives only in Parameter Store.
export const TURNSTILE_SITE_KEY = "0x4AAAAAAGAjHfIX90QxLugf";
