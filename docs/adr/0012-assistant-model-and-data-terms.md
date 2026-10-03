# ADR-0012 — Assistant model, vendor and data terms

**Status:** Proposed (2026-10-04) — **not accepted**. D-218: the assistant stays off in every environment until this ADR is accepted, `assistant.provider` is set to its choice and the evaluation gate of D-306 passes.

## Context
U5.B5 adds a customer assistant (D-304) that answers through seven permission-checked tools and must never state a fact no tool returned. The backend is built against a provider-neutral port (`AssistantModel`) with a deterministic fake used by tests, `pnpm dev` and the evaluation harness. Two vendor choices are open: the **chat model** (tool calling, Thai) and the **embedding model** for help search (pgvector, `vector(1536)`, ADR-0001). What goes to a vendor: the customer's message, the system prompt, tool definitions and tool results (style names, quotation prices, the customer's own order status) — personal data under PDPA when the message or an order carries it.

## Options — chat model
| Option | Notes |
|---|---|
| **A. Anthropic Claude via the Claude API** (`@anthropic-ai/sdk`) — `claude-opus-5` (list $5 / $25 per M input / output tokens), `claude-sonnet-5` ($2 / $10) or `claude-haiku-4-5` ($1 / $5) | Native tool use (`tool_use` / `tool_result`), `strict: true` tool schemas, effort control (`output_config.effort`, `low` for chat cost), prompt caching for the fixed system prompt and tools, server-side refusal fallbacks. API inputs are not used for training by default; retention per the commercial terms (zero-data-retention needs a separate agreement). Cross-border transfer (US processing; `inference_geo` where offered). |
| B. Claude through a cloud provider (Amazon Bedrock / Google Vertex AI) | Same models under the cloud provider's data terms and regions (an Asia-Pacific region may simplify the PDPA assessment); some features differ per platform. |
| C. Another vendor or a self-hosted model | Requires its own Thai evaluation; no change to the port. |

## Options — embeddings
The Claude API has no embedding endpoint: help search needs a separate provider (a hosted embedding API with a 1536-dimension model, or a self-hosted multilingual model). Until chosen, the fake embedding (hashed bag of words) indexes articles so the pipeline is testable.

## Proposed decision (for acceptance by the business, Legal and the data protection officer)
- Chat: **option A**, model per `assistant.model` (proposed `claude-sonnet-5` at `low` effort for cost, re-evaluated against `claude-opus-5` with the harness), API terms without training on customer data, a PDPA cross-border transfer assessment and a data processing agreement signed **before** `assistant.provider` is set.
- Embeddings: decided with the chat vendor; same data terms.
- Logs stay in Packio's database only (`assistant_turns`, `assistant.log_retention_days`, opt-out D-305).

## Consequences
- Enabling needs, in order: this ADR accepted → DPA and transfer assessment on file → `assistant.provider` / `assistant.model` / `assistant.session_cost_ceiling_usd` / `assistant.eval_min_pass_rate_pct` set → an evaluation run of that provider passing the gate (D-306) → the flag.
- A real adapter is added only after acceptance (the port, fake and harness are in place); switching vendors is an adapter plus a fresh evaluation run, no change to the tools or guardrails.
