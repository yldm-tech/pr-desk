# Data handling

PR Desk stores GitHub account names, account creation dates, authored PR metadata (including private repository names and PR titles when authorized), review comments, sync checkpoints and browser session identifiers in PostgreSQL. GitHub access tokens are encrypted using the operator-provided key; PR metadata and session identifiers are not encrypted by the application. Protect the database and backups accordingly.

Cookies hold a random session identifier, a connection marker and temporary OAuth state. Auth cookies are HttpOnly and Secure when the public origin is HTTPS. Logging in and importing history sends requests to GitHub. Profile avatars load from GitHub. README badges and community charts use external image services, separate from application runtime.

Disconnect deletes the current connection record and clears its browser cookies. It does not currently erase stored PR/comment rows, other browser sessions, backups or the GitHub App installation, and it does not revoke the token at GitHub. Expired connections are excluded from authenticated reads and sync after 30 days but are not automatically purged. Operators need a retention and deletion procedure before offering a shared public service. Users can also revoke application access in GitHub settings.

The project does not currently implement a complete account deletion/export flow or a published retention period. These are explicit remaining product tasks, not guarantees supplied by open-sourcing the code.
