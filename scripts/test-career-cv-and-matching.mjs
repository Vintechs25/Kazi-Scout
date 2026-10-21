import { parseCvLocally, sanitizeProfileDraft } from "../artifacts/api-server/dist/routes/cvs.mjs";
import { evaluatePreIngestionGate } from "../artifacts/api-server/dist/lib/pre-ingestion-gate.mjs";

console.log("===================================================================");
console.log(" MULTI-CAREER CV PARSING & PRE-INGESTION GATE VALIDATION TEST");
console.log("===================================================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

// 1. Agriculture / Agribusiness
console.log("Testing 1: Agronomist & Agribusiness Specialist");
const agriCv = `
Dr. John Mwangi
Email: j.mwangi@example.co.ke | Phone: +254 712 345 678 | Location: Nakuru, Kenya
Professional Summary:
Dedicated Senior Agronomist with 9 years of experience managing large-scale crop production, irrigation systems, soil fertility analysis, and agribusiness farm operations across the Rift Valley.
Education:
B.Sc. in Agriculture and Crop Sciences - Egerton University (2015)
Core Competencies:
Agronomy, Crop Management, Soil Testing, Farm Management, Irrigation Scheduling, Agribusiness Planning, Fertilizer Formulation.
Experience:
Senior Agronomist at Rift Valley Agribusiness Ltd (2018 - 2026)
- Managed 500-hectare commercial maize and horticulture farm.
`;
const agriDraft = sanitizeProfileDraft(parseCvLocally(agriCv));
assert(agriDraft.targetRoles.some(r => /agronom|agricultur/i.test(r)), `Agri CV target roles detected: ${JSON.stringify(agriDraft.targetRoles)}`);
assert(agriDraft.industries.some(i => /agri/i.test(i)), `Agri CV industry detected: ${JSON.stringify(agriDraft.industries)}`);
assert(agriDraft.yearsExperience >= 9, `Years experience parsed: ${agriDraft.yearsExperience}`);

// Check pre-ingestion gate for Agricultural jobs
const agriListing = {
  id: "test-agri-1",
  title: "Agronomist / Farm Operations Lead",
  company: "Kakuzi PLC",
  description: "Seeking an experienced Agronomist to lead crop nutrition, pest scouting, and irrigation systems.",
  location: "Murang'a, Kenya",
  country: "Kenya"
};
const agriGate = evaluatePreIngestionGate(agriListing, {
  targetRoleFamilies: agriDraft.targetRoles,
  alternativeJobTitles: [],
  candidateYearsExperience: agriDraft.yearsExperience,
  seniorityLevel: "Senior",
});
assert(agriGate.qualified === true, `Agri job qualified via gate: ${JSON.stringify(agriGate)}`);

// 2. Healthcare / Surgeon
console.log("\nTesting 2: Consultant Surgeon / Medical Specialist");
const doctorCv = `
Dr. Faith Achieng, FWACS, MBChB
Email: faith.achieng@hospital.co.ke | Phone: +254 722 999 888 | Location: Nairobi, Kenya
Summary:
Consultant General Surgeon with 12 years of clinical practice. Extensive expertise in general surgery, laparoscopic procedures, surgical oncology, patient consultation, and emergency surgical care.
Qualifications:
Bachelor of Medicine and Bachelor of Surgery (MBChB) - University of Nairobi (2012)
Fellow of the West African College of Surgeons (FWACS) (2018)
Experience:
Senior Consultant Surgeon at Aga Khan University Hospital (2019 - 2026)
`;
const doctorDraft = sanitizeProfileDraft(parseCvLocally(doctorCv));
assert(doctorDraft.targetRoles.some(r => /surgeon|doctor/i.test(r)), `Doctor CV target roles detected: ${JSON.stringify(doctorDraft.targetRoles)}`);
assert(doctorDraft.industries.some(i => /surgery|healthcare/i.test(i)), `Doctor CV industry detected: ${JSON.stringify(doctorDraft.industries)}`);
assert(doctorDraft.certifications.some(c => /FWACS/i.test(c)), `FWACS certification recognized: ${JSON.stringify(doctorDraft.certifications)}`);

const doctorListing = {
  id: "test-doctor-1",
  title: "General Surgeon / Clinical Specialist",
  company: "The Nairobi Hospital",
  description: "Full-time position for a board-certified General Surgeon with laparoscopic experience.",
  location: "Nairobi, Kenya",
  country: "Kenya"
};
const doctorGate = evaluatePreIngestionGate(doctorListing, {
  targetRoleFamilies: doctorDraft.targetRoles,
  alternativeJobTitles: [],
  candidateYearsExperience: doctorDraft.yearsExperience,
  seniorityLevel: "Senior",
});
assert(doctorGate.qualified === true, `Surgeon job qualified via gate: ${JSON.stringify(doctorGate)}`);

// 3. Finance & Accounting / CPA-K
console.log("\nTesting 3: Chartered Accountant (CPA-K)");
const financeCv = `
Kelvin Kimani, CPA-K
Email: kelvin.kimani@finance.co.ke | Phone: +254 733 111 222 | Location: Nairobi, Kenya
Professional Profile:
Senior Financial Accountant and Auditor with 7 years of professional experience in financial reporting, external audit, IFRS compliance, tax filings with KRA, and budgeting.
Professional Qualifications:
Certified Public Accountant of Kenya (CPA-K) - ICPAK Member (2017)
Bachelor of Commerce (Finance Option) - Strathmore University (2016)
Work Experience:
Audit Senior at PricewaterhouseCoopers (PwC) Kenya (2019 - 2026)
`;
const financeDraft = sanitizeProfileDraft(parseCvLocally(financeCv));
assert(financeDraft.targetRoles.some(r => /accountant|financial|audit/i.test(r)), `Finance CV target roles detected: ${JSON.stringify(financeDraft.targetRoles)}`);
assert(financeDraft.industries.some(i => /accounting|finance/i.test(i)), `Finance CV industry detected: ${JSON.stringify(financeDraft.industries)}`);

const financeListing = {
  id: "test-fin-1",
  title: "Financial Accountant / Audit Senior",
  company: "Equity Group Holdings",
  description: "Responsible for IFRS statutory reporting, general ledger reconciliations, and tax compliance.",
  location: "Nairobi, Kenya",
  country: "Kenya"
};
const finGate = evaluatePreIngestionGate(financeListing, {
  targetRoleFamilies: financeDraft.targetRoles,
  alternativeJobTitles: [],
  candidateYearsExperience: financeDraft.yearsExperience,
  seniorityLevel: "Senior",
});
assert(finGate.qualified === true, `Finance job qualified via gate: ${JSON.stringify(finGate)}`);

// 4. Procurement & Supply Chain
console.log("\nTesting 4: Procurement & Supply Chain Specialist");
const procCv = `
Mercy Chebet
Email: mercy.chebet@supply.co.ke | Phone: +254 701 444 555 | Location: Mombasa, Kenya
Profile:
Procurement Officer with 6 years of experience in public procurement (PPADA 2015), tender preparation, vendor management, warehouse logistics, and contract negotiations.
Education & Certifications:
B.Sc. in Supply Chain Management - JKUAT (2018)
Certified Procurement and Supply Professional of Kenya (CPSP-K) - KISM
Experience:
Procurement Officer at Kenya Ports Authority (2020 - 2026)
`;
const procDraft = sanitizeProfileDraft(parseCvLocally(procCv));
assert(procDraft.targetRoles.some(r => /procurement|supply/i.test(r)), `Procurement CV target roles detected: ${JSON.stringify(procDraft.targetRoles)}`);
assert(procDraft.industries.some(i => /supply chain|procurement/i.test(i)), `Procurement CV industry detected: ${JSON.stringify(procDraft.industries)}`);

const procListing = {
  id: "test-proc-1",
  title: "Senior Procurement Officer",
  company: "Safaricom PLC",
  description: "Leading strategic sourcing, supplier evaluations, contract management, and ERP purchase orders.",
  location: "Nairobi, Kenya",
  country: "Kenya"
};
const procGate = evaluatePreIngestionGate(procListing, {
  targetRoleFamilies: procDraft.targetRoles,
  alternativeJobTitles: [],
  candidateYearsExperience: procDraft.yearsExperience,
  seniorityLevel: "Senior",
});
assert(procGate.qualified === true, `Procurement job qualified via gate: ${JSON.stringify(procGate)}`);

// 5. Human Resources
console.log("\nTesting 5: Human Resources Officer");
const hrCv = `
Wanjiku Njoroge
Email: wanjiku.hr@people.co.ke | Phone: +254 711 777 888 | Location: Nairobi, Kenya
Professional Summary:
HR Specialist with 8 years of experience in talent acquisition, employee relations, Kenyan employment law, payroll management, and performance management.
Education:
Bachelor of Human Resource Management - Kenyatta University (2016)
IHRM Certified HR Practitioner
Experience:
Human Resources Officer at Britam Kenya (2018 - 2026)
`;
const hrDraft = sanitizeProfileDraft(parseCvLocally(hrCv));
assert(hrDraft.targetRoles.some(r => /human resources|talent|hr/i.test(r)), `HR CV target roles detected: ${JSON.stringify(hrDraft.targetRoles)}`);
assert(hrDraft.industries.some(i => /human resources|talent/i.test(i)), `HR CV industry detected: ${JSON.stringify(hrDraft.industries)}`);

const hrListing = {
  id: "test-hr-1",
  title: "Human Resources Officer / Talent Partner",
  company: "KCB Bank Kenya",
  description: "Manage end-to-end talent acquisition, onboarding, and employee relations in compliance with Kenyan labor laws.",
  location: "Nairobi, Kenya",
  country: "Kenya"
};
const hrGate = evaluatePreIngestionGate(hrListing, {
  targetRoleFamilies: hrDraft.targetRoles,
  alternativeJobTitles: [],
  candidateYearsExperience: hrDraft.yearsExperience,
  seniorityLevel: "Senior",
});
assert(hrGate.qualified === true, `HR job qualified via gate: ${JSON.stringify(hrGate)}`);

console.log("\n===================================================================");
console.log(` RESULTS: ${passed} PASSED, ${failed} FAILED`);
console.log("===================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("ALL MULTI-CAREER CV AND PRE-INGESTION CRITERIA VERIFIED 100%!");
}
