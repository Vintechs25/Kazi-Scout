# KaziScout

**Find the right work. Apply with confidence.**

*Powered by Vintech Systems & Consulting*

---

A professional, local-first career discovery and job search workspace tailored for the Kenyan job market and global remote opportunities. KaziScout systematically monitors verified recruitment endpoints across Kenyan government services (Public Service Commission, GHRIS), all 47 County Governments, NGOs, tech enterprises, and curated remote career boards.

The platform stores its account credentials, job discovery records, search profiles, applications, and CV files securely on your local computer. It operates on a strict consent model: applications and communications are prepared for your review and are never submitted without your explicit command.

## Key Capabilities

- **Intelligent Discovery Desk**: Multi-source crawling across public and private job boards with full provenance tracking.
- **National & County Coverage**: Dedicated tracking for all 47 Kenyan County Governments and public sector portals.
- **AI Matching Engine**: Semantic matching against candidate master profiles and role criteria using Google Gemini and OpenAI.
- **Document Vault**: CV parsing, credential storage, and tailoring.
- **Application Tracking**: Structured workflow from discovery and review to submission and interview tracking.
- **Privacy & Security**: Local-first SQLite database and sandboxed environment.

## Getting Started on Windows

Requirements: Node.js 20+ and pnpm (`corepack enable`).

1. Install dependencies from the project root:

   ```powershell
   corepack enable
   pnpm install
   ```

2. Configure environment:
   Copy `.env.example` to `.env` and set a secure `SESSION_SECRET` with at least 32 characters:

   ```powershell
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   $secret = [Convert]::ToBase64String($bytes)
   ```

   Put the generated secret into `.env`.

3. Prepare the local SQLite schema:

   ```powershell
   npm run db:setup
   ```

4. Build and start KaziScout:

   ```powershell
   npm run build
   npm start
   ```

   Open your browser to <http://localhost:5000>.

## Privacy and Data Storage

- On your first visit, KaziScout prompts you to create a secure local master password.
- Your password is stored as a salted hash.
- The local database defaults to `storage/data/ai-job-agent.sqlite`, and uploaded CVs default to `storage/cvs/`.
- All credentials, API keys, and personal candidate facts remain strictly local.
