# Security policy

Do not publish exploitable vulnerabilities in public Issues. Use GitHub private vulnerability reporting when enabled, or a private channel associated with this repository.

- Never commit provider credentials, tokens, private keys, or real user documents.
- Documents stay local unless the user explicitly configures a remote AI provider.
- Do not log PDF text, prompts, secrets, or sensitive paths.
- Treat PDF content and model output as untrusted input.
- Protect local APIs against untrusted origins and CSRF.
