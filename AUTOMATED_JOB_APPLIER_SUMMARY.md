# AI Job Agent - Automated Job Finder & Applier

## Overview

This system is now a **fully automated job discovery and application platform** that:
- Searches for jobs worldwide with focus on Kenya and remote opportunities
- Filters jobs based on extensive criteria
- Auto-matches jobs with your candidate profile
- Automatically applies to high-match jobs via Gmail
- Tracks applications and responses

## What Was Implemented

### 1. **Job Search Service** (`artifacts/api-server/src/lib/job-search-service.ts`)

#### Features:
- **Multiple Job Sources**: Pre-configured sources for Kenya and international remote jobs
  - Kenya: BrighterMonday, JobWeb Kenya, MyJobMag Kenya
  - International: RemoteOK, We Work Remotely, Jobspresso, Remote4Me
  - API-based: FlexJobs, LinkedIn, Indeed (require API keys)

- **Extensive Filtering**:
  - Keywords (skills, technologies, job titles)
  - Locations (cities, countries, regions)
  - Remote vs on-site preference
  - Minimum/maximum salary
  - Job types (Full-time, Part-time, Contract, etc.)
  - Experience level (Entry, Mid, Senior)
  - Industries and companies
  - Exclude keywords (to filter out unwanted listings)
  - Date posted (last 24h, 7d, 30d)

- **Intelligent Matching**:
  - AI-powered job-to-profile matching
  - Scores jobs based on:
    - Title relevance (25%)
    - Skills match (20%)
    - Location preference (15%)
    - Experience level (10%)
    - Salary requirements (10%)
    - Technology match (20%)

- **Deduplication**:
  - Fingerprinting to avoid duplicate job listings
  - Company and title normalization
  - Similarity detection for near-duplicates

### 2. **Application Service** (`artifacts/api-server/src/lib/application-service.ts`)

#### Features:
- **Auto-Application**: Automatically applies to high-match jobs
- **Multiple Templates**:
  - Standard application template
  - With cover letter template
  - Kenya-focused template (optimized for Kenyan candidates)

- **Gmail Integration**:
  - Sends applications via Gmail
  - Attaches CV and other documents
  - Tracks sent applications

- **Document Management**:
  - CV attachment support
  - Multiple CV support
  - Master CV designation

- **Response Tracking**:
  - Monitors for application responses
  - Identifies interviews, rejections, offers
  - Updates application status

### 3. **Agent Worker** (`artifacts/api-server/src/lib/agent-worker.ts`)

#### Features:
- **Background Processing**: Runs as a continuous service
- **Scheduled Tasks**:
  - Job search (every hour by default)
  - Auto-application (every 2 hours by default)
  - Response checking (every 3 hours by default)

- **Agent Commands**:
  - `start`: Starts the agent and all scheduled tasks
  - `stop`: Stops all automated actions
  - `pause`: Temporarily suspends the agent
  - `resume`: Continues after pause
  - `runNow`: Triggers immediate job search and application cycle

- **Configuration**:
  - Configurable intervals
  - Minimum match score threshold
  - Maximum applications per run
  - Application template selection

### 4. **New API Endpoints** (`artifacts/api-server/src/routes/search.ts`)

#### Endpoints:

- **GET /api/search/filters**
  - Get current search filters from active profiles
  - Returns all available job sources
  - Shows Kenya-specific and international sources

- **PUT /api/search/filters**
  - Update global search filters
  - Creates new search profile if none exists
  - Updates existing profile with new filters

- **POST /api/search/manual**
  - Perform manual job search with custom filters
  - Returns matching jobs with scores
  - Provides search statistics

- **POST /api/search/apply-auto**
  - Trigger auto-application to high-match jobs
  - Configurable match score threshold
  - Configurable max applications
  - Configurable template

- **GET /api/search/stats**
  - Get comprehensive job search statistics
  - Recent jobs and high-match jobs
  - Job and application counts

- **GET /api/search/sources**
  - List all available job sources
  - Shows enabled/disabled status
  - Rate limits and API requirements

- **POST /api/search/sources/:id/enable**
  - Enable or disable specific job sources

### 5. **Enhanced Gmail Integration**

- **Read-Write Scope**: Added support for sending emails
- **Scope Management**: Different scopes based on application mode
- **Authentication**: OAuth 2.0 flow for Gmail
- **Token Management**: Access token refresh handling

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │  Dashboard  │  │  Job List   │  │  Application     │    │
│  │             │  │             │  │  Tracking        │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      API Server (Express)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │
│  │   Routes    │  │  Services    │  │   Database       │    │
│  │             │  │             │  │                 │    │
│  │ - auth      │  │ - job-search │  │ - SQLite        │    │
│  │ - jobs      │  │ - application│  │ - Drizzle ORM  │    │
│  │ - cvs       │  │ - agent      │  │                 │    │
│  │ - gmail     │  │ - gmail      │  │                 │    │
│  │ - agent     │  │             │  │                 │    │
│  │ - search    │  │             │  │                 │    │
│  └─────────────┘  └─────────────┘  └─────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────┐
│  Job Boards     │ │   Gmail     │ │   Storage   │
│                 │ │             │ │             │
│ - BrighterMonday│ │ - OAuth 2.0 │ │ - CV Files  │
│ - RemoteOK      │ │ - API       │ │ - PDF/DOCX  │
│ - LinkedIn      │ │ - Send      │ │             │
│ - Indeed        │ │ - Read      │ │             │
└─────────────────┘ └─────────────┘ └─────────────┘
```

## Key Features for Kenya-Focused Job Search

### 1. **Kenya-Specific Sources**
- BrighterMonday (Kenya's leading job board)
- JobWeb Kenya
- MyJobMag Kenya
- All configured with Kenya-specific locations

### 2. **Remote Job Focus**
- All international sources are remote-only
- Kenya sources can be filtered for remote opportunities
- Location filtering includes Kenya cities (Nairobi, Mombasa, Kisumu)

### 3. **Kenya-Optimized Templates**
- Special application template for Kenyan candidates
- Highlights Kenyan experience
- Mentions remote work capability from Kenya
- Includes local contact information

### 4. **Filter Presets**
- Kenya-focused filters
- Remote-only filters
- Salary filters in USD and KES
- Experience level filters matching Kenyan market

## How It Works

### 1. **Setup Process**

1. **Create Account**: Set up local account with password
2. **Complete Profile**: Add your candidate information
   - Skills, technologies, experience
   - Preferred locations, salary expectations
   - Work modes (remote, hybrid, on-site)
3. **Upload CV**: Add your CV for attachments
4. **Configure Gmail**: Connect Gmail with OAuth 2.0
   - Requires Google OAuth client credentials
   - Grants read and send permissions
5. **Create Search Profiles**: Define your job search criteria
   - Keywords, locations, filters
   - Match score thresholds

### 2. **Automated Workflow**

1. **Start Agent**: `POST /api/agent/control` with `command: "start"`
2. **Job Discovery**:
   - Agent searches all enabled job sources
   - Filters jobs based on your criteria
   - Calculates match scores
   - Saves new jobs to database
3. **Auto-Application**:
   - Identifies high-match jobs (default: 80%+)
   - Prepares application email with template
   - Attaches CV and documents
   - Sends via Gmail
   - Records application in database
4. **Response Monitoring**:
   - Checks for replies to applications
   - Updates application status
   - Notifies of interviews, rejections, offers

### 3. **Manual Operations**

- **Manual Search**: Use `/api/search/manual` to search with custom filters
- **Manual Apply**: Use `/api/search/apply-auto` to apply to matching jobs
- **Manual Agent Run**: Use `command: "runNow"` to trigger immediate cycle

## Configuration Options

### Agent Configuration (`AgentConfig`)

```typescript
{
  searchIntervalMinutes: 60,      // Search every hour
  applyIntervalMinutes: 120,      // Apply every 2 hours
  checkResponsesIntervalMinutes: 180, // Check responses every 3 hours
  minMatchScore: 80,              // Only apply to 80%+ matches
  maxApplicationsPerRun: 5,      // Max 5 applications per cycle
  applicationTemplate: "kenya-focused", // Template to use
  autoApply: true,               // Enable auto-apply
  sources: ["kenya", "international"] // Enable Kenya and international
}
```

### Search Filters (`JobSearchFilter`)

```typescript
{
  keywords: ["JavaScript", "React", "Node.js"],
  locations: ["Kenya", "Remote", "Nairobi"],
  remote: true,                    // Only remote jobs
  minSalary: 100000,               // Minimum salary in USD
  jobTypes: ["Full-time", "Contract"],
  excludeKeywords: ["Senior", "Lead"], // Exclude certain keywords
  experienceLevel: ["Mid", "Senior"],
  industries: ["Technology", "Software"]
}
```

## API Endpoints Summary

### Agent Control (`/api/agent`)
- `GET /status` - Get agent status
- `POST /control` - Send agent commands (start, stop, pause, resume, runNow)

### Job Search (`/api/search`)
- `GET /filters` - Get current search filters
- `PUT /filters` - Update search filters
- `POST /manual` - Perform manual search
- `POST /apply-auto` - Trigger auto-apply
- `GET /stats` - Get search statistics
- `GET /sources` - List job sources
- `POST /sources/:id/enable` - Enable/disable source

### Jobs (`/api/jobs`)
- `GET /jobs` - List jobs with filters
- `POST /jobs` - Create job (manual entry)
- `GET /jobs/:id` - Get job details
- `PATCH /jobs/:id` - Update job status
- `POST /jobs/:id/track` - Track job application

### Applications (`/api/applications`)
- `GET /applications` - List applications
- `POST /applications` - Create application (manual)

### CVs (`/api/cvs`)
- `GET /cvs` - List CVs
- `POST /cvs` - Upload CV
- `DELETE /cvs/:id` - Delete CV
- `POST /cvs/:id/parse` - Parse CV to profile

### Gmail (`/api/integrations/gmail`)
- `PUT /settings/gmail` - Save Gmail OAuth config
- `DELETE /settings/gmail` - Disconnect Gmail
- `GET /connect` - Initiate OAuth flow
- `GET /callback` - OAuth callback handler

### Settings (`/api/settings`)
- `GET /settings` - Get all settings
- `PUT /settings/providers/:provider` - Save provider credentials
- `POST /settings/providers/:provider/test` - Test provider connection
- `DELETE /settings/providers/:provider` - Remove provider

### Dashboard (`/api/dashboard`)
- `GET /dashboard` - Get dashboard summary

## Running the System

### 1. Start the API Server

```bash
cd artifacts/api-server
npm run dev
```

### 2. Start the Frontend

```bash
cd artifacts/ai-job-agent
npm run dev
```

### 3. Use the System

1. Open browser to `http://localhost:5173` (or configured port)
2. Set up account and sign in
3. Complete candidate profile
4. Upload CV(s)
5. Configure Gmail in settings
6. Create search profiles
7. Start the agent
8. Monitor dashboard for discovered jobs and applications

## Customization

### Adding New Job Sources

Edit `artifacts/api-server/src/lib/job-search-service.ts`:

```typescript
const CUSTOM_SOURCES: JobSource[] = [
  {
    id: "custom-source",
    name: "Custom Job Board",
    baseUrl: "https://custom-jobs.com",
    searchEndpoint: "/api/jobs",
    enabled: true,
    rateLimit: 30,
    countries: ["Kenya"],
    remoteOnly: false,
  },
];

// Add to ALL_JOB_SOURCES
ALL_JOB_SOURCES.push(...CUSTOM_SOURCES);
```

### Creating Custom Templates

Edit `artifacts/api-server/src/lib/application-service.ts`:

```typescript
const CUSTOM_TEMPLATES: ApplicationTemplate[] = [
  {
    id: "custom-template",
    name: "My Custom Template",
    subject: "Application for {{jobTitle}} - {{fullName}}",
    body: "Custom email body with {{placeholders}}",
    includeCV: true,
    includeCoverLetter: false,
    customFields: {},
  },
];

// Add to DEFAULT_TEMPLATES
DEFAULT_TEMPLATES.push(...CUSTOM_TEMPLATES);
```

### Adjusting Match Scoring

Edit `calculateMatchScore` function in `job-search-service.ts` to adjust weights:

```typescript
// Current weights
const titleWeight = 25;
const skillsWeight = 20;
const locationWeight = 15;
const experienceWeight = 10;
const salaryWeight = 10;
const technologyWeight = 20;

// Adjust as needed
export function calculateMatchScore(job, profile) {
  // ... calculate with custom weights
}
```

## Security Considerations

1. **Gmail OAuth**: Uses OAuth 2.0 with proper scopes
2. **Credentials**: Encrypted storage for API keys and tokens
3. **Rate Limiting**: Respects job board rate limits
4. **Duplicate Protection**: Fingerprinting prevents duplicate applications
5. **Session Management**: Secure session cookies with HttpOnly

## Next Steps for Production

1. **Get API Keys**: Obtain API keys for:
   - LinkedIn Jobs API
   - Indeed API
   - FlexJobs API
   - Google Gmail API

2. **Configure OAuth**:
   - Set up Google Cloud project
   - Configure OAuth credentials
   - Add redirect URIs

3. **Deploy**:
   - Deploy API server with persistent storage
   - Deploy frontend
   - Configure environment variables

4. **Monitor**:
   - Set up logging
   - Monitor agent performance
   - Track application success rates

5. **Optimize**:
   - Fine-tune match scoring
   - Adjust search intervals
   - Optimize filters for best results

## Files Modified/Created

### Modified Files:
- `artifacts/api-server/src/routes/agent.ts` - Enhanced agent control with full command support
- `artifacts/api-server/src/routes/index.ts` - Added search routes
- `artifacts/api-server/src/lib/gmail-oauth-utils.ts` - Added Gmail scope management

### Created Files:
- `artifacts/api-server/src/lib/job-search-service.ts` - Complete job search service
- `artifacts/api-server/src/lib/application-service.ts` - Complete application service
- `artifacts/api-server/src/lib/agent-worker.ts` - Background agent worker
- `artifacts/api-server/src/routes/search.ts` - New search API routes
- `artifacts/api-server/src/types/search-types.ts` - Type definitions for search endpoints

## Summary

This system is now a **complete, automated job finder and applier** that:

✅ Searches for jobs from multiple sources (Kenya + International)
✅ Filters jobs with extensive criteria
✅ Matches jobs with your profile using AI-powered scoring
✅ Automatically applies to high-match jobs
✅ Sends applications via Gmail with CV attachments
✅ Tracks applications and responses
✅ Runs continuously in the background
✅ Provides comprehensive API and dashboard

**Focus Areas for Kenya:**
- Kenya-specific job sources
- Remote job focus
- Kenya-optimized application templates
- Local salary and experience level filters

The system is ready for **production use** with the appropriate API keys and Gmail OAuth configuration.
