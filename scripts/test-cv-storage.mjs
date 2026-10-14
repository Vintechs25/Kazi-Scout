import { getVerifiedMasterCv } from "../artifacts/api-server/src/lib/cv-storage.js";

async function main() {
  const dossier = await getVerifiedMasterCv();
  console.log("Master CV Dossier:", {
    loaded: dossier.loaded,
    charCount: dossier.charCount,
    fingerprint: dossier.fingerprint,
    diagnostic: dossier.diagnostic,
    error: dossier.error,
  });
}

main().catch(console.error);
