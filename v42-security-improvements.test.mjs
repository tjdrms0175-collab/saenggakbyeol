import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';

const VALID_CODE='private-guardian-pilot-code-2026';
async function boot(t,{code=VALID_CODE,mock=true}={}){
  const s=net.createServer(); await new Promise(r=>s.listen(0,'127.0.0.1',r));
  const port=s.address().port; await new Promise(r=>s.close(r));
  const child=spawn(process.execPath,mock?['--import','./mock-gemini-switch.mjs','server.mjs']:['server.mjs'],{
    cwd:new URL('.',import.meta.url),env:{...process.env,NODE_ENV:'production',PORT:String(port),HOST:'127.0.0.1',
      GEMINI_API_KEY:'FAKE_TEST_SERVER_KEY_DO_NOT_SHARE',GUARDIAN_ENROLLMENT_CODE:code,
      SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',GEMINI_TEST_CASE:'all-ok'},stdio:'ignore'});
  t.after(()=>child.kill());
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)return base;}catch{}await pause(40)}
  throw Error('Server startup failed');
}
async function post(base,url,body,cookie=''){
  const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};
}
const pinData={newPin:'826493',confirmPin:'826493',guardianConfirmed:true};
test('v43: first-use PIN setup works without enrollment code',async t=>{
  const base=await boot(t,{code:''});
  const valid=await post(base,'/api/parent/setup',pinData);
  assert.equal(valid.status,201,JSON.stringify(valid.body));
  assert.match(valid.cookie,/sb_answer_pin=/);
  const cookie=valid.cookie.split(';')[0];
  assert.equal((await post(base,'/api/parent/verify',{pin:'826493'},cookie)).status,200);
  assert.equal((await post(base,'/api/parent/setup',pinData,cookie)).status,409);
  // In a fresh browser without the cookie, setting a new PIN is possible.
  assert.equal((await post(base,'/api/parent/setup',{newPin:'592637',confirmPin:'592637',guardianConfirmed:true})).status,201);
});
test('production responses and public assets reveal only provider, no model IDs or private env names',async t=>{
  const base=await boot(t);
  const r=await fetch(base+'/api/provider-config');
  const cfg=await r.json();
  assert.equal(cfg.aiService,'Google Gemini');
  assert.equal(cfg.providers.gemini.configured,true);
  assert.equal(cfg.geminiRoute,undefined);
  assert.equal(cfg.providers.gemini.env,undefined);
  const pages=[];
  for(const path of ['/','/app.js','/api/provider-config','/api/health']){
    const response=await fetch(base+path);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.equal(response.headers.get('permissions-policy'),'camera=(self), microphone=(self), geolocation=()');
    assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
    pages.push(await response.text());
  }
  const html=pages.join('\n');
  assert.match(html,/Google Gemini/);
  assert.doesNotMatch(html,/gemini-3\.1-flash-lite|gemini-3\.5-flash-lite|gemini-3\.8-flash|CUSTOM_API_KEY|FREELLMAPI_API_KEY|FAKE_TEST_SERVER_KEY_DO_NOT_SHARE|private-guardian-pilot-code-2026/);
  const q=await post(base,'/api/tutor',{provider:'gemini',model:'auto',grade:'초5~6',subject:'수학',problem:'12와 18의 최대공약수를 어떻게 구해요?',messages:[{role:'user',content:'12와 18의 최대공약수를 어떻게 구해요?'}]});
  assert.equal(q.status,200,JSON.stringify(q.body));
  assert.equal(q.body.model,undefined);
  assert.equal(q.body.geminiRoute,undefined);
});
test('spoofed image data is rejected before the paid Gemini call',async t=>{
  const base=await boot(t);
  const fakedPng='data:image/png;base64,'+Buffer.from('not an image file').toString('base64');
  const fakedJpeg='data:image/jpeg;base64,'+Buffer.from('totally fake JPEG file').toString('base64');
  for(const imageDataUrl of [fakedPng,fakedJpeg,'data:image/png;base64,!!!','data:image/webp;base64,ZmFrZQ==']){
    const r=await post(base,'/api/photo/read',{imageDataUrl});
    assert.equal(r.status,400,JSON.stringify(r.body));
    assert.equal(r.body.code,'PHOTO_INVALID');
    const tutor=await post(base,'/api/tutor',{provider:'gemini',grade:'초5~6',subject:'수학',problem:'이미지 테스트',photoTextConfirmed:true,imageDataUrl,messages:[]});
    assert.equal(tutor.status,400,JSON.stringify(tutor.body));
  }
});

test('real JPEG/PNG/WebP images reach the AI validation stage (not rejected as spoofed files)',async t=>{
  const base=await boot(t);
  const samples=[
    ['jpeg','/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAADAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0qiiisTU//9k='],
    ['png','iVBORw0KGgoAAAANSUhEUgAAAAMAAAADCAIAAADZSiLoAAAAF0lEQVR4nGO8dGIfAwMDAwMDEwMMIFgAQiwCXg0kwDsAAAAASUVORK5CYII='],
    ['webp','UklGRi4AAABXRUJQVlA4ICIAAABwAQCdASoDAAMAAUAmJZQCdAFAAAD+92uhMeis7J3iAAAA'],
  ];
  for(const [mime,encoded] of samples){
    const res=await post(base,'/api/photo/read',{imageDataUrl:`data:image/${mime};base64,${encoded}`});
    assert.notEqual(res.status,400,`valid ${mime} file was rejected as invalid data: ${JSON.stringify(res.body)}`);
    assert.notEqual(res.body.code,'PHOTO_INVALID');
  }
});
