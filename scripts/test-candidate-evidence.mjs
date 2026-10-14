import { getOrGenerateCandidateEvidence } from "../artifacts/api-server/src/lib/candidate-evidence.js";

async function main() {
  console.log("Generating Candidate Evidence Profile from Master CV...");
  const evidence = await getOrGenerateCandidateEvidence(true);
  console.log("SOURCE:", evidence.source);
  console.log("PROVIDER:", evidence.providerUsed);
  console.log("MODEL:", evidence.modelUsed);
  console.log("EVIDENCE SUMMARY:");
  console.log("- Full Name:", evidence.fullName);
  console.log("- Years Experience:", evidence.yearsExperience);
  console.log("- Target Roles:", evidence.targetRoleFamilies);
  console.log("- Demonstrated Skills:", evidence.demonstratedTechnicalSkills);
  console.log("- Verified Work Experience:", evidence.verifiedWorkExperience.map(w => `${w.title} at ${w.company} (${w.isProfessional ? 'Professional' : 'Freelance/Side'})`));
  console.log("- Certifications:", evidence.certifications.map(c => c.name));
  console.log("- Education:", evidence.education.map(e => `${e.qualification} (${e.institution})`));
  console.log("- Limitations:", evidence.limitationsOrMissingInfo);
}

main().catch(console.error);
