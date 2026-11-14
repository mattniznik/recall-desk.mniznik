// Bundle the Lambda handler into one ES module.
//
//   npm run build:lambda      -> dist/lambda/index.mjs (Lambda handler: index.handler)
//
// Rolldown, which Vite already installed, so no new dependency. The AWS SDK stays out: every
// Lambda Node.js runtime includes v3 (Lambda docs, "Runtime-included SDK versions"). The
// banner gives bundled CommonJS code a `require`, which an ES module does not have.

import { rolldown } from "rolldown";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const bundle = await rolldown({
  input: join(ROOT, "src", "lambda", "handler.ts"),
  platform: "node",
  external: [/^@aws-sdk\//],
});
await bundle.write({
  file: join(ROOT, "dist", "lambda", "index.mjs"),
  format: "esm",
  // One file: the handler's dynamic imports would otherwise split it into chunks.
  codeSplitting: false,
  banner: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
});
await bundle.close();
console.log("built dist/lambda/index.mjs");
