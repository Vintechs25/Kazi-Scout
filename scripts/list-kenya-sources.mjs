import { COMPREHENSIVE_KENYA_JOB_SOURCES } from "../artifacts/api-server/src/lib/kenya-job-sources-comprehensive.js";

console.log("Total sources:", COMPREHENSIVE_KENYA_JOB_SOURCES.length);
const byCategory = {};
for (const s of COMPREHENSIVE_KENYA_JOB_SOURCES) {
  byCategory[s.category] = (byCategory[s.category] || 0) + 1;
}
console.log("By Category:", byCategory);

const kenyanSources = COMPREHENSIVE_KENYA_JOB_SOURCES.filter(s => s.country === "Kenya");
console.log("Total Kenya sources:", kenyanSources.length);
console.log("Kenya sources sample:", kenyanSources.slice(0, 15).map(s => ({
  id: s.id,
  name: s.name,
  connectorType: s.connectorType,
  canonicalUrl: s.canonicalUrl,
  feedUrl: s.config?.feedUrl,
  searchUrl: s.config?.searchUrl || s.config?.careersUrl || s.config?.vacanciesUrl
})));
