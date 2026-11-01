# Web public assets

The web shell serves static files from apps/web/public. Keep only assets that should be copied unchanged into the public web output.

## Layout

- brand/ — product identity source assets.
- icons/ — web application and browser icons.
- favicon.svg — browser tab icon.
- site.webmanifest — installable web-app metadata.
- robots.txt — crawler policy for the public web origin.

## Rules

- Keep application source code, runtime configuration, and secrets out of public/.
- Do not put private PDFs, user documents, provider keys, or environment-specific endpoints in public assets.
- Use relative/root-scoped asset references that work under the configured deployment base path.
- Generate raster app icons and platform-specific store assets from the approved vector source when visual identity is finalized.
- Add a service worker only alongside a reviewed cache policy. PDF documents, user data, and API responses must not be cached accidentally.
- The Content-Security-Policy meta element is only a client-side fallback. Production hosting must send a response-header CSP, including frame-ancestors, plus the required security headers; frame-ancestors is not enforced when delivered through a meta element.
