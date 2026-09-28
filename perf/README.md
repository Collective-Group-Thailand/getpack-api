# Load tests (k6)

Scripts for the B6.3 performance readiness: `browse-quote.js`, `checkout.js`, `partner-updates.js`, with their
targets in `targets.js` and a payload template in `payloads/`. They run with the [k6](https://k6.io) binary against
the UAT / load stack only — never production. How to prepare data, run them and read the results:
`docs/launch/PERFORMANCE.md`.
