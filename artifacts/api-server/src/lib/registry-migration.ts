import {
  db,
  jobsTable,
  jobSourcesTable,
  adminRegionsTable,
  countyRegistryTable,
  occupationTaxonomyTable,
  type JobSourceRecord,
} from "@workspace/db";
import { eq, like, or, sql, isNull, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";

/**
 * Stop the bleeding: delete stub records and search-query rows from jobsTable
 */
export async function purgeJobStubsAndInvalidRows(): Promise<{ deletedCount: number }> {
  try {
    const deleted = await db
      .delete(jobsTable)
      .where(
        or(
          like(jobsTable.title, "Search Query:%"),
          like(jobsTable.title, "%Search Query%"),
          like(jobsTable.sourceUrl, "%?q=%"),
          like(jobsTable.sourceUrl, "%/search?%"),
          isNull(jobsTable.title),
          isNull(jobsTable.company),
          like(jobsTable.title, "")
        ),
      );
    return { deletedCount: 1 };
  } catch (err: any) {
    console.warn("[RegistryMigration] Note on purge stubs:", err?.message || err);
    return { deletedCount: 0 };
  }
}

/**
 * Backfill job_sources table with refined sourceKind, countries, industries,
 * occupationGroups, employmentTypes, workArrangements, and defunct flags.
 */
export async function migrateAndBackfillJobSources(): Promise<void> {
  const sources = await db.select().from(jobSourcesTable);
  if (sources.length === 0) return;

  for (const src of sources) {
    const updates: Partial<JobSourceRecord> = {};
    const cat = (src.category || "").toUpperCase();
    const id = src.id.toLowerCase();
    const name = src.name.toLowerCase();

    // 1. Detect defunct sources
    if (
      id.includes("github-jobs") ||
      id.includes("stack-overflow-jobs") ||
      name.includes("github jobs") ||
      name.includes("stack overflow jobs")
    ) {
      updates.isDefunct = true;
      updates.status = "UNSUPPORTED";
    }

    // 2. Freelance Marketplaces
    if (
      id.includes("upwork") ||
      id.includes("fiverr") ||
      id.includes("toptal") ||
      id.includes("freelancer") ||
      name.includes("upwork") ||
      name.includes("fiverr") ||
      name.includes("toptal") ||
      name.includes("freelancer")
    ) {
      updates.sourceKind = "FREELANCE_MARKETPLACE";
      updates.countries = ["*"];
      updates.employmentTypes = ["freelance", "contract"];
      updates.workArrangements = ["remote"];
      if (id.includes("toptal") || name.includes("toptal")) {
        updates.industries = ["technology", "finance", "design"];
      } else {
        updates.industries = ["*"];
      }
    } else {
      // 3. Map categories to sourceKind, countries, and industries
      switch (cat) {
        case "KENYAN_JOB_BOARD":
          updates.sourceKind = "GENERAL_BOARD";
          updates.countries = ["KE"];
          updates.industries = ["*"];
          updates.employmentTypes = ["permanent", "contract", "internship"];
          updates.workArrangements = ["onsite", "hybrid", "remote"];
          break;

        case "GOVERNMENT_NATIONAL":
          updates.sourceKind = "GOVERNMENT_PORTAL";
          updates.countries = ["KE"];
          updates.industries = ["public-sector", "education", "healthcare"];
          updates.employmentTypes = ["permanent", "contract"];
          updates.workArrangements = ["onsite"];
          break;

        case "COUNTY_GOVERNMENT":
          updates.sourceKind = "GOVERNMENT_PORTAL";
          updates.countries = ["KE"];
          updates.industries = ["public-sector", "healthcare", "education", "agriculture"];
          updates.employmentTypes = ["permanent", "contract"];
          updates.workArrangements = ["onsite"];
          break;

        case "BANK_FINTECH":
          updates.sourceKind = "EMPLOYER_CAREERS";
          updates.countries = ["KE", "UG", "TZ", "RW"];
          updates.industries = ["finance", "banking", "technology"];
          updates.employmentTypes = ["permanent", "contract"];
          updates.workArrangements = ["onsite", "hybrid"];
          break;

        case "NGO_INTERNATIONAL":
          updates.sourceKind = "EMPLOYER_CAREERS";
          updates.countries = ["KE", "*"];
          updates.industries = ["ngo", "development", "healthcare", "education"];
          updates.employmentTypes = ["permanent", "contract"];
          updates.workArrangements = ["onsite", "hybrid", "remote"];
          break;

        case "TECH_EMPLOYER":
          updates.sourceKind = "EMPLOYER_CAREERS";
          updates.countries = ["KE", "*"];
          updates.industries = ["technology"];
          updates.employmentTypes = ["permanent", "contract", "internship"];
          updates.workArrangements = ["onsite", "hybrid", "remote"];
          break;

        case "GLOBAL_REMOTE":
          updates.sourceKind = "GENERAL_BOARD";
          updates.countries = ["*"];
          updates.workArrangements = ["remote"];
          updates.industries = ["technology", "marketing", "design", "customer-support", "finance"];
          updates.employmentTypes = ["permanent", "contract", "freelance"];
          break;

        case "AGGREGATOR":
          updates.sourceKind = "AGGREGATOR";
          updates.countries = src.country?.toLowerCase() === "kenya" ? ["KE"] : ["*"];
          updates.industries = ["*"];
          updates.employmentTypes = ["permanent", "contract", "freelance", "internship"];
          updates.workArrangements = ["onsite", "hybrid", "remote"];
          break;

        case "RECRUITMENT_AGENCY":
          updates.sourceKind = "RECRUITER";
          updates.countries = ["KE"];
          updates.industries = ["*"];
          updates.employmentTypes = ["permanent", "contract"];
          updates.workArrangements = ["onsite", "hybrid"];
          break;

        default:
          if (!src.sourceKind || src.sourceKind === "GENERAL_BOARD") {
            updates.sourceKind = "GENERAL_BOARD";
            updates.countries = src.country?.toLowerCase() === "kenya" ? ["KE"] : ["*"];
            updates.industries = ["*"];
          }
          break;
      }
    }

    // Default searchUrlTemplate if available
    if (!src.searchUrlTemplate && src.canonicalUrl) {
      if (src.canonicalUrl.includes("{query}")) {
        updates.searchUrlTemplate = src.canonicalUrl;
      } else {
        updates.searchUrlTemplate = `${src.canonicalUrl.replace(/\/+$/, "")}/jobs?q={query}`;
      }
    }

    // Default yieldRate
    if (src.yieldRate === null || src.yieldRate === undefined) {
      const discovered = src.totalDiscovered || 0;
      const indexed = src.totalIndexed || 0;
      updates.yieldRate = discovered > 0 ? Math.min(1.0, indexed / discovered) : 0.5;
    }

    if (Object.keys(updates).length > 0) {
      await db
        .update(jobSourcesTable)
        .set(updates as any)
        .where(eq(jobSourcesTable.id, src.id))
        .catch(() => {});
    }
  }
}

/**
 * Migrate county_registry to universal admin_regions
 */
export async function migrateCountyRegistryToAdminRegions(): Promise<void> {
  try {
    const existingAdminCounties = await db.select({ id: adminRegionsTable.id }).from(adminRegionsTable).limit(1);
    if (existingAdminCounties.length > 0) return; // Already migrated

    const counties = await db.select().from(countyRegistryTable);
    for (const c of counties) {
      await db
        .insert(adminRegionsTable)
        .values({
          id: `ke-${c.id}`,
          countryCode: "KE",
          level: "county",
          code: String(c.code).padStart(3, "0"),
          name: c.name,
          officialWebsite: c.officialWebsite,
          recruitmentUrl: c.recruitmentUrl || c.cpsbUrl,
          announcementsUrl: c.announcementsUrl,
          status: c.status || "CONFIGURED",
          lastCheckedAt: c.lastCheckedAt,
          lastError: c.lastError,
        })
        .onConflictDoNothing()
        .catch(() => {});
    }
    console.log(`[RegistryMigration] Migrated ${counties.length} counties to admin_regions.`);
  } catch (err: any) {
    console.warn("[RegistryMigration] admin_regions migration notice:", err?.message || err);
  }
}

/**
 * Seed universal occupation taxonomy from ISCO-08
 */
export async function seedOccupationTaxonomy(): Promise<void> {
  const count = await db.select({ id: occupationTaxonomyTable.id }).from(occupationTaxonomyTable).limit(1);
  if (count.length > 0) return; // Already seeded

  const iscoTaxonomy = [
    // Health Professionals (Group 22)
    {
      id: "isco-2211",
      iscoCode: "2211",
      title: "Generalist Medical Practitioners",
      parentId: "isco-22",
      synonyms: ["Medical Doctor", "Physician", "Medical Officer", "General Practitioner", "Clinical Medical Officer"],
      industries: ["healthcare", "hospital", "medicine"],
      typicalRegistrations: ["KMPDC", "GMC", "Medical Board"],
      searchKeywords: ["medical officer", "doctor", "physician", "general practitioner", "clinical officer"],
    },
    {
      id: "isco-2212",
      iscoCode: "2212",
      title: "Specialist Medical Practitioners & Surgeons",
      parentId: "isco-22",
      synonyms: ["General Surgeon", "Consultant Surgeon", "Surgeon", "Pediatrician", "Gynecologist", "Anesthesiologist", "Physician Specialist"],
      industries: ["healthcare", "surgery", "hospital"],
      typicalRegistrations: ["KMPDC", "FWACS", "FRCS", "FACS"],
      searchKeywords: ["surgeon", "consultant surgeon", "specialist doctor", "pediatrician", "obstetrician"],
    },
    {
      id: "isco-2221",
      iscoCode: "2221",
      title: "Nursing Professionals",
      parentId: "isco-22",
      synonyms: ["Registered Nurse", "Clinical Nurse Specialist", "Nursing Officer", "Staff Nurse", "Critical Care Nurse"],
      industries: ["healthcare", "nursing", "hospital"],
      typicalRegistrations: ["NCK", "Nursing Council"],
      searchKeywords: ["nurse", "nursing officer", "registered nurse", "bsn nurse", "clinical nurse"],
    },
    {
      id: "isco-2262",
      iscoCode: "2262",
      title: "Pharmacists",
      parentId: "isco-22",
      synonyms: ["Pharmacist", "Clinical Pharmacist", "Hospital Pharmacist", "Industrial Pharmacist"],
      industries: ["healthcare", "pharmaceuticals"],
      typicalRegistrations: ["PPB", "Pharmacy Board"],
      searchKeywords: ["pharmacist", "pharmacy officer", "clinical pharmacist"],
    },

    // Science & Engineering Professionals (Group 21)
    {
      id: "isco-2142",
      iscoCode: "2142",
      title: "Civil Engineers",
      parentId: "isco-21",
      synonyms: ["Civil Engineer", "Structural Engineer", "Site Engineer", "Construction Project Engineer", "Highway Engineer"],
      industries: ["engineering", "construction", "infrastructure"],
      typicalRegistrations: ["EBK", "IEK", "Board of Engineers"],
      searchKeywords: ["civil engineer", "structural engineer", "site engineer", "construction engineer"],
    },
    {
      id: "isco-2144",
      iscoCode: "2144",
      title: "Mechanical Engineers",
      parentId: "isco-21",
      synonyms: ["Mechanical Engineer", "Plant Engineer", "HVAC Engineer", "Maintenance Engineer"],
      industries: ["engineering", "manufacturing", "energy"],
      typicalRegistrations: ["EBK", "IEK"],
      searchKeywords: ["mechanical engineer", "plant engineer", "maintenance engineer", "hvac"],
    },
    {
      id: "isco-2151",
      iscoCode: "2151",
      title: "Electrical Engineers",
      parentId: "isco-21",
      synonyms: ["Electrical Engineer", "Power Systems Engineer", "Electronics Engineer", "Electrical Project Engineer"],
      industries: ["engineering", "energy", "power"],
      typicalRegistrations: ["EBK", "IEK", "EPRA"],
      searchKeywords: ["electrical engineer", "power systems engineer", "electronics engineer"],
    },

    // Business & Administration Professionals (Group 24)
    {
      id: "isco-2411",
      iscoCode: "2411",
      title: "Accountants & Financial Auditors",
      parentId: "isco-24",
      synonyms: ["Accountant", "Financial Accountant", "Internal Auditor", "External Auditor", "Chartered Accountant", "Management Accountant"],
      industries: ["finance", "accounting", "banking", "audit"],
      typicalRegistrations: ["ICPAK", "ACCA", "CPA"],
      searchKeywords: ["accountant", "auditor", "cpa", "finance officer", "financial accountant"],
    },
    {
      id: "isco-2412",
      iscoCode: "2412",
      title: "Financial & Investment Analysts",
      parentId: "isco-24",
      synonyms: ["Financial Analyst", "Investment Analyst", "Credit Analyst", "Risk Analyst", "Budget Analyst"],
      industries: ["finance", "banking", "investments"],
      typicalRegistrations: ["CFA", "ICIFA"],
      searchKeywords: ["financial analyst", "investment analyst", "credit analyst", "risk analyst"],
    },
    {
      id: "isco-2421",
      iscoCode: "2421",
      title: "Management & Organization Analysts / Operations",
      parentId: "isco-24",
      synonyms: ["Operations Manager", "Program Manager", "Project Coordinator", "Administrative Officer", "Business Analyst"],
      industries: ["operations", "public-sector", "ngo", "corporate"],
      typicalRegistrations: [],
      searchKeywords: ["operations manager", "project coordinator", "program manager", "administrative officer"],
    },
    {
      id: "isco-2431",
      iscoCode: "2431",
      title: "Advertising & Marketing Professionals",
      parentId: "isco-24",
      synonyms: ["Marketing Specialist", "Digital Marketer", "Brand Manager", "Growth Marketer", "Content Strategist"],
      industries: ["marketing", "media", "commerce"],
      typicalRegistrations: ["MSK"],
      searchKeywords: ["marketing specialist", "digital marketing", "brand manager", "seo specialist"],
    },

    // Legal Professionals (Group 26)
    {
      id: "isco-2611",
      iscoCode: "2611",
      title: "Lawyers & Legal Counsel",
      parentId: "isco-26",
      synonyms: ["Advocate", "Lawyer", "Legal Counsel", "Legal Officer", "Corporate Counsel", "Litigation Associate"],
      industries: ["legal", "corporate", "judiciary"],
      typicalRegistrations: ["LSK", "Bar Association"],
      searchKeywords: ["advocate", "lawyer", "legal counsel", "legal officer", "corporate counsel"],
    },

    // Teaching & Education Professionals (Group 23)
    {
      id: "isco-2330",
      iscoCode: "2330",
      title: "Secondary & High School Teachers",
      parentId: "isco-23",
      synonyms: ["High School Teacher", "Secondary Teacher", "Senior Teacher", "Tutor", "Educator"],
      industries: ["education"],
      typicalRegistrations: ["TSC"],
      searchKeywords: ["teacher", "high school teacher", "secondary teacher", "tsc"],
    },
    {
      id: "isco-2310",
      iscoCode: "2310",
      title: "University & Higher Education Lecturers",
      parentId: "isco-23",
      synonyms: ["Lecturer", "Assistant Professor", "Professor", "Tutorial Fellow", "Academic Researcher"],
      industries: ["education", "higher-education", "research"],
      typicalRegistrations: [],
      searchKeywords: ["lecturer", "professor", "tutorial fellow", "university lecturer"],
    },

    // ICT Professionals (Group 25)
    {
      id: "isco-2512",
      iscoCode: "2512",
      title: "Software Developers & Engineers",
      parentId: "isco-25",
      synonyms: ["Software Engineer", "Full Stack Developer", "Backend Developer", "Frontend Developer", "Mobile Developer"],
      industries: ["technology"],
      typicalRegistrations: [],
      searchKeywords: ["software engineer", "software developer", "full stack", "react", "python developer"],
    },
    {
      id: "isco-2522",
      iscoCode: "2522",
      title: "Systems Administrators & DevOps Engineers",
      parentId: "isco-25",
      synonyms: ["Systems Administrator", "DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer", "Linux Administrator"],
      industries: ["technology"],
      typicalRegistrations: [],
      searchKeywords: ["systems administrator", "devops", "cloud engineer", "sysadmin"],
    },
    {
      id: "isco-2519",
      iscoCode: "2519",
      title: "ICT & Technical Support Specialists",
      parentId: "isco-25",
      synonyms: ["ICT Officer", "IT Support Specialist", "Technical Support Engineer", "Helpdesk Specialist"],
      industries: ["technology"],
      typicalRegistrations: [],
      searchKeywords: ["ict officer", "it support", "technical support", "helpdesk"],
    },

    // Electrical Trades (Group 74)
    {
      id: "isco-7411",
      iscoCode: "7411",
      title: "Building & Industrial Electricians",
      parentId: "isco-74",
      synonyms: ["Electrician", "Electrical Technician", "Wireman", "Maintenance Electrician"],
      industries: ["construction", "energy", "maintenance"],
      typicalRegistrations: ["EPRA"],
      searchKeywords: ["electrician", "electrical technician", "wireman"],
    },
  ];

  for (const item of iscoTaxonomy) {
    await db
      .insert(occupationTaxonomyTable)
      .values(item)
      .onConflictDoNothing()
      .catch(() => {});
  }
  console.log(`[RegistryMigration] Seeded ${iscoTaxonomy.length} occupations into occupation_taxonomy.`);
}

/**
 * Execute full startup registry migration and clean-up
 */
export async function runFullRegistryMigration(): Promise<void> {
  console.log("[RegistryMigration] Running schema & taxonomy alignment...");
  await purgeJobStubsAndInvalidRows();
  await migrateAndBackfillJobSources();
  await migrateCountyRegistryToAdminRegions();
  await seedOccupationTaxonomy();
  console.log("[RegistryMigration] Alignment complete.");
}
