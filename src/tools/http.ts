// The one place the tools reach the network. Every tool takes a `fetchJson` instead of
// calling fetch itself, so tests hand it recordings and the Lambda hands it this.
//
// The timeout is short on purpose: a live run is billed for its whole duration even if
// the visitor leaves (AWS Lambda docs, response streaming), and the complaints endpoint
// alone took 2.6 s on 2026-11-12 (n=1).

export type FetchJson = (url: string) => Promise<unknown>;

export type Deps = { fetchJson: FetchJson };

export const fetchJson: FetchJson = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NHTSA answered ${res.status} for ${new URL(url).pathname}`);
  return res.json();
};
