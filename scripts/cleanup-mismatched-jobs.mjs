import Database from "better-sqlite3";

const db = new Database("./storage/data/ai-job-agent.sqlite");

console.log("Checking for mismatched non-medical consultant jobs in active records...");

const mismatched = db.prepare(`
  SELECT id, title, company, status, ai_decision, match_score, account_id 
  FROM jobs 
  WHERE (
    title LIKE '%Travel Consultant%' OR 
    title LIKE '%Customer Support Consultant%' OR 
    title LIKE '%SAP%Consultant%'
  )
`).all();

console.log("Found mismatched listings:", JSON.stringify(mismatched, null, 2));

const updateStmt = db.prepare(`
  UPDATE jobs 
  SET status = 'REJECTED', 
      ai_decision = 'NOT_A_MATCH', 
      match_score = 0,
      rejection_reason = 'Cross-domain mismatch: Position is outside candidate target clinical/medical domain'
  WHERE (
    title LIKE '%Travel Consultant%' OR 
    title LIKE '%Customer Support Consultant%' OR 
    title LIKE '%SAP%Consultant%'
  )
`);

const result = updateStmt.run();
console.log(`Updated ${result.changes} mismatched listings to REJECTED with ai_decision = NOT_A_MATCH.`);
