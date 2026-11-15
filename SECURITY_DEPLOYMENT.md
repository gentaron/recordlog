# Security deployment requirements

AUTH_PASSPHRASE is now required even for local development. Configure it with wrangler secret put AUTH_PASSPHRASE (or an untracked .dev.vars locally) before deploying. Missing configuration denies access. SESSION_SECRET may still fall back to the configured passphrase. Malformed cookies return an authentication failure.

Regression tests run in the security workflow. Full application builds and deployed configuration must be verified before merging. No secrets are committed by this change.
