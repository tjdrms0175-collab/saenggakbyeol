/**
 * Optional persistent daily quota storage for Saenggakbyeol (v38).
 * All calls are server-to-server; never expose sb_secret_* or a learner's IP.
 * An IP hash is a best-effort quota bucket, NOT authenticated user identity.
 */
import crypto from 'node:crypto';

export class UsageStorageError extends Error {
  constructor() { super('이용량 기록 서버에 연결할 수 없어 AI 요청을 잠시 중단했어요. 관리자에게 알려주세요.'); this.code='USAGE_STORAGE_UNAVAILABLE'; }
}
export function storageConfig(env = process.env) {
  const rawUrl = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_SECRET_KEY || '').trim();
  if (!rawUrl && !key) return null; // local development without Supabase
  if (!rawUrl || !key || !/^sb_secret_[A-Za-z0-9_-]{8,}$/.test(key)) throw new UsageStorageError();
  let url;
  try { url = new URL(rawUrl); } catch { throw new UsageStorageError(); }
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) ||
      url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new UsageStorageError();
  return { base:url.origin, key };
}
export function clientQuotaId(req, key, trustProxy = false) {
  // IP-based bucket. School/family NAT can share an IP; spoofed proxies can
  // weaken fairness. Add account auth and per-account quotas before growth.
  const chain = trustProxy ? String(req.headers['x-forwarded-for'] || '') : '';
  const address = (chain.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown').slice(0, 100);
  return 'ip_' + crypto.createHmac('sha256', key).update(address).digest('hex');
}
export function makeUsageStore(env = process.env, fetchImpl = globalThis.fetch) {
  const config = storageConfig(env);
  if (!config) return null;
  return {
    clientId(req) { return clientQuotaId(req, config.key, env.TRUST_PROXY === '1'); },
    async reserve(clientId, metric, max) {
      let response;
      try {
        response = await fetchImpl(config.base+'/rest/v1/rpc/reserve_daily_usage', {
          method:'POST',
          headers:{apikey:config.key,'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify({p_client_id:clientId,p_metric:metric,p_max:max}),
          signal:AbortSignal.timeout(5000),redirect:'error',
        });
      } catch { throw new UsageStorageError(); }
      if (!response.ok) throw new UsageStorageError();
      let result;
      try { result = await response.json(); } catch { throw new UsageStorageError(); }
      if (result !== true && result !== false) throw new UsageStorageError();
      return result;
    },
  };
}
