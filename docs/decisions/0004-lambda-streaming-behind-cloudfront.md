# 0004. A Lambda function URL with response streaming, behind CloudFront with origin access control

**Status:** infrastructure live since 2026-11-13, function code deployed 2026-11-14; first commit pending. Sources
read 2026-11-13 and 2026-11-14.

## Decision

One CloudFront distribution serves `recall-desk.mniznik.com`. `/*` comes from a private S3 bucket (the built
page). `/api/*` goes, uncached, to a Lambda function URL with `AuthType` `AWS_IAM` and invoke mode
`RESPONSE_STREAM`, signed by a CloudFront origin access control, so only this distribution can call it. The
function (Node.js 22, 256 MB, 60-second timeout) writes each trace event to the response as one line of JSON as
the agent works. The page computes the SHA-256 of each request body in the browser and sends it in
`x-amz-content-sha256`. Page and API share one origin, so there is no CORS setup and no second hostname.

The handler is glue only ([src/lambda/handler.ts](../../src/lambda/handler.ts)); every decision is in
[src/server/ask.ts](../../src/server/ask.ts). It is bundled into one file by
[scripts/build-lambda.ts](../../scripts/build-lambda.ts) with the AWS SDK left out, because the Lambda Node.js
runtime includes it. The infrastructure is Terraform kept in a private repository; [docs/DEPLOY.md](../DEPLOY.md)
describes it at the level of services.

## Sources

[Lambda response streaming](https://docs.aws.amazon.com/lambda/latest/dg/configuration-response-streaming.html):

- "Lambda supports response streaming on Node.js managed runtimes. For other languages, including Python, you can
  use a custom runtime with a custom Runtime API integration to stream responses or use the Lambda Web Adapter."
- "Streaming responses incur cost and streamed responses are not interrupted or stopped when the invoking client
  connection is broken. Customers are billed for the full function duration, so customers should exercise caution
  when configuring long function timeouts." Hence the 60-second timeout, and the 45-second deadline inside it.
- "The streaming rate for the first 6 MB of your function's response is uncapped." A run streams a few KB.
- "Your Lambda function can also stream response payloads through the Amazon API Gateway proxy integration".

[Restrict access to a Lambda function URL origin](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html):

- "To use OAC, you must specify `AWS_IAM` as the value for the `AuthType` parameter."
- "If you use `PUT` or `POST` methods with your Lambda function URL, your users must compute the SHA256 of the body
  and include the payload hash value of the request body in the `x-amz-content-sha256` header when sending the
  request to CloudFront. Lambda doesn't support unsigned payloads."
- On the permission: "The `Condition` element in the policy allows CloudFront to access Lambda *only* when the
  request is on behalf of the CloudFront distribution that contains the Lambda function URL."

Lambda pricing (read 2026-11-13): the free tier covers 1 million requests and 400,000 GB-seconds a month. A live
run is mostly waiting on the model.

## Evidence (this repository)

- Measured on the live address: the function URL called directly answers 403 (2026-11-13); a POST to `/api/ask`
  without the body hash answers 403 (2026-11-14, n=1); `GET /api/status` answers 200 with
  `{"live":false,"perVisitorPerDay":5}` while no key is set (2026-11-14); a POST with the body hash and a fake
  Turnstile token answers 200, `application/x-ndjson`, one `bot_check` event (2026-11-14, n=1). So a signed POST
  reaches the function, the function reads its secrets and Cloudflare is asked.
- The browser's SHA-256 matches Node's for the same text ([test/web-chat.test.ts](../../test/web-chat.test.ts)).
- The bundle builds, loads as an ES module and routes: unknown paths get 404, a broken chat request gets an error
  event rather than a crash ([test/lambda-bundle.test.ts](../../test/lambda-bundle.test.ts)). The built file is
  1,243,769 bytes (Linux build of the current code, 2026-11-14); zipped for upload it was 240 KB at the
  2026-11-14 deploy.
- The real runs took 3.3 to 16.3 seconds (n=6) and a two-car comparison 16.8 s (n=1), well inside 45.

## Rejected

- **API Gateway in front of Lambda.** It can stream through its proxy integration too, but it is one more service
  with its own per-request price, and nothing here needs its features (API keys, usage plans, request mapping).
- **A buffered reply with the whole trace at the end.** The trace panel is the point of the demo; a 16-second wait
  with nothing on screen hides it. It stays the fallback if streaming through CloudFront ever fails.
- **WebSockets or server-sent events.** One POST per question is enough, and the function URL streams natively.
- **Always-on compute (EC2, containers).** Traffic is a few clicks and then nothing for days; an idle server costs
  money every hour and needs patching. Lambda costs nothing while idle.
- **The key in a Lambda environment variable.** Anyone who can read the function's configuration could read it,
  and infrastructure code that set it would leave it in plain text in its state. It lives in Parameter Store
  instead ([SECURITY.md](../../SECURITY.md)).
- **Cloudflare Workers, as the sister project [rag.irs.mniznik](https://github.com/mattniznik/rag.irs.mniznik)
  uses.** That project needed SQLite full-text search and vectors next to its code. This one was built to show an
  agent on AWS, with every resource in Terraform, and its streaming design follows the Lambda docs above. The two
  platforms were not measured against each other for this agent.

## What would change it

A full live run that does not arrive event by event through CloudFront (so far only a one-event reply has been
seen through the public address): then try the API Gateway proxy integration, or fall back to a buffered reply.
Traffic beyond 10 parallel runs, the account's concurrency limit ([SECURITY.md](../../SECURITY.md), known gaps).
