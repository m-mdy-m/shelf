# Shelf — Product brief

## Vision
Shelf is an intelligent reading workspace for books, papers, manuals, and technical documents. It combines a comfortable reader, durable annotations, and an optional source-grounded AI companion.

**Tagline:** Read. Understand. Connect.

## Target users
- Developers reading technical books, RFCs, papers, and manuals.
- Students/researchers reading long-form texts and comparing arguments.
- Persian/Arabic readers who need correct RTL with mixed English/code.
- Privacy-conscious readers who prefer local models but may opt into cloud AI.

## Core journey
1. Add or open a local PDF.
2. Read with stable navigation and responsive rendering.
3. Select text, bookmark, highlight, or attach a note.
4. Ask AI to explain/translate the selection, summarize a page, or answer a bounded document question.
5. Inspect source references and jump back to the cited passage.
6. Save useful quotes/notes and optionally export to IDIOS Notes/Graph.
7. Resume later, including after restart.

## Principles
- Reader works when AI or network is unavailable.
- The PDF is authoritative; AI output is untrusted until validated.
- Documents/progress/annotations remain local by default.
- Local and cloud providers are both supported; remote calls require explicit policy/consent.
- User data is portable and does not require IDIOS.
- All five platforms are first-class design targets with native differences behind adapters.

## MVP scope
- PDF import/open, navigation, continuous/single-page modes, zoom, outline, text search.
- Durable progress/resume.
- Text selection, bookmarks, highlights, passage notes.
- Configurable local or cloud AI provider.
- Explain selected passage with validated source/page references.
- Streaming and actual cancellation.
- Offline core reading and annotation.

## Not in initial scope
Full PDF editing, page rearrangement, forms/signatures, building a parser/renderer, mandatory cloud/account, automatic document uploads, unrestricted background AI on mobile, social reading, cross-book semantic retrieval before single-document grounding is reliable.

## MVP acceptance
A user can open/search a PDF, annotate it, restart and resume, configure a local or cloud provider, ask about a passage, inspect valid page citations, and stop a running generation. All non-AI core workflows work offline.

## Success measures
No lost progress/annotations; no unverified citation shown as verified; no aborted/incomplete stream marked complete; large PDFs do not render every page at once; portable export/restore works without IDIOS.
