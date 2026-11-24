// Test-only preload, intercepts usage RPC. Does not make network requests.
const prior = globalThis.fetch;
const totals = new Map();
globalThis.fetch = async (url, options={}) => {
  if (!String(url).startsWith('https://test-seoul-project.supabase.co/rest/v1/rpc/reserve_daily_usage')) return prior(url,options);
  if (options.headers?.apikey !== 'sb_secret_testingonly123') return new Response('{}',{status:403});
  if (process.env.USAGE_TEST_DB_DOWN === '1') return new Response('{}',{status:503});
  const {p_client_id,p_metric,p_max}=JSON.parse(options.body);
  const k=p_client_id+':'+p_metric;
  const current=totals.get(k)||0;
  if (current>=p_max || process.env.USAGE_TEST_BLOCK === '1') return new Response('false',{status:200});
  totals.set(k,current+1);
  return new Response('true',{status:200});
};
