// Cloudflare Turnstile's server-side check: is the token from a person, issued on our page?
// POST https://challenges.cloudflare.com/turnstile/v0/siteverify with secret, response and
// remoteip (Turnstile docs, server-side validation; tokens are one-use and valid 300 s).
// Any doubt refuses: a network error or another site's token is a "no".

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(opts: {
  secret: string;
  token: string;
  ip: string;
  hostnames: string[];
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  try {
    const res = await (opts.fetchImpl ?? fetch)(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret: opts.secret, response: opts.token, remoteip: opts.ip }),
      signal: AbortSignal.timeout(5000),
    });
    const out = (await res.json()) as { success?: boolean; hostname?: string };
    return out.success === true && typeof out.hostname === "string" && opts.hostnames.includes(out.hostname);
  } catch {
    return false;
  }
}
