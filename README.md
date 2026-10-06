# AI Job Agent

A local-first job-search workspace. The app stores its account, job records, applications, and CV files on the computer running it. It does not submit applications automatically; records created from the job screen remain marked for review.

## Run on Windows

Requirements: Node.js 24 or newer and pnpm (`corepack enable`).

1. Install dependencies from the project folder:

   ```powershell
   corepack enable
   pnpm install
   ```

2. Copy `.env.example` to `.env` and set a random `SESSION_SECRET` with at least 32 characters. For example, in PowerShell:

   ```powershell
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   $secret = [Convert]::ToBase64String($bytes)
   ```

   Put the generated value in `.env`. Keep that file private; it is ignored by Git.

3. Create/update the local SQLite schema:

   ```powershell
   npm run db:setup
   ```

4. Build and start the single local app process:

   ```powershell
   npm run build
   npm start
   ```

   Open <http://localhost:5000>. For a local development-style rebuild and launch, use `npm run dev`.

The first visit asks you to create the local account. Your password is stored as a salted hash. The database defaults to `storage/data/ai-job-agent.sqlite`, and uploaded CVs default to `storage/cvs/`. Both locations are local and excluded from Git. Set `SQLITE_PATH` or `CV_STORAGE_PATH` in `.env` to move either location.

To back up the app, stop it and copy the SQLite database together with the `storage/cvs` folder. Keep the database and CV folder together.

## Current limits

- There are no seeded or sample jobs. Add a real listing manually or use a connected source when one is implemented.
- Agent start/run is blocked until discovery workers and authorized sources are configured. Stop is always available.
- Application records created from a job are review-stage records, not proof of a submission.
- Provider and Gmail states stay disconnected until their integration setup is implemented.
- Do not bypass CAPTCHA, login, anti-bot controls, or a job site's terms.
- This project is intended to run locally or on infrastructure you control. It is not configured for cloud deployment.
