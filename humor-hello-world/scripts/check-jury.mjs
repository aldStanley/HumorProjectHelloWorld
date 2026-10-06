import assert from 'node:assert/strict';
import { validateBallot, juryDate, juryWinnerIds } from '../src/lib/jury/types.ts';

const ids = Array.from({length:5}, (_,i) => `10000000-0000-4000-8000-00000000000${i+1}`);
const ratings = Object.fromEntries(ids.map((id,i)=>[id,i%2 ? -1 : 1]));
const valid = {roundDay:'2026-10-04',ratings,pickId:ids[0]};
assert(validateBallot(valid));
for (const body of [null,{},[],{...valid,ratings:{}},{...valid,ratings:{...ratings,extra:1}},{...valid,ratings:{...ratings,[ids[0]]:0}},{...valid,ratings:{...ratings,[ids[0]]:'1'}},{...valid,pickId:'20000000-0000-4000-8000-000000000001'},{...valid,roundDay:'tomorrow'},{...valid,roundDay:'2026-99-99'}]) assert(!validateBallot(body));
assert.equal(juryDate('2026-10-04'),'Oct 4, 2026');
console.log('PASS jury request validation and timezone-independent date labels');
if (process.env.TEST_BASE_URL) {
 const base = process.env.TEST_BASE_URL;
 for (const origin of [undefined,'https://untrusted.example']) {
  const res = await fetch(base+'/api/jury',{method:'POST',headers:origin?{origin}:{}});
  assert.equal(res.status,403);
 }
 const res = await fetch(base+'/api/jury',{method:'POST',headers:{origin:new URL(base).origin,'content-type':'application/json'},body:JSON.stringify(valid)});
 assert.equal(res.status,401);
 console.log('PASS signed-out and cross-origin jury rejection');
}

assert.deepEqual(juryWinnerIds({winner_ids:ids.slice(0,2),winner_id:ids[0]}),ids.slice(0,2));
assert.deepEqual(juryWinnerIds({winner_ids:[],winner_id:null}),[]);
assert.deepEqual(juryWinnerIds({winner_id:ids[0]}),[ids[0]]);
console.log('PASS co-winner IDs, quiet rounds, and legacy round compatibility');
