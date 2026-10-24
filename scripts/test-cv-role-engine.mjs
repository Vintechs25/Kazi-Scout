import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { parseCvDeterministic, toProfileDraft } = await import(
  pathToFileURL(path.join(root, "artifacts", "api-server", "dist", "lib", "cv-role-engine.mjs")).href
);

console.log("===================================================================");
console.log(" TEST SUITE: DETERMINISTIC CV ROLE & EXPERIENCE EXTRACTION ENGINE");
console.log("===================================================================\n");

let passed = 0;
let failed = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failed++;
  }
}

// -------------------------------------------------------------
// Test 1: DevOps & Cloud Infrastructure Engineer CV
// -------------------------------------------------------------
run("DevOps/Cloud CV: extracts real current role, company, years & taxonomy roles", () => {
  const cvText = `
    Alex Mutua
    Email: alex.mutua@cloudtech.co.ke
    Phone: +254 711 234 567
    Nairobi, Kenya

    PROFESSIONAL SUMMARY
    Senior DevOps Engineer and Cloud Solutions Architect with 7 years of experience designing and managing resilient multi-region Kubernetes infrastructure on AWS and GCP.

    PROFESSIONAL EXPERIENCE
    Senior DevOps Engineer | Safaricom PLC | 2021 - Present
    - Architected Kubernetes clusters on AWS EKS serving 10M+ daily transactions.
    - Automated CI/CD deployments using Terraform, GitHub Actions, and ArgoCD.

    Cloud Infrastructure Engineer | Cellulant Kenya | 2018 - 2021
    - Managed Docker microservices and PostgreSQL replication across hybrid cloud environments.
    - Implemented Prometheus, Grafana, and Datadog monitoring for 99.99% uptime.

    EDUCATION
    - Bachelor of Science in Computer Science, University of Nairobi (2014 - 2018)

    CERTIFICATIONS
    - AWS Certified Solutions Architect - Professional
    - Certified Kubernetes Administrator (CKA)
  `;

  const parsed = parseCvDeterministic(cvText);

  assert.equal(parsed.fullName, "Alex Mutua");
  assert.equal(parsed.email, "alex.mutua@cloudtech.co.ke");
  assert.equal(parsed.currentRole, "Senior DevOps Engineer");
  assert.equal(parsed.currentCompany, "Safaricom PLC");
  assert.ok(parsed.yearsExperience >= 5, `Expected >= 5 years, got ${parsed.yearsExperience}`);
  assert.ok(parsed.workExperience.length >= 2, `Expected at least 2 work positions, got ${parsed.workExperience.length}`);
  assert.equal(parsed.workExperience[0].roleTitle, "Senior DevOps Engineer");
  assert.equal(parsed.workExperience[0].company, "Safaricom PLC");
  assert.ok(parsed.workExperience[0].isCurrent, "First position should be current");

  assert.ok(
    parsed.targetRoles.some(r => /devops|cloud|infrastructure|sre/i.test(r)),
    `Expected target roles to contain devops/cloud, got: ${parsed.targetRoles.join(", ")}`
  );
  assert.ok(
    parsed.technologies.some(t => /kubernetes|docker|terraform|aws/i.test(t)),
    `Expected technologies to contain AWS/Docker/K8s, got: ${parsed.technologies.join(", ")}`
  );
  assert.ok(
    parsed.certifications.some(c => /aws|kubernetes|cka/i.test(c)),
    `Expected certifications, got: ${parsed.certifications.join(", ")}`
  );
});

// -------------------------------------------------------------
// Test 2: Medical Doctor / Consultant Surgeon CV
// -------------------------------------------------------------
run("Medical Surgeon CV: extracts surgeon role, KMPDC license, FWACS & hospital positions", () => {
  const cvText = `
    CURRICULUM VITAE OF DR. BEATRICE OCHIENG
    Email: beatrice.ochieng@hospital.org
    Phone: +254 722 987 654
    Location: Kisumu, Kenya

    PROFESSIONAL SUMMARY
    Consultant Surgeon and General Surgeon with 12 years of clinical practice in emergency abdominal surgery, laparoscopic procedures, patient triage, and surgical residency training.

    WORK EXPERIENCE
    Consultant General Surgeon | Kisumu County Referral Hospital | 2018 - Present
    - Performed emergency and elective laparoscopic surgeries.
    - Led surgical ward rounds and supervised junior medical officers.

    Medical Officer | Kenyatta National Hospital | 2012 - 2018
    - Managed acute surgical admissions and intensive care trauma stabilization.

    EDUCATION & CREDENTIALS
    - Bachelor of Medicine, Bachelor of Surgery (M.B., B.S.), Makerere University
    - Master of Medicine in Surgery (MMed)

    CERTIFICATIONS & LICENSURE
    - Fellow of the West African College of Surgeons (FWACS)
    - Licensed Specialist with Kenya Medical Practitioners and Dentists Council (KMPDC)
  `;

  const parsed = parseCvDeterministic(cvText);

  assert.ok(/beatrice\s+ochieng/i.test(parsed.fullName), `Name should match, got: ${parsed.fullName}`);
  assert.equal(parsed.currentRole, "Consultant General Surgeon");
  assert.equal(parsed.currentCompany, "Kisumu County Referral Hospital");
  assert.ok(parsed.yearsExperience >= 10, `Expected >= 10 years, got: ${parsed.yearsExperience}`);
  assert.ok(parsed.workExperience.length >= 2, `Expected at least 2 positions, got: ${parsed.workExperience.length}`);
  assert.ok(
    parsed.targetRoles.some(r => /surgeon|doctor|physician/i.test(r)),
    `Target roles should contain surgical titles, got: ${parsed.targetRoles.join(", ")}`
  );
  assert.ok(
    parsed.certifications.some(c => /kmpdc|fwacs/i.test(c)),
    `Certifications should contain KMPDC/FWACS, got: ${parsed.certifications.join(", ")}`
  );
});

// -------------------------------------------------------------
// Test 3: Chartered Accountant & Internal Auditor CV
// -------------------------------------------------------------
run("Accounting CV: extracts Chartered Accountant, audit experience, CPA-K", () => {
  const cvText = `
    David Kiprop, CPA
    david.kiprop@auditke.com | +254 720 123 456 | Nairobi, Kenya

    CAREER OBJECTIVE
    Senior Internal Auditor & Certified Public Accountant with 8 years of assurance, risk advisory, and corporate tax expertise.

    EMPLOYMENT HISTORY
    Senior Internal Auditor | KPMG East Africa | 2020 - Present
    - Led financial statement audits and risk assessments for listed commercial banks.

    Financial Analyst | Equity Bank Kenya | 2016 - 2020
    - Prepared quarterly management accounts and variance analysis reports.

    EDUCATION
    - Bachelor of Commerce in Accounting, Strathmore University (2012 - 2016)

    CERTIFICATIONS
    - Certified Public Accountant of Kenya (CPA-K)
    - Certified Information Systems Auditor (CISA)
  `;

  const parsed = parseCvDeterministic(cvText);

  assert.ok(/david\s+kiprop/i.test(parsed.fullName), `Name should match, got: ${parsed.fullName}`);
  assert.equal(parsed.currentRole, "Senior Internal Auditor");
  assert.equal(parsed.currentCompany, "KPMG East Africa");
  assert.ok(parsed.yearsExperience >= 7, `Expected >= 7 years, got: ${parsed.yearsExperience}`);
  assert.ok(
    parsed.targetRoles.some(r => /accountant|auditor|financial/i.test(r)),
    `Target roles should contain accounting/audit, got: ${parsed.targetRoles.join(", ")}`
  );
  assert.ok(
    parsed.certifications.some(c => /cpa|cisa/i.test(c)),
    `Certifications should contain CPA/CISA, got: ${parsed.certifications.join(", ")}`
  );
});

// -------------------------------------------------------------
// Test 4: Profile Draft Compatibility Check
// -------------------------------------------------------------
run("toProfileDraft: output conforms to standard profile draft schema", () => {
  const sample = parseCvDeterministic("Jane Doe\njane@example.com\n+254 700 000 000\nSoftware Developer | Cellulant | 2022 - Present\n");
  const draft = toProfileDraft(sample);

  assert.ok(draft.fullName);
  assert.ok(draft.email);
  assert.ok(Array.isArray(draft.targetRoles));
  assert.ok(draft.targetRoles.length > 0);
  assert.ok(typeof draft.yearsExperience === "number");
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
