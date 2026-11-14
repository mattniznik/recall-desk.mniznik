// Routing and the Evals page's numbers. Plain functions, checked by node --test.
//
// An eval run is one version of the agent on one model over the whole case set (PLAN.md
// section 9). The page shows each run's pass rate, its pass rate per case type, and every
// failure with the reasons the graders gave. With no runs yet it says when they arrive
// instead of showing a number nobody measured.

export type Route = "ask" | "demo" | "evals";

export function routeOf(hash: string): Route {
  if (hash === "#/evals") return "evals";
  if (hash === "#/examples") return "demo";
  return "ask";
}

// The desk's tabs are hash routes ("#/", "#/examples", "#/evals"); the long page's section
// links (#how, #built) are anchors and must not switch the tab that is open.
export function routeFromHash(hash: string, previous: Route): Route {
  return hash === "" || hash === "#" || hash.startsWith("#/") ? routeOf(hash) : previous;
}

// What to show for a route once the page knows whether live answers are on. While they are
// off, the Ask route shows the recorded examples, so the landing page is never a dead end.
// null = not known yet.
export function pageFor(route: Route, live: boolean | null): Route {
  return route === "ask" && live === false ? "demo" : route;
}

export type EvalCaseResult = { id: string; type: string; passed: boolean; reasons: string[] };

export type EvalRun = {
  version: string;
  model: string;
  ranAt: string;
  cases: EvalCaseResult[];
  costUsd?: number;
};

export type RunRow = {
  label: string;
  ranAt: string;
  passed: number;
  total: number;
  rate: number;
  costUsd?: number;
  byType: { type: string; passed: number; total: number }[];
  failures: EvalCaseResult[];
};

export function summarize(runs: EvalRun[]): RunRow[] {
  return [...runs]
    .sort((a, b) => b.ranAt.localeCompare(a.ranAt))
    .map((r) => {
      const passed = r.cases.filter((c) => c.passed).length;
      const types = new Map<string, { passed: number; total: number }>();
      for (const c of r.cases) {
        const t = types.get(c.type) ?? { passed: 0, total: 0 };
        t.total++;
        if (c.passed) t.passed++;
        types.set(c.type, t);
      }
      return {
        label: `${r.version} · ${r.model}`,
        ranAt: r.ranAt,
        passed,
        total: r.cases.length,
        rate: r.cases.length ? Math.round((passed / r.cases.length) * 100) : 0,
        costUsd: r.costUsd,
        byType: [...types].sort((a, b) => a[0].localeCompare(b[0])).map(([type, t]) => ({ type, ...t })),
        failures: r.cases.filter((c) => !c.passed),
      };
    });
}

export type EvalsView = { state: "empty"; message: string } | { state: "results"; rows: RunRow[] };

export function evalsView(runs: EvalRun[]): EvalsView {
  if (runs.length === 0) {
    return {
      state: "empty",
      message:
        "No eval run yet. The case set (recall lookups, body-style checks, honest no-recall answers, fit refusals, " +
        "safety warnings, handoffs, injection attempts) runs in milestone 3, on recorded NHTSA data, and every result lands here.",
    };
  }
  return { state: "results", rows: summarize(runs) };
}
