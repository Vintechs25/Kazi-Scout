function cleanHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlJobListings(html, baseUrl, sourceName) {
  const items = [];
  const seenUrls = new Set();
  const origin = new URL(baseUrl).origin;

  // 1. MyJobMag & similar: <h2><a href="/job/...">Title</a></h2> or <a href="/job/...">
  const myJobMagMatches = html.matchAll(/<h[234][^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>\s*<\/h[234]>/gi);
  for (const match of myJobMagMatches) {
    const rawUrl = match[1];
    let fullUrl = rawUrl.startsWith("http") ? rawUrl : `${origin}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
    const rawTitle = cleanHtml(match[2]);
    if (!seenUrls.has(fullUrl) && rawTitle.length > 4 && !rawTitle.toLowerCase().includes("privacy") && !rawTitle.toLowerCase().includes("terms")) {
      seenUrls.add(fullUrl);
      let title = rawTitle;
      let company = sourceName;
      if (rawTitle.includes(" at ")) {
        const parts = rawTitle.split(" at ");
        title = parts[0].trim();
        company = parts.slice(1).join(" at ").trim();
      }
      items.push({ title, company, url: fullUrl });
    }
  }

  // 2. BrighterMonday & similar: <a href=".../listings/..."> ... <p class="...">Title</p></a>
  const brMatches = html.matchAll(/<a[^>]+href=["']([^"']*(?:\/listings\/|\/job\/|\/jobs\/|\/vacancy\/)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const match of brMatches) {
    const rawUrl = match[1];
    let fullUrl = rawUrl.startsWith("http") ? rawUrl : `${origin}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
    const inner = match[2];
    
    // Look for title inside inner HTML (heading or text-lg paragraph)
    const titleMatch = inner.match(/<(?:h[1-6]|p)[^>]*class=["'][^"']*(?:text-lg|title|heading|font-medium)[^"']*["'][^>]*>(.*?)<\/(?:h[1-6]|p)>/i) ||
                       inner.match(/<(?:h[1-6]|strong|b)[^>]*>(.*?)<\/(?:h[1-6]|strong|b)>/i);
    const rawTitle = titleMatch ? cleanHtml(titleMatch[1]) : cleanHtml(inner);
    
    if (rawTitle.length > 4 && rawTitle.length < 120 && !seenUrls.has(fullUrl) &&
        !/apply now|view job|read more|log in|sign up|cookie/i.test(rawTitle)) {
      seenUrls.add(fullUrl);
      items.push({ title: rawTitle, company: sourceName, url: fullUrl });
    }
  }

  return items;
}

async function test() {
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36' };

  // Test MyJobMag
  const mjmRes = await fetch('https://www.myjobmag.co.ke/jobs-by-field/information-technology', { headers });
  const mjmHtml = await mjmRes.text();
  const mjmItems = parseHtmlJobListings(mjmHtml, 'https://www.myjobmag.co.ke', 'MyJobMag');
  console.log('MyJobMag parsed items count:', mjmItems.length);
  console.log('MyJobMag sample:', mjmItems.slice(0, 3));

  // Test BrighterMonday
  const bmRes = await fetch('https://www.brightermonday.co.ke/jobs/software-data', { headers });
  const bmHtml = await bmRes.text();
  const bmItems = parseHtmlJobListings(bmHtml, 'https://www.brightermonday.co.ke', 'BrighterMonday');
  console.log('BrighterMonday parsed items count:', bmItems.length);
  console.log('BrighterMonday sample:', bmItems.slice(0, 3));
}

test();
