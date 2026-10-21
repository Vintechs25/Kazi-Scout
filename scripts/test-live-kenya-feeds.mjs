const r1 = await fetch('https://www.careerpointkenya.co.ke/category/medical-jobs-in-kenya/feed/');
console.log('CareerPoint medical feed status:', r1.status);
const xml = await r1.text();
const titles1 = (xml.match(/<title>(.*?)<\/title>/g) || []).map(t => t.replace(/<\/?title>/g, '')).slice(0, 10);
console.log('CareerPoint medical jobs:');
titles1.forEach((t, i) => console.log(`  ${i+1}. ${t}`));

const r2 = await fetch('https://www.corporatestaffing.co.ke/tag/medical-officer-jobs-in-kenya/');
console.log('\nCorporate Staffing medical tag status:', r2.status);
const html2 = await r2.text();
const matches = [...html2.matchAll(/<a[^>]+href="([^"]*(?:job|vacancy)[^"]*)"[^>]*>(.*?)<\/a>/gi)];
console.log('Corporate Staffing medical jobs found:', matches.length);
matches.slice(0, 10).forEach((m, i) => {
  const cleanTitle = m[2].replace(/<[^>]+>/g, '').trim();
  if (cleanTitle && cleanTitle.length > 5) {
    console.log(`  ${i+1}. ${cleanTitle} -> ${m[1]}`);
  }
});
