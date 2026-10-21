const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' };

const testUrls = [
  'https://knh.or.ke/vacancies/',
  'https://knh.or.ke/careers/',
  'https://www.mtrh.go.ke/careers/',
  'https://www.mtrh.go.ke/vacancies-2/',
  'https://karenhospital.org/job-openings/',
  'https://karenhospital.org/careers-at-the-karen-hospital/',
  'https://avenuehealthcare.com/job-vacancies/',
];

for (const u of testUrls) {
  try {
    const res = await fetch(u, { headers, signal: AbortSignal.timeout(5000) });
    console.log(u, res.status);
  } catch (e) {
    console.log(u, 'FAILED:', e.message);
  }
}
