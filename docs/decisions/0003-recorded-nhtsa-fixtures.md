# 0003. Tests and evals run on recorded NHTSA replies

**Status:** in use since 2026-11-13; recordings dated 2026-11-14 01:21 UTC; first commit pending. Sources read
2026-11-12 to 2026-11-14.

## Decision

[fixtures/nhtsa/](../../fixtures/nhtsa/) holds NHTSA's replies as NHTSA sent them, with one change: the `vin`
field is removed from every complaint before it is written, so the public repository never holds a VIN. The
[manifest](../../fixtures/nhtsa/manifest.json) maps each exact request URL to its file and dates the recording.
[src/tools/recorded.ts](../../src/tools/recorded.ts) answers from those files by URL, and a URL that was never
recorded is an error, never a quiet call to the live API.

Every tool takes its `fetchJson` as an argument ([src/tools/http.ts](../../src/tools/http.ts) is the only code that
reaches the network). Tests and evals hand the tools the recordings; the live chat hands them the network.
`npm run fixtures:refresh` ([scripts/record-fixtures.ts](../../scripts/record-fixtures.ts)) re-records on purpose,
as a change of its own.

## Sources

NHTSA's public APIs need no key: the VIN decoder, model list, recalls, complaints and safety ratings endpoints each
answered HTTP 200 without one (2026-11-12, n=1 each). Their replies are the source, and they are what makes a
recording necessary:

- NHTSA keeps adding recalls to old cars. The 2017 Honda Civic's list includes 26V332000, a 2026 campaign, whose
  summary covers "2017-2021 Civic hatchback, 2016-2020 Civic coupe, 2016-2022 Civic". Against live data a moved
  score could mean a new recall, not a better agent.
- The facts the rules depend on are written in prose that a hand-made stub would not reproduce. 17V706000 covers
  "certain 2017 Honda Civic Sedan and Coupe vehicles"; 17V787000 covers "certain 2004-2006 Ford Ranger trucks".
  The second one broke a rule (see [README, What failed](../../README.md#what-failed-and-what-fixed-it)), and only
  a real reply would have shown it.
- Complaint dates come as MM/DD/YYYY (the first part never above 12 and the second never above 31, n=606), and the
  raw complaints reply for one car is 577,432 bytes; both shaped how `search_complaints` was written.

## Evidence (this repository)

- 11 recordings plus the manifest, 744,509 bytes in all: recalls for a 2017 Honda Civic, a 2006 Ford Ranger
  (4 "park it" recalls) and a 2019 Hyundai Tucson (a "park outside" recall), the Civic's 606 complaints, its
  safety ratings and three rated variants, Honda's 2017 model list, and two partial VINs that decode to a Civic
  sedan and a Civic hatchback (the check digit replaced by `*` and no serial number, so they name a model, not a
  car).
- 606 of 606 complaints carried a `vin` field in NHTSA's reply; 0 of 606 carry one in the recording.
- All 230 tests in `npm test` run offline (2026-11-14). [test/fixtures.test.ts](../../test/fixtures.test.ts)
  checks the manifest, the dates, that every listed file exists, and that no complaint holds a VIN;
  [test/ask.test.ts](../../test/ask.test.ts) checks that an unrecorded URL is an error.
- The eval set is built on the same recordings. Each of the 50 cases in [evals/cases.json](../../evals/cases.json)
  is answerable from them, the graders read their ground truth from them
  ([src/evals/grade.ts](../../src/evals/grade.ts)), and [test/eval-cases.test.ts](../../test/eval-cases.test.ts)
  checks every campaign a case names against its vehicle's recording. The one injection case adds an invented
  complaint in memory for that case only ([src/evals/fixtures.ts](../../src/evals/fixtures.ts)); a test checks
  the recording on disk is unchanged.
- The 6 real recorded runs used the recordings, so their only cost was the model and they can be compared
  ([README Results](../../README.md#results)).
- Live check, 2026-11-13 (n=1): the live API still returned 6 recalls, 606 complaints and 37 under SERVICE
  BRAKES for the 2017 Civic, and 4 "park it" recalls for the 2006 Ranger, the same as the recordings.

## Rejected

- **Live NHTSA in tests.** Results would depend on the day and on NHTSA being up, and CI would make network calls.
- **Hand-written stubs.** They encode the developer's idea of NHTSA's data. The recordings carry the real quirks:
  "Ranger trucks", body styles named only in prose, a VIN on every complaint.
- **Recording every question visitors ask.** Live visitors' questions and answers are not stored at all
  ([SECURITY.md](../../SECURITY.md)); the recorded runs on the page come from development.

## What would change it

The recordings age. Before an eval run that is meant to describe today's NHTSA data, refresh them in a change of
their own, run the eval set on both, and report the difference that comes from the data alone.
