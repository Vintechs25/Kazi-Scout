# KaziScout (Kazi-Scout)

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

## Deploying to Vercel (Persistent Cloud Storage)

Vercel serverless functions have an ephemeral filesystem (`/tmp`), which wipes local SQLite data when serverless instances restart or scale down.

To ensure your **auth credentials, OpenAI/Gemini API keys, search profiles, and job records** persist permanently in production on Vercel:

1. **Create a Free Turso Database:**
   - Sign up at [turso.tech](https://turso.tech)
   - Create a database: `turso db create kazi-scout`
   - Generate an auth token: `turso db tokens create kazi-scout`

2. **Add Environment Variables in Vercel:**
   In your Vercel Project Dashboard (`Settings` > `Environment Variables`), configure:
   - `TURSO_DATABASE_URL`: `libsql://kazi-scout-[your-username].turso.io`
   - `TURSO_AUTH_TOKEN`: your generated Turso token
   - `SESSION_SECRET`: a secure random string of 32+ characters

3. **Redeploy:**
   Go to **Deployments** in your Vercel project, click the three dots (`...`) on your latest deployment, and click **Redeploy**. KaziScout will automatically initialize and synchronize the entire schema to Turso on startup.

## AI Providers & Smart Fallback Routing

KaziScout supports multi-provider AI evaluation and cover letter generation:
- **Agent Router (`agentrouter`)**: OpenAI-compatible router gateway (default: `https://agentrouter.org/v1`) with full support for GPT-4o, Claude 3.5 Sonnet, DeepSeek, and custom router models.
- **Google Gemini**: Gemini 2.0 Flash, Gemini 1.5 Pro, and Flash models.
- **OpenAI**: GPT-4o, GPT-4o-mini, and reasoning models.

### Smart Fallback & Default Provider
In **Settings -> AI Providers & Fallback**, you can:
- Configure API keys and model selections for Agent Router, Gemini, and OpenAI.
- Choose your **Active / Default AI Provider**:
  - `Auto`: Seamless smart fallback across your configured providers.
  - `Agent Router`: Use Agent Router as primary evaluator, falling back to Gemini and OpenAI if unavailable.
  - `Google Gemini`: Use Gemini as primary evaluator, falling back to OpenAI and Agent Router.
  - `OpenAI`: Use OpenAI as primary evaluator, falling back to Gemini and Agent Router.

