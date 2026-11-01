# Shelf — AI Companion

## Contract

AI is optional. Reading, progress, and annotations work when all providers are unavailable. The PDF is authoritative; generated text is untrusted until validated against the exact request context.

## Initial tasks

- Explain a selected passage.
- Ask about a selection, the current page, or bounded current-document context.
- Summarize a page or selected section.
- Translate selected text/page.
- Analyze an argument or compare two explicitly supplied passages.

Defer broad multi-document retrieval until reliable single-document grounding exists.

## Local and cloud providers

Support both:
- Local providers such as Ollama and other verified local runtimes.
- Cloud providers through explicit provider adapters.

Provider/model selection is available per task. Automatic routing considers capabilities, configured providers, privacy mode, connectivity, and resource limits. An explicit user selection always wins.

Capability metadata includes context size, streaming, structured output, cancellation, reasoning support, and parameter compatibility. Do not assume compatible APIs behave identically. Credentials stay in a trusted backend/native secure store and never reach browser JavaScript or logs.

## Context assembly

Build bounded context in this order:
1. Exact selection, when present.
2. Current page and nearby paragraphs.
3. Explicit user-selected page/section range.
4. Relevant outline entries and user annotations.
5. Later: local page-aware retrieval.

Keep source text separate from user notes and previous model responses. Tag every segment with stable source/document/page/segment IDs. Never send a whole book for a one-paragraph explanation. Enforce byte/token budgets and disclose truncation.

## Citation contract

Structured responses carry source IDs. Validate each ID against the exact request context.

A citation marked verified must resolve to an existing document, valid page, supplied text segment, and stable anchor/excerpt. Unknown, invented, out-of-range, or required-but-missing references must not be shown as verified. Do not silently turn malformed structured alignment into an ungrounded answer.

## Streaming and job lifecycle

Track queued/running/completed/failed/cancelled with job ID, task, provider/model (non-secret), source manifest, timestamps, and bounded progress.

- Propagate cancellation through UI, network, and provider adapters.
- Hiding the AI panel does not cancel; explicit Stop does.
- Ignore late events after a terminal state.
- Prevent stale output from appearing after the reader changes document or page.
- An incomplete stream is never complete.

## Translation quality

Preserve negation, qualifiers, numbers, names, formulas, citations, terminology, paragraph order, and alignment. Maintain reviewed technical/philosophical/general fixtures.

Deterministic checks can detect structural failures; human review is still required for semantic fidelity. Model self-scores are not proof.

## Privacy modes

- **Offline-only:** block remote discovery and inference.
- **Local-first:** local inference allowed; remote use requires explicit consent/policy.
- **Cloud-enabled:** configured remote providers allowed with clear disclosure of provider, model, and context scope.

Never upload the entire document by default.

## Boundary

Shelf owns its task, context, citation, and job contracts. Provider implementations stay behind adapters and never live in React components.
