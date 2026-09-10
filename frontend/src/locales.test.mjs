import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const dir=new URL('./locales/',import.meta.url);
const base=JSON.parse(fs.readFileSync(new URL('en.json',dir)));
test('all locale JSON resources match English key set',()=>{
 for(const file of fs.readdirSync(dir).filter(x=>x.endsWith('.json'))){
  const data=JSON.parse(fs.readFileSync(new URL(file,dir)));
  assert.deepEqual(Object.keys(data).sort(),Object.keys(base).sort(),file);
 }
});
