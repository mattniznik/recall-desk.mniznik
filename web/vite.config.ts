// The page builds to static files that S3 serves behind CloudFront (PLAN.md section 5).
// It imports a few modules from ../src (the store name, and later the trace types), so
// the dev server is allowed to read the folder above web/.
//
// Local preview (`npm run web:dev`, Mat 2026-11-14: "let me see it locally first before
// deploying"): a fake /api, dev server only (`apply: "serve"`), never in the build. It answers
// /api/status as live and plays a recorded real run back for /api/ask, one event every
// 450 ms like the live stream, so the chat can be seen working without calling the model or
// spending anything. PREVIEW_LIVE=0 shows the page as it is while live answers are off.

import { readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

import { bootScript } from "./src/studio/boot.ts";
import { STORAGE_KEY } from "./src/studio/choice.ts";
import { PRESETS } from "./src/studio/presets.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The real recorded run asked exactly this question; null when there is none. One scripted
// exception: "guess a recall" plays the run where the citation rule catches a made-up recall.
const RECORDED = new Map(
  readdirSync(new URL("./src/replays/", import.meta.url))
    .filter((f) => f.startsWith("real-") && f.endsWith(".json"))
    .map((f) => [JSON.parse(readFileSync(new URL(`./src/replays/${f}`, import.meta.url), "utf8")).question as string, f.slice(0, -5)]),
);
function replayFor(question: string): string | null {
  if (question.toLowerCase().includes("guess")) return "guard";
  return RECORDED.get(question.trim()) ?? null;
}

function previewApi(): Plugin {
  return {
    name: "recall-desk-preview-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url === "/api/status") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ live: process.env.PREVIEW_LIVE !== "0", perVisitorPerDay: 5 }));
          return;
        }
        if (req.url === "/api/ask" && req.method === "POST") {
          let body = "";
          for await (const chunk of req) body += chunk;
          const question = String((JSON.parse(body || "{}") as { question?: string }).question ?? "");
          const name = replayFor(question);
          res.setHeader("content-type", "application/x-ndjson");
          const send = (e: unknown) => res.write(JSON.stringify(e) + "\n");
          if (!name) {
            send({ type: "error", code: "failed", message: "Local preview: no recorded run for this question. On the live site it runs for real against NHTSA." });
            res.end();
            return;
          }
          const replay = JSON.parse(readFileSync(new URL(`./src/replays/${name}.json`, import.meta.url), "utf8"));
          send({ type: "start", left: 4 });
          for (const e of replay.events) {
            await sleep(450);
            send(e);
          }
          const count = (t: string) => replay.events.filter((e: { type: string }) => e.type === t).length;
          send({
            type: "done",
            status: replay.status,
            costUsd: replay.costUsd ?? null,
            tokens: replay.tokens ?? { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
            modelCalls: count("model_call"),
            toolCalls: count("tool_call"),
            seconds: replay.seconds ?? 0,
          });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// The Studio's boot script, inline in index.html so it runs before any bundle: it paints the
// visitor's background and hides the page until it has rendered (src/studio/boot.ts). Made from
// the presets at build time, so the page and the script cannot disagree on a palette.
function studioBoot(): Plugin {
  return {
    name: "recall-desk-studio-boot",
    transformIndexHtml(html) {
      if (!html.includes("/*studio-boot*/")) throw new Error("index.html lost its /*studio-boot*/ placeholder");
      return html.replace("/*studio-boot*/", () => bootScript(PRESETS, STORAGE_KEY));
    },
  };
}

export default defineConfig({
  plugins: [react(), previewApi(), studioBoot()],
  server: { fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
