// Test-only preload for the private fallback integration test.
// Simulates a 429 from every Gemini model, without sending real network calls.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith('https://generativelanguage.googleapis.com/')) {
    return new Response(JSON.stringify({error:{code:429,message:'mock quota exceeded'}}), {
      status:429,headers:{'Content-Type':'application/json'}
    });
  }
  return realFetch(url,options);
};
