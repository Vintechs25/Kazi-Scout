async function inspectHtml() {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' };
  
  // 1. MyJobMag IT page
  console.log('--- Fetching MyJobMag ---');
  try {
    const mjm = await fetch('https://www.myjobmag.co.ke/jobs-by-field/information-technology', { headers });
    const mjmHtml = await mjm.text();
    const h2s = mjmHtml.match(/<h2[^>]*>[\s\S]*?<\/h2>/gi);
    console.log('MyJobMag h2 count:', h2s ? h2s.length : 0);
    if (h2s) console.log('MyJobMag h2 sample:', h2s.slice(0, 3));
    
    // Check links inside h2 or ul.job-list
    const jobLinks = mjmHtml.match(/<a[^>]+href="(\/job\/[^"]+)"[^>]*>(.*?)<\/a>/gi);
    console.log('MyJobMag /job/ links:', jobLinks ? jobLinks.length : 0);
    if (jobLinks) console.log('MyJobMag sample links:', jobLinks.slice(0, 3));
  } catch (e) {
    console.log('MyJobMag err:', e.message);
  }

  // 2. BrighterMonday jobs
  console.log('--- Fetching BrighterMonday ---');
  try {
    const bm = await fetch('https://www.brightermonday.co.ke/jobs/software-data', { headers });
    const bmHtml = await bm.text();
    const bmListings = bmHtml.match(/href="([^"]*\/listings\/[^"]+)"/gi);
    console.log('BrighterMonday /listings/ links:', bmListings ? bmListings.length : 0);
    if (bmListings) console.log('BrighterMonday sample links:', bmListings.slice(0, 5));
    
    // Check job titles in BrighterMonday
    const bmTitles = bmHtml.match(/<p[^>]*class="[^"]*text-lg[^"]*"[^>]*>(.*?)<\/p>/gi) ||
                     bmHtml.match(/<h3[^>]*>[\s\S]*?<\/h3>/gi);
    console.log('BrighterMonday titles count:', bmTitles ? bmTitles.length : 0);
    if (bmTitles) console.log('BrighterMonday sample titles:', bmTitles.slice(0, 3));
  } catch (e) {
    console.log('BrighterMonday err:', e.message);
  }

  // 3. CareerPoint IT RSS
  console.log('--- Fetching CareerPoint IT RSS ---');
  try {
    const cp = await fetch('https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/', { headers });
    const cpXml = await cp.text();
    const cpItems = cpXml.match(/<item[\s>]/gi);
    console.log('CareerPoint IT items count:', cpItems ? cpItems.length : 0);
  } catch (e) {
    console.log('CareerPoint err:', e.message);
  }

  // 4. JobWeb Kenya RSS
  console.log('--- Fetching JobWeb Kenya RSS ---');
  try {
    const jw = await fetch('https://jobwebkenya.com/feed/', { headers });
    const jwXml = await jw.text();
    const jwItems = jwXml.match(/<item[\s>]/gi);
    console.log('JobWeb Kenya items count:', jwItems ? jwItems.length : 0);
  } catch (e) {
    console.log('JobWeb err:', e.message);
  }
}

inspectHtml();
