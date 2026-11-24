import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
async function boot(t){
  const reserved=net.createServer();
  await new Promise(resolve=>reserved.listen(0,'127.0.0.1',resolve));
  const port=reserved.address().port;
  await new Promise(resolve=>reserved.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{
    cwd:new URL('.',import.meta.url),
    env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production',
      SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',GEMINI_API_KEY:'FAKE_DO_NOT_SHARE_TEST_KEY',
      OPENAI_API_KEY:'FAKE_OPTIONAL_TEST_KEY',CUSTOM_API_KEY:'FAKE_CUSTOM_TEST_KEY',
      APP_ACCESS_PIN:'',AI_ALLOWED_PROVIDERS:'gemini'},stdio:'ignore'});
  t.after(()=>child.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<80;i++){
    try {if((await fetch(base+'/api/health')).ok)return base;}
    catch {}
    await delay(45);
  }
  throw Error('test server not started');
}
function bodyRequest(base, path='/api/tutor',headers={},body={}){
  return fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
}
test('v41 response headers, public allowlisted files, and no secret material in UI or API', async t=>{
  const base=await boot(t);
  for(const p of ['/','/app.js','/api/health','/api/provider-config']){
    const r=await fetch(base+p);
    assert.equal(r.status,200,p);
    assert.equal(r.headers.get('x-content-type-options'),'nosniff');
    assert.equal(r.headers.get('x-frame-options'),'DENY');
    assert.equal(r.headers.get('referrer-policy'),'no-referrer');
    assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000');
    assert.notEqual(r.headers.get('access-control-allow-origin'),'*');
    const content=await r.text();
    assert.doesNotMatch(content,/FAKE_DO_NOT_SHARE_TEST_KEY|FAKE_OPTIONAL_TEST_KEY|FAKE_CUSTOM_TEST_KEY/);
  }
  for(const p of ['/.env','/.git/config','/package.json','/server.mjs','/SUPABASE_SETUP_V39.sql','/server.mjs.map']){
    assert.equal((await fetch(base+p)).status,404,p);
  }
});
test('v41 rejects cross-site and non-JSON POST before application logic', async t=>{
  const base=await boot(t);
  const cross=await bodyRequest(base,'/api/ai/report',{'Origin':'https://bad.example'},{reason:'other'});
  assert.equal(cross.status,403);
  const fetchSite=await bodyRequest(base,'/api/tutor',{'Sec-Fetch-Site':'cross-site'},{});
  assert.equal(fetchSite.status,403);
  const invalidMedia=await fetch(base+'/api/tutor',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});
  assert.equal(invalidMedia.status,415);
  const legacy=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'});
  assert.equal(legacy.status,415);
});
test('v41 production server accepts only operator-approved AI providers',async t=>{
  const base=await boot(t);
  for (const provider of ['openai','custom']) {
    const response=await bodyRequest(base,'/api/tutor',{},
      {provider,problem:'간단한 문제',grade:'초5~6',subject:'수학',messages:[]});
    assert.equal(response.status,403);
    assert.doesNotMatch(await response.text(),/FAKE_DO_NOT_SHARE_TEST_KEY|FAKE_OPTIONAL_TEST_KEY|FAKE_CUSTOM_TEST_KEY/);
  }
});
