const testUrls = [
  { name: 'MyJobMag RSS', url: 'https://www.myjobmag.co.ke/feed' },
  { name: 'MyJobMag IT Feed', url: 'https://www.myjobmag.co.ke/jobs-by-field/information-technology' },
  { name: 'CareerPoint RSS', url: 'https://www.careerpointkenya.co.ke/feed/' },
  { name: 'CareerPoint IT RSS', url: 'https://www.careerpointkenya.co.ke/category/it-jobs-in-kenya/feed/' },
  { name: 'JobWeb Kenya RSS', url: 'https://jobwebkenya.com/feed/' },
  { name: 'BrighterMonday IT', url: 'https://www.brightermonday.co.ke/jobs/software-data' },
  { name: 'BrighterMonday All Jobs', url: 'https://www.brightermonday.co.ke/jobs' },
  { name: 'Fuzu Kenya', url: 'https://www.fuzu.com/kenya/jobs' },
  { name: 'Kenyan Career RSS', url: 'https://www.kenyancareer.com/feeds/posts/default?alt=rss' },
  { name: 'Arbeitnow API', url: 'https://www.arbeitnow.com/api/job-board-api' },
  { name: 'Jobicy API', url: 'https://jobicy.com/api/v2/remote-jobs?count=20' },
  { name: 'WeWorkRemotely RSS', url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss' },
  { name: 'Remotive API', url: 'https://remotive.com/api/remote-jobs?category=software-dev&limit=20' },
  { name: 'Himalayas API', url: 'https://himalayas.app/jobs/api?limit=20' },
];

async function testAll() {
  for (const item of testUrls) {
    try {
      const res = await fetch(item.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8'
        },
        signal: AbortSignal.timeout(10000)
      });
      const text = await res.text();
      const isXml = text.includes('<rss') || text.includes('<feed') || text.includes('<?xml');
      const isJson = text.startsWith('{') || text.startsWith('[');
      let itemCount = 0;
      if (isXml) {
        const matches = text.match(/<(?:item|entry)[\s>]/gi);
        itemCount = matches ? matches.length : 0;
      } else if (isJson) {
        try {
          const data = JSON.parse(text);
          itemCount = Array.isArray(data) ? data.length : (data.data?.length || data.jobs?.length || 0);
        } catch {}
      } else {
        const jobMatches = text.match(/job-item|job-card|job-listing|vacancy|search-result/gi);
        itemCount = jobMatches ? jobMatches.length : 0;
      }
      console.log(`[${res.status}] ${item.name} (${item.url}) -> Type: ${isXml ? 'XML' : isJson ? 'JSON' : 'HTML'}, length: ${text.length}, extracted items: ${itemCount}`);
    } catch (e) {
      console.log(`[ERR] ${item.name} (${item.url}) -> ${e.message}`);
    }
  }
}
testAll();
