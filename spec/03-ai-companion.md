# Shelf — AI Companion

## Contract
AI is optional. Reader, progress, and annotations work when providers are unavailable. The PDF is authoritative; generated text is untrusted until validated against the exact request context.

## Initial tasks
Explain a selection; ask about a selection/page/current document; summarize a page or bounded section; translate selected text/page; analyze an argument or compare two supplied passages. Defer broad multi-book retrieval until reliable single-document grounding exists.

## Local and cloud provider support
Support local providers (initially Ollama and verified compatible runtimes) and cloud providers through explicit adapters. Provider/model selection is available per task. Auto routing uses capabilities, configured providers, privacy policy, connectivity, and resource constraints; explicit user selection wins.

Capability metadata includes context size, streaming, structured output, cancellation, reasoning support, and parameter compatibility. Do not assume all OpenAI-compatible endpoints behave identically. Credentials stay in a trusted backend/native secure store and never reach browser JS or logs.

## Context assembly
Bounded order: exact selection; current page and nearby paragraphs; user-selected range; relevant outline and annotations; later local page-aware retrieval. Keep source text separate from notes and prior model outputs. Tag every source segment with stable source/document/page/segment IDs. Never send the whole book for a one-paragraph question. Enforce byte/token budgets and disclose truncation.

## Citation contract
Structured responses carry source IDs. Validate each against the exact request context. A citation marked verified must resolve to a document, valid page, supplied text segment, and stable anchor/excerpt. Unknown, invented, out-of-range, or required-but-missing references must not appear verified. Do not silently downgrade malformed structured alignment into an ungrounded answer.

## Streaming/job lifecycle
Track queued/running/completed/failed/cancelled with job ID, task, provider/model (non-secret), source manifest, timestamps, and bounded progress. Propagate cancellation end-to-end. Hiding the panel does not cancel; Stop does. Ignore late events after terminal state and prevent stale output appearing on a different page/document. An incomplete stream is never complete.

## Translation quality
Preserve negation, qualifiers, numbers, names, formulas, citations, terminology, paragraph order, and alignment. Maintain reviewed technical/philosophical/general fixtures. Deterministic checks catch structural errors; human review remains necessary. Model self-scores are not proof of fidelity.

## Privacy modes
- Offline-only: block remote inference and discovery.
- Local-first: local inference allowed; remote requests require explicit consent/policy.
- Cloud-enabled: configured remote providers allowed with clear disclosure of provider/model/context.
Never upload a whole document by default.

## Integration
Reuse IDIOS AI Runtime only through a narrow adapter. Shelf owns its task/context/citation contracts and works without IDIOS. Provider code does not live in React components.
