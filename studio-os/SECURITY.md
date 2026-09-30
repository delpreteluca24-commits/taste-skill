# Security
- Never commit credentials. Use GitHub Actions Secrets, OAuth or environment variables.
- Expected secret names (set up only when needed): `HIGGSFIELD_API_KEY`, `YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN`, `GDRIVE_SERVICE_ACCOUNT_JSON`.
- Workflows use least-privilege `permissions:`, and none of them can spend money.
- If a secret is exposed: rotate it right away, open an issue with the `incident` label, and write it in `00_CORE/decision-log.md`.
- Only use MCP servers that are official or verified. Don't install random third-party MCPs when an official API exists.
