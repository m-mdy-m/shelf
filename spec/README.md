# Shelf specification

| Document | Scope |
|---|---|
| [00-product-brief.md](00-product-brief.md) | Vision, scope, MVP and principles |
| [01-architecture.md](01-architecture.md) | Components, boundaries and integration modes |
| [02-reader-engine.md](02-reader-engine.md) | PDF.js, navigation, search, selection and annotations |
| [03-ai-companion.md](03-ai-companion.md) | Local/cloud AI, routing, grounding, streaming and citations |
| [04-data-model.md](04-data-model.md) | Entities, anchors, persistence and export |
| [05-cross-platform.md](05-cross-platform.md) | Windows, macOS, Linux, Android and iOS |
| [06-quality-security.md](06-quality-security.md) | Tests, privacy, security, accessibility and performance |
| [07-roadmap.md](07-roadmap.md) | Delivery phases and exit criteria |
| [08-github-work-plan.md](08-github-work-plan.md) | Issue structure, labels, milestones and dependencies |

## Locked decisions
1. Start with the PDF Reader.
2. Support both local and cloud AI; users control provider/model and remote context sharing.
3. Design for all five platform families from day one; deliver in validated stages.
4. Standalone/local-first use must not require IDIOS, an account, or a server.
5. IDIOS integration and multi-device sync are optional.
6. Use PDF.js behind an adapter; do not build a PDF renderer.
7. Start as a modular application, not a microservice fleet.
8. Preserve the old catalog files in archive/.
