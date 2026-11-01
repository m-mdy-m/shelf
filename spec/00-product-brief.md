# Shelf — Product brief

## Vision

Shelf is an intelligent reading workspace for books, papers, manuals, and technical documents. It combines a comfortable PDF reader, durable annotations, and an optional AI companion that can explain material without losing the connection to its source.

**Read. Understand. Connect.**

Shelf is not a generic PDF editor and not a chat window placed next to a document. Its defining quality is continuity between the reader's exact source passage, personal annotations, and AI-generated explanations.

## Users

- Developers reading technical books, RFCs, papers, and manuals.
- Students and researchers examining long-form texts and arguments.
- Persian/Arabic readers who need correct RTL with mixed English, formulas, and code.
- Privacy-conscious readers who prefer local models but may deliberately opt into cloud providers.

## Core journey

1. Add or open a local PDF.
2. Read with stable navigation and responsive rendering.
3. Select text, bookmark a location, or save a highlight/note/quote.
4. Ask Shelf to explain or translate a selection, summarize a page, or answer a bounded question about the open document.
5. Inspect source references and jump back to the cited passage.
6. Keep useful quotes and notes; later turn reviewed material into concepts or flashcards.
7. Resume reading at the previous location, including after restart.

## Product principles

### Reader first
The Reader remains useful when AI, network access, or a provider is unavailable. AI is contextual and optional. Basic reading must never wait for a model.

### Source before synthesis
The PDF is authoritative. AI output is an interpretation or proposal, not evidence. A source citation is trusted only after it resolves to the exact context provided to the model.

### Local first, remote by choice
Documents, progress, and annotations stay local by default. A cloud provider receives only the context allowed by the user's explicit privacy/provider settings.

### Choice without lock-in
Support local and cloud inference. Users can select a provider/model per operation or choose an automatic policy limited to configured, compatible providers.

### Portable ownership
Users can export and restore their metadata, progress, and annotations without an account or vendor-specific service.

### Five-platform design
Windows, macOS, Linux, Android, and iOS are first-class design targets. Platform-specific behavior belongs behind adapters and is validated on real target systems.

## In scope

### Reader
- Local PDF import/open and a lightweight library.
- Continuous and single-page modes, page navigation, zoom, fit-to-width/page, outline/TOC, and local text search.
- Text selection, bookmarks, highlights, passage notes, and quotes.
- Reading progress and reliable resume.
- Clear handling of scanned, encrypted, password-protected, malformed, missing, and permission-expired documents.

### AI Companion
- Explain selected text.
- Ask questions about a selection, current page, or bounded current-document context.
- Summarize a page or user-selected section.
- Translate selected text/page with alignment checks.
- Analyze an argument or compare explicitly supplied passages.
- Local/cloud provider selection, streaming, cancellation, and bounded job history.
- Verifiable citations linked to page and passage.

### Knowledge
- Save quotes and notes with stable source references.
- Later: concept extraction, flashcards, and quiz questions as reviewable drafts.
- Versioned deep links and portable export.

## Not in the first release

Full PDF authoring/editing, page rearrangement, form filling, digital signatures, a custom PDF parser/renderer, mandatory accounts, mandatory cloud AI, automatic document upload, unrestricted mobile background execution, social reading, and broad cross-document semantic retrieval before single-document grounding is reliable.

## MVP acceptance

A user can import/open/search a PDF, annotate selected text, close/reopen and resume, configure a local or cloud provider, ask about a passage, inspect validated page citations, and stop a running generation. All non-AI Reader workflows work offline.

## Success measures

- No lost progress or saved annotations in supported workflows.
- No citation shown as verified unless it resolves to supplied source context.
- No partial/aborted stream reported as completed.
- Large PDFs do not require every page to remain rendered in memory.
- Export/restore works without an account or remote service.
