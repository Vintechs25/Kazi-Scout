import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type DatabaseConstructor from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index";

const _req = createRequire(import.meta.url);

function loadBetterSqlite3(): typeof DatabaseConstructor {
  const currentFile = typeof import.meta.url === "string" ? fileURLToPath(import.meta.url) : "";
  const currentDir = currentFile ? path.dirname(currentFile) : process.cwd();
  const searchDirs = [
    process.cwd(),
    currentDir,
    path.resolve(currentDir, ".."),
    path.resolve(currentDir, "../.."),
    path.resolve(currentDir, "node_modules"),
    path.resolve(currentDir, "../node_modules"),
    path.resolve(currentDir, "../../node_modules"),
    path.resolve(process.cwd(), "artifacts/api-server"),
    path.resolve(process.cwd(), "artifacts/api-server/dist"),
    path.resolve(process.cwd(), "node_modules/better-sqlite3"),
    path.resolve(process.cwd(), "artifacts/api-server/node_modules/better-sqlite3"),
    path.resolve(process.cwd(), "dist/node_modules/better-sqlite3"),
    "/var/task",
    "/var/task/dist",
    "/var/task/node_modules/better-sqlite3",
    "/var/task/dist/node_modules/better-sqlite3",
  ];
  for (const dir of searchDirs) {
    try {
      const resolved = _req.resolve("better-sqlite3", { paths: [dir] });
      const mod = _req(resolved);
      return mod.default || mod;
    } catch {
      // try next
    }
  }
  return _req("better-sqlite3");
}

function loadDrizzleOrm(): (client: any, config?: any) => any {
  const currentFile = typeof import.meta.url === "string" ? fileURLToPath(import.meta.url) : "";
  const currentDir = currentFile ? path.dirname(currentFile) : process.cwd();
  const searchDirs = [
    process.cwd(),
    currentDir,
    path.resolve(currentDir, ".."),
    path.resolve(currentDir, "../.."),
    path.resolve(currentDir, "node_modules"),
    path.resolve(currentDir, "../node_modules"),
    path.resolve(currentDir, "../../node_modules"),
    path.resolve(process.cwd(), "artifacts/api-server"),
    path.resolve(process.cwd(), "artifacts/api-server/dist"),
    "/var/task",
    "/var/task/dist",
  ];
  for (const dir of searchDirs) {
    try {
      const resolved = _req.resolve("drizzle-orm/better-sqlite3", { paths: [dir] });
      const mod = _req(resolved);
      if (typeof mod.drizzle === "function") return mod.drizzle;
      if (typeof mod.default === "function") return mod.default;
    } catch {
      // try next
    }
  }
  const mod = _req("drizzle-orm/better-sqlite3");
  return mod.drizzle || mod.default;
}

function getDatabasePath(): string {
  if (process.env.SQLITE_PATH === ":memory:") return ":memory:";
  if (process.env.SQLITE_PATH) return path.resolve(process.cwd(), process.env.SQLITE_PATH);
  if (process.env.VERCEL) {
    if (process.platform === "win32") {
      return path.resolve(process.env.TEMP || "storage/data", "ai-job-agent.sqlite");
    }
    return "/tmp/ai-job-agent.sqlite";
  }
  
  const candidates = [
    path.resolve(process.cwd(), "storage/data/ai-job-agent.sqlite"),
    path.resolve(process.cwd(), "../storage/data/ai-job-agent.sqlite"),
    path.resolve(process.cwd(), "../../storage/data/ai-job-agent.sqlite"),
  ];
  
  const existing = candidates.filter(c => existsSync(c));
  if (existing.length > 0) {
    existing.sort((a, b) => {
      try {
        return statSync(b).size - statSync(a).size;
      } catch {
        return 0;
      }
    });
    return existing[0];
  }
  return candidates[0];
}

let _sqliteInstance: any = null;
let _drizzleInstance: any = null;

export function getDatabaseInstance(): any {
  if (!_sqliteInstance) {
    const Database = loadBetterSqlite3();
    const databasePath = getDatabasePath();
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    const sqlite = new Database(databasePath);
    try {
      if (!process.env.VERCEL) {
        sqlite.pragma("journal_mode = WAL");
      } else {
        sqlite.pragma("journal_mode = DELETE");
      }
      sqlite.pragma("foreign_keys = ON");
      ensureSchemaColumns(sqlite);
    } catch (err) {
      console.error("Warning: SQLite initialization error:", err);
    }
    _sqliteInstance = sqlite;
  }
  return _sqliteInstance;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (!_drizzleInstance) {
    const sqlite = getDatabaseInstance();
    const drizzleFn = loadDrizzleOrm();
    _drizzleInstance = drizzleFn(sqlite, { schema });
  }
  return _drizzleInstance;
}

export const db: BetterSQLite3Database<typeof schema> = new Proxy(
  {} as BetterSQLite3Database<typeof schema>,
  {
    get(_target, prop, receiver) {
      const instance = getDb() as any;
      const value = Reflect.get(instance, prop, receiver);
      if (typeof value === "function") {
        return value.bind(instance);
      }
      return value;
    },
  }
);

// Automatically ensure base tables and new schema columns exist in SQLite database
function ensureSchemaColumns(dbInstance: any) {
  try {
    // 1. Ensure all core tables exist (required for fresh environments like Vercel /tmp)
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id text PRIMARY KEY,
        password_salt text NOT NULL,
        password_hash text NOT NULL,
        created_at integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS candidate_profiles (
        id text PRIMARY KEY,
        full_name text NOT NULL DEFAULT '',
        email text NOT NULL DEFAULT '',
        phone text NOT NULL DEFAULT '',
        country text NOT NULL DEFAULT '',
        city text NOT NULL DEFAULT '',
        timezone text NOT NULL DEFAULT '',
        target_roles text NOT NULL DEFAULT '[]',
        skills text NOT NULL DEFAULT '[]',
        technologies text NOT NULL DEFAULT '[]',
        years_experience real,
        education text NOT NULL DEFAULT '[]',
        certifications text NOT NULL DEFAULT '[]',
        industries text NOT NULL DEFAULT '[]',
        languages text NOT NULL DEFAULT '[]',
        preferred_locations text NOT NULL DEFAULT '[]',
        work_modes text NOT NULL DEFAULT '[]',
        relocation integer NOT NULL DEFAULT 0,
        visa_sponsorship integer NOT NULL DEFAULT 0,
        minimum_salary real,
        updated_at integer
      );

      CREATE TABLE IF NOT EXISTS cvs (
        id text PRIMARY KEY,
        account_id text,
        file_name text NOT NULL,
        storage_name text NOT NULL UNIQUE,
        file_type text NOT NULL,
        category text NOT NULL DEFAULT 'cv',
        title text,
        size_bytes integer NOT NULL,
        is_master integer NOT NULL DEFAULT 0,
        uploaded_at integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id text PRIMARY KEY,
        title text NOT NULL,
        company text NOT NULL,
        normalized_company text NOT NULL,
        normalized_title text NOT NULL,
        location text,
        normalized_location text NOT NULL,
        remote integer NOT NULL DEFAULT 0,
        salary text,
        source text NOT NULL,
        source_url text,
        external_job_id text,
        description text NOT NULL,
        fingerprint text NOT NULL,
        match_score integer,
        status text NOT NULL DEFAULT 'DISCOVERED',
        rejection_reason text,
        match_reason text,
        ai_decision text,
        ai_provider text,
        ai_model text,
        ai_evaluated_at integer,
        evidence_fingerprint text,
        matched_skills text DEFAULT '[]',
        missing_skills text DEFAULT '[]',
        uncertainties text DEFAULT '[]',
        is_ai_verified integer NOT NULL DEFAULT 0,
        hard_eligibility_failure integer NOT NULL DEFAULT 0,
        source_id text,
        hiring_employer text,
        discovered_at integer NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint_unique ON jobs (fingerprint);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_source_external_id_unique ON jobs (source, external_job_id);

      CREATE TABLE IF NOT EXISTS applications (
        id text PRIMARY KEY,
        job_id text NOT NULL,
        method text NOT NULL,
        status text NOT NULL DEFAULT 'NEEDS_REVIEW',
        recipient_email text,
        subject_line text,
        cover_letter text,
        attached_document_ids text,
        match_score integer,
        applied_at integer NOT NULL,
        last_activity_at integer NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS applications_job_id_unique ON applications (job_id);

      CREATE TABLE IF NOT EXISTS search_profiles (
        id text PRIMARY KEY,
        name text NOT NULL,
        keywords text NOT NULL DEFAULT '[]',
        locations text NOT NULL DEFAULT '[]',
        remote_setting text NOT NULL DEFAULT 'any',
        minimum_match_score integer NOT NULL DEFAULT 80,
        minimum_salary real,
        excluded_keywords text NOT NULL DEFAULT '[]',
        employment_types text NOT NULL DEFAULT '[]',
        enabled integer NOT NULL DEFAULT 1,
        created_at integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_state (
        id text PRIMARY KEY,
        agent_state text NOT NULL DEFAULT 'STOPPED',
        agent_message text NOT NULL DEFAULT 'Agent is stopped. No automated actions are running.',
        application_mode text NOT NULL DEFAULT 'approval',
        updated_at integer NOT NULL
      );

      CREATE TABLE IF NOT EXISTS integration_settings (
        provider text PRIMARY KEY,
        encrypted_credentials text NOT NULL,
        model text,
        client_id text,
        status text NOT NULL DEFAULT 'CONFIGURED',
        connected_email text,
        updated_at integer NOT NULL,
        tested_at integer
      );

      CREATE TABLE IF NOT EXISTS activity (
        id text PRIMARY KEY,
        message text NOT NULL,
        kind text NOT NULL,
        created_at integer NOT NULL
      );
      CREATE INDEX IF NOT EXISTS activity_created_at_idx ON activity (created_at);
    `);

    const cvsCols = (dbInstance.prepare("PRAGMA table_info(cvs)").all() as any[]).map(c => c.name);
    if (!cvsCols.includes("category")) {
      dbInstance.exec("ALTER TABLE cvs ADD COLUMN category text NOT NULL DEFAULT 'cv'");
    }
    if (!cvsCols.includes("title")) {
      dbInstance.exec("ALTER TABLE cvs ADD COLUMN title text");
    }

    const appCols = (dbInstance.prepare("PRAGMA table_info(applications)").all() as any[]).map(c => c.name);
    if (!appCols.includes("recipient_email")) {
      dbInstance.exec("ALTER TABLE applications ADD COLUMN recipient_email text");
    }
    if (!appCols.includes("subject_line")) {
      dbInstance.exec("ALTER TABLE applications ADD COLUMN subject_line text");
    }
    if (!appCols.includes("cover_letter")) {
      dbInstance.exec("ALTER TABLE applications ADD COLUMN cover_letter text");
    }
    if (!appCols.includes("attached_document_ids")) {
      dbInstance.exec("ALTER TABLE applications ADD COLUMN attached_document_ids text");
    }

    const jobCols = (dbInstance.prepare("PRAGMA table_info(jobs)").all() as any[]).map(c => c.name);
    if (!jobCols.includes("rejection_reason")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN rejection_reason text");
    }
    if (!jobCols.includes("match_reason")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN match_reason text");
    }
    if (!jobCols.includes("ai_decision")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN ai_decision text");
    }
    if (!jobCols.includes("ai_provider")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN ai_provider text");
    }
    if (!jobCols.includes("ai_model")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN ai_model text");
    }
    if (!jobCols.includes("ai_evaluated_at")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN ai_evaluated_at integer");
    }
    if (!jobCols.includes("evidence_fingerprint")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN evidence_fingerprint text");
    }
    if (!jobCols.includes("matched_skills")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN matched_skills text");
    }
    if (!jobCols.includes("missing_skills")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN missing_skills text");
    }
    if (!jobCols.includes("uncertainties")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN uncertainties text");
    }
    if (!jobCols.includes("is_ai_verified")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN is_ai_verified integer DEFAULT 0");
    }
    if (!jobCols.includes("hard_eligibility_failure")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN hard_eligibility_failure integer DEFAULT 0");
    }
    if (!jobCols.includes("source_id")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN source_id text");
    }
    if (!jobCols.includes("hiring_employer")) {
      dbInstance.exec("ALTER TABLE jobs ADD COLUMN hiring_employer text");
    }

    // Safely create source registry and county tables if not present
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS job_sources (
        id text PRIMARY KEY,
        name text NOT NULL,
        canonical_url text NOT NULL,
        category text NOT NULL,
        country text NOT NULL DEFAULT 'Kenya',
        region text,
        integration_type text NOT NULL DEFAULT 'PUBLIC_FEED',
        connector_type text NOT NULL DEFAULT 'FEED',
        status text NOT NULL DEFAULT 'CONFIGURED',
        enabled integer NOT NULL DEFAULT 1,
        supports_api integer DEFAULT 0,
        supports_feed integer DEFAULT 0,
        supports_html_extraction integer DEFAULT 0,
        supports_browser_automation integer DEFAULT 0,
        supports_search_only integer DEFAULT 0,
        supports_application_redirect integer DEFAULT 1,
        authentication_required integer DEFAULT 0,
        terms_reviewed integer DEFAULT 1,
        access_method text,
        rate_limit integer DEFAULT 60,
        last_checked_at integer,
        last_successful_run_at integer,
        last_job_discovered_at integer,
        last_error_at integer,
        last_error_message text,
        total_discovered integer DEFAULT 0,
        total_parsed integer DEFAULT 0,
        total_indexed integer DEFAULT 0,
        total_rejected integer DEFAULT 0,
        consecutive_failures integer DEFAULT 0,
        config text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE INDEX IF NOT EXISTS job_sources_category_idx ON job_sources (category);
      CREATE INDEX IF NOT EXISTS job_sources_status_idx ON job_sources (status);
      CREATE INDEX IF NOT EXISTS job_sources_enabled_idx ON job_sources (enabled);

      CREATE TABLE IF NOT EXISTS county_registry (
        id text PRIMARY KEY,
        code integer NOT NULL,
        name text NOT NULL,
        capital text,
        official_website text,
        recruitment_url text,
        cpsb_url text,
        announcements_url text,
        discovery_queries text,
        status text NOT NULL DEFAULT 'CONFIGURED',
        last_checked_at integer,
        last_error text,
        verified_destinations text
      );
      CREATE INDEX IF NOT EXISTS county_registry_code_idx ON county_registry (code);

      CREATE TABLE IF NOT EXISTS job_provenance (
        id text PRIMARY KEY,
        job_id text NOT NULL,
        source_id text NOT NULL,
        source_name text NOT NULL,
        original_url text NOT NULL,
        discovered_at integer NOT NULL,
        is_primary integer DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS job_provenance_job_id_idx ON job_provenance (job_id);

      CREATE TABLE IF NOT EXISTS discovered_sources (
        id text PRIMARY KEY,
        url text NOT NULL,
        domain text NOT NULL,
        suggested_name text,
        suggested_category text,
        evidence text,
        status text NOT NULL DEFAULT 'PROPOSED',
        ssrf_checked integer DEFAULT 0,
        robots_allowed integer,
        discovered_at integer NOT NULL,
        reviewed_at integer,
        notes text
      );
      CREATE INDEX IF NOT EXISTS discovered_sources_domain_idx ON discovered_sources (domain);
    `);

    // Ensure new discovery and role management tables exist
    try {
      dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS user_role_preferences (
          id text PRIMARY KEY,
          account_id text NOT NULL,
          role_title text NOT NULL,
          source text NOT NULL DEFAULT 'cv' CHECK(source IN ('cv', 'manual', 'suggested')),
          enabled integer NOT NULL DEFAULT 1,
          priority text NOT NULL DEFAULT 'medium' CHECK(priority IN ('high', 'medium', 'low')),
          weight integer NOT NULL DEFAULT 50,
          search_queries text DEFAULT '[]',
          keywords text DEFAULT '[]',
          exclusion_keywords text DEFAULT '[]',
          min_salary integer,
          max_salary integer,
          location_preferences text DEFAULT '[]',
          remote_only integer NOT NULL DEFAULT 0,
          experience_level text DEFAULT '[]',
          industry_preferences text DEFAULT '[]',
          company_size text DEFAULT '[]',
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE INDEX IF NOT EXISTS user_role_preferences_account_idx ON user_role_preferences (account_id);
        CREATE INDEX IF NOT EXISTS user_role_preferences_enabled_idx ON user_role_preferences (enabled);
        CREATE INDEX IF NOT EXISTS user_role_preferences_priority_idx ON user_role_preferences (priority);

        CREATE TABLE IF NOT EXISTS user_discovery_settings (
          id text PRIMARY KEY,
          account_id text NOT NULL UNIQUE,
          selected_role_ids text DEFAULT '[]',
          search_frequency text NOT NULL DEFAULT 'manual' CHECK(search_frequency IN ('manual', 'daily', 'every_2_days', 'weekly', 'biweekly')),
          search_time_preference text,
          max_jobs_per_search integer NOT NULL DEFAULT 100,
          auto_approve_high_matches integer NOT NULL DEFAULT 0,
          min_match_score_for_auto_approve integer NOT NULL DEFAULT 85,
          preferred_source_ids text DEFAULT '[]',
          excluded_source_ids text DEFAULT '[]',
          enable_all_kenya_sources integer NOT NULL DEFAULT 1,
          enable_global_remote_sources integer NOT NULL DEFAULT 1,
          enable_recruitment_agencies integer NOT NULL DEFAULT 1,
          enable_startups integer NOT NULL DEFAULT 1,
          enable_freelance integer NOT NULL DEFAULT 0,
          default_min_salary integer,
          default_max_salary integer,
          default_locations text DEFAULT '[]',
          default_remote_only integer NOT NULL DEFAULT 0,
          default_job_types text DEFAULT '[]',
          default_experience_levels text DEFAULT '[]',
          default_industries text DEFAULT '[]',
          default_companies text DEFAULT '[]',
          default_exclude_keywords text DEFAULT '[]',
          require_application_instructions integer NOT NULL DEFAULT 1,
          enable_ai_suggestions integer NOT NULL DEFAULT 1,
          enable_keyword_expansion integer NOT NULL DEFAULT 1,
          expansion_keywords text DEFAULT '[]',
          notify_new_jobs integer NOT NULL DEFAULT 1,
          notification_channels text DEFAULT '["in_app"]',
          last_discovery_run integer,
          next_scheduled_run integer,
          total_discoveries integer NOT NULL DEFAULT 0,
          total_jobs_discovered integer NOT NULL DEFAULT 0,
          total_matches integer NOT NULL DEFAULT 0,
          total_applications integer NOT NULL DEFAULT 0,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS user_discovery_settings_account_idx ON user_discovery_settings (account_id);

        CREATE TABLE IF NOT EXISTS cv_parsing_results (
          id text PRIMARY KEY,
          cv_id text NOT NULL UNIQUE,
          account_id text NOT NULL,
          parsing_method text NOT NULL CHECK(parsing_method IN ('ai', 'deterministic', 'hybrid')),
          provider_used text,
          model_used text,
          confidence integer NOT NULL DEFAULT 70,
          parsed_at integer NOT NULL,
          full_name text NOT NULL,
          email text,
          phone text,
          location text,
          linked_in text,
          gitHub text,
          portfolio text,
          professional_summary text,
          career_objective text,
          work_experience text DEFAULT '[]',
          education text DEFAULT '[]',
          certifications text DEFAULT '[]',
          projects text DEFAULT '[]',
          skills text DEFAULT '[]',
          technical_skills text DEFAULT '[]',
          soft_skills text DEFAULT '[]',
          extracted_roles text DEFAULT '[]',
          primary_roles text DEFAULT '[]',
          secondary_roles text DEFAULT '[]',
          total_experience_years integer NOT NULL DEFAULT 0,
          total_experience_months integer NOT NULL DEFAULT 0,
          current_role text,
          current_company text,
          search_keywords text DEFAULT '[]',
          search_queries text DEFAULT '[]',
          fingerprint text NOT NULL,
          raw_text_length integer NOT NULL DEFAULT 0,
          truncated integer NOT NULL DEFAULT 0,
          parsing_errors text DEFAULT '[]',
          warnings text DEFAULT '[]',
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS cv_parsing_results_cv_idx ON cv_parsing_results (cv_id);
        CREATE INDEX IF NOT EXISTS cv_parsing_results_account_idx ON cv_parsing_results (account_id);
        CREATE UNIQUE INDEX IF NOT EXISTS cv_parsing_results_fingerprint_idx ON cv_parsing_results (fingerprint);

        CREATE TABLE IF NOT EXISTS job_requirement_verifications (
          id text PRIMARY KEY,
          job_id text NOT NULL,
          account_id text,
          has_clear_instructions integer NOT NULL,
          application_method text NOT NULL DEFAULT 'unknown' CHECK(application_method IN ('online', 'email', 'portal', 'walk_in', 'phone', 'post', 'referral', 'social', 'unknown')),
          application_url text,
          application_email text,
          application_phone text,
          deadline text,
          deadline_date integer,
          is_urgent integer NOT NULL DEFAULT 0,
          days_until_deadline integer,
          required_documents text DEFAULT '[]',
          eligibility_requirements text DEFAULT '[]',
          hard_requirements text DEFAULT '[]',
          soft_requirements text DEFAULT '[]',
          special_instructions text DEFAULT '[]',
          do_not_apply_conditions text DEFAULT '[]',
          is_verified integer NOT NULL DEFAULT 0,
          verification_score integer NOT NULL DEFAULT 0,
          verification_notes text DEFAULT '[]',
          verification_warnings text DEFAULT '[]',
          cv_match_score integer,
          cv_matched_skills text DEFAULT '[]',
          cv_missing_skills text DEFAULT '[]',
          role_match_score integer,
          can_apply integer NOT NULL DEFAULT 1,
          can_apply_reason text,
          cannot_apply_reason text,
          confidence integer NOT NULL DEFAULT 0,
          verified_at integer NOT NULL,
          verification_method text NOT NULL DEFAULT 'automatic' CHECK(verification_method IN ('automatic', 'manual', 'ai')),
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS job_requirement_verifications_job_idx ON job_requirement_verifications (job_id);
        CREATE INDEX IF NOT EXISTS job_requirement_verifications_account_idx ON job_requirement_verifications (account_id);
        CREATE INDEX IF NOT EXISTS job_requirement_verifications_is_verified_idx ON job_requirement_verifications (is_verified);
        CREATE INDEX IF NOT EXISTS job_requirement_verifications_can_apply_idx ON job_requirement_verifications (can_apply);

        CREATE TABLE IF NOT EXISTS discovery_runs (
          id text PRIMARY KEY,
          account_id text,
          run_type text NOT NULL DEFAULT 'manual' CHECK(run_type IN ('manual', 'scheduled', 'background')),
          triggered_by text,
          roles_searched text DEFAULT '[]',
          sources_scraped text DEFAULT '[]',
          discovered integer NOT NULL DEFAULT 0,
          duplicates integer NOT NULL DEFAULT 0,
          matched integer NOT NULL DEFAULT 0,
          high_matches integer NOT NULL DEFAULT 0,
          medium_matches integer NOT NULL DEFAULT 0,
          low_matches integer NOT NULL DEFAULT 0,
          rejected integer NOT NULL DEFAULT 0,
          errors text DEFAULT '[]',
          execution_time integer NOT NULL DEFAULT 0,
          config text DEFAULT '{}',
          started_at integer NOT NULL,
          completed_at integer,
          created_at integer NOT NULL
        );
        CREATE INDEX IF NOT EXISTS discovery_runs_account_idx ON discovery_runs (account_id);
        CREATE INDEX IF NOT EXISTS discovery_runs_started_at_idx ON discovery_runs (started_at);

        CREATE TABLE IF NOT EXISTS scheduled_jobs (
          id text PRIMARY KEY,
          account_id text NOT NULL,
          job_type text NOT NULL,
          next_run_at integer NOT NULL,
          interval text NOT NULL CHECK(interval IN ('hourly', 'daily', 'every_2_days', 'weekly', 'biweekly', 'monthly')),
          last_run_at integer,
          last_success_at integer,
          last_error text,
          consecutive_failures integer NOT NULL DEFAULT 0,
          is_active integer NOT NULL DEFAULT 1,
          created_at integer NOT NULL,
          updated_at integer NOT NULL
        );
        CREATE INDEX IF NOT EXISTS scheduled_jobs_account_idx ON scheduled_jobs (account_id);
        CREATE INDEX IF NOT EXISTS scheduled_jobs_next_run_at_idx ON scheduled_jobs (next_run_at);
        CREATE INDEX IF NOT EXISTS scheduled_jobs_is_active_idx ON scheduled_jobs (is_active);
      `);
    } catch (e) {
      console.error("[DB Migration] Error creating new tables:", e);
    }
  } catch (e) {
    console.error("[DB Migration] Safe column check note:", e);
  }
}

export * from "./schema/index";

