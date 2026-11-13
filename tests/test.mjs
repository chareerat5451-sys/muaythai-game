// ทดสอบตรรกะเกมทั้งหมดด้วยที่เก็บข้อมูลจำลอง: npm test
import assert from 'node:assert/strict';
import { handle } from '../netlify/functions/lib/game.mjs';
import { QUIZ, PICS, MATCH, ORDER } from '../netlify/functions/lib/data.mjs';
import { memStore } from './memstore.mjs';
const store = memStore(); let now = Date.parse('2027-01-10T09:00:00+07:00'); const env = {};
async function call(path, body, method = 'POST', token) {
  const req = new Request('https://x/api/' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  const r = await handle(req, { store, now, env });
  const ct = r.headers.get('content-type') || '';
  return { s: r.status, j: ct.includes('json') ? await r.json() : await r.text() };
}
let r;
// ข้อมูล
assert.equal(QUIZ.length, 120); assert.equal(new Set(QUIZ.map(q => q.id)).size, 120);
for (let c = 1; c <= 12; c++) assert.equal(QUIZ.filter(q => q.ch === c).length, 10, 'บท ' + c);
assert.ok(QUIZ.every(q => q.a >= 0 && q.a < q.o.length && q.exp && q.page >= 1 && q.page <= 133));
assert.ok(MATCH.every(m => m.pairs.length >= 3) && ORDER.every(o => o.items.length >= 3));
r = await call('meta', null, 'GET'); assert.equal(r.j.map.length, 12);

// ผู้เล่น
assert.equal((await call('player', { sid: '12', nick: 'a' })).s, 400);
assert.equal((await call('practice/start', { sid: '6612345678', ch: 1, stage: 'quiz' })).s, 401);
r = await call('player', { sid: '6612345678', nick: 'บอส<script>' }); assert.equal(r.s, 200); assert.equal(r.j.player.nick, 'บอสscript');
await call('player', { sid: '6612345678', nick: 'บอส' });

// ฝึก: ตอบคำถาม (เฉลยไม่หลุด)
r = await call('practice/start', { sid: '6612345678', ch: 3, stage: 'quiz' }); assert.equal(r.s, 200);
assert.equal(r.j.items.length, 10); assert.ok(r.j.items.every(i => !('a' in i) && !('exp' in i)));
let tok = r.j.token; let sess = (await store.list({ prefix: 'sess/' })).blobs.map(b => b.key);
let S = await store.get(sess[0]);
for (let n = 0; n < 10; n++) {
  const choice = n < 9 ? S.items[n].a : (S.items[n].a + 1) % S.items[n].o.length;
  r = await call('practice/answer', { token: tok, n, choice }); assert.equal(r.j.correct, n < 9); assert.ok(r.j.exp);
}
r = await call('practice/answer', { token: tok, n: 9, choice: S.items[9].a }); assert.equal(r.j.correct, false, 'ตอบซ้ำแก้ไม่ได้');
r = await call('practice/finish', { token: tok }); assert.equal(r.j.pct, 90); assert.equal(r.j.stars, 3); assert.equal(r.j.progress.stars, 3);
r = await call('practice/finish', { token: tok }); assert.equal(r.j.stars, 3, 'จบซ้ำไม่บวกเพิ่ม');
r = await call('progress?sid=6612345678', null, 'GET'); assert.equal(r.j.progress.stars, 3); assert.equal(r.j.progress.points, 90);

// ฝึก: ภาพ
assert.equal((await call('practice/start', { sid: '6612345678', ch: 1, stage: 'image' })).s, 400);
r = await call('practice/start', { sid: '6612345678', ch: 7, stage: 'image' }); assert.equal(r.s, 200);
assert.equal(r.j.items.length, 10); assert.ok(r.j.items.every(i => i.img.startsWith('/img/p') && i.o.length === 4 && !('a' in i)));
assert.ok(!JSON.stringify(r.j).includes('ภาพที่'), 'ไม่ส่งคำบรรยายภาพที่เป็นเฉลย');

// ฝึก: จับคู่
r = await call('practice/start', { sid: '6612345678', ch: 6, stage: 'match' }); tok = r.j.token;
const allS = await Promise.all((await store.list({ prefix: 'sess/' })).blobs.map(b => store.get(b.key)));
S = allS.find(s => s.stage === 'match');
r = await call('practice/finish', { token: tok, pairs: S.key }); assert.equal(r.j.pct, 100); assert.equal(r.j.stars, 3);
// ฝึก: เรียงลำดับ (ส่งลำดับที่แสดงอยู่ = ผิดบางส่วน, แล้วส่งลำดับที่ถูก)
r = await call('practice/start', { sid: '6612345678', ch: 2, stage: 'order' }); tok = r.j.token; const shown = r.j.list;
S = (await Promise.all((await store.list({ prefix: 'sess/' })).blobs.map(b => store.get(b.key)))).find(s => s.stage === 'order');
const right = S.perm.map((_, i) => S.perm.indexOf(i));
r = await call('practice/finish', { token: tok, order: right }); assert.equal(r.j.pct, 100); assert.deepEqual(r.j.detail.solution.length, shown.length);
r = await call('progress?sid=6612345678', null, 'GET'); assert.equal(r.j.progress.stars, 9);

// อันดับ
await call('player', { sid: '6612340001', nick: 'มด' });
r = await call('leaderboard?sid=6612345678', null, 'GET'); assert.equal(r.j.top[0].nick, 'บอส'); assert.ok(!JSON.stringify(r.j).includes('6612345678'));
assert.equal(r.j.me.rank, 1);

// ผู้ดูแล
assert.equal((await call('admin/login', { password: 'Yongyut032437' })).s, 401);
const A = (await call('admin/login', { password: 'Yongyut123456789' })).j.token; assert.ok(A);
assert.equal((await call('admin/progress', null, 'GET')).s, 401);
r = await call('admin/progress', null, 'GET', A); assert.equal(r.j.rows.length, 2);
r = await call('admin/progress?format=csv', null, 'GET', A); assert.ok(r.j.includes('อันดับ,รหัสนักศึกษา'));

// เกมสด
r = await call('admin/host/create', { chapters: [9, 10], kinds: ['quiz', 'image'], count: 3, seconds: 20 }, 'POST', A); const pin = r.j.pin; assert.match(pin, /^\d{6}$/);
assert.equal((await call('live/join', { pin: '000000', sid: '6612345678', nick: 'บอส' })).s, 404);
for (const [sid, nick] of [['6612345678', 'บอส'], ['6612340001', 'มด'], ['6612340002', 'เก่ง']]) assert.equal((await call('live/join', { pin, sid, nick })).s, 200);
r = await call('live/state?pin=' + pin + '&sid=6612345678', null, 'GET'); assert.equal(r.j.state, 'lobby');
r = await call('admin/host/next', { pin, from: 'lobby:-1' }, 'POST', A); assert.equal(r.j.state, 'question'); assert.equal(r.j.players.length, 3);
r = await call('admin/host/next', { pin, from: 'lobby:-1' }, 'POST', A); assert.equal(r.j.state, 'question', 'กดซ้ำไม่ข้าม');
r = await call('live/state?pin=' + pin + '&sid=6612345678', null, 'GET'); assert.ok(r.j.question && !('a' in r.j.question)); const room = await store.get('live/' + pin + '/room');
const a0 = room.qs[0].a;
now += 2000; assert.equal((await call('live/answer', { pin, sid: '6612345678', qi: 0, choice: a0 })).s, 200);
now += 8000; await call('live/answer', { pin, sid: '6612340001', qi: 0, choice: a0 });
await call('live/answer', { pin, sid: '6612340002', qi: 0, choice: (a0 + 1) % room.qs[0].o.length });
r = await call('live/answer', { pin, sid: '6612345678', qi: 0, choice: (a0 + 1) % 2 }); assert.ok(r.j.already);
r = await call('admin/host/state?pin=' + pin, null, 'GET', A); assert.equal(r.j.answered, 3);
r = await call('admin/host/next', { pin, from: 'question:0' }, 'POST', A); assert.equal(r.j.state, 'reveal');
assert.equal(r.j.board[0].nick, 'บอส'); assert.equal(r.j.board[0].score, 950); assert.equal(r.j.board[1].score, 750); assert.equal(r.j.board[2].score, 0);
r = await call('live/state?pin=' + pin + '&sid=6612340002', null, 'GET'); assert.equal(r.j.reveal.mine.ok, false); assert.equal(r.j.me.rank, 3);
now += 30000; r = await call('live/answer', { pin, sid: '6612340002', qi: 0, choice: a0 }); assert.equal(r.s, 409);
await call('admin/host/next', { pin, from: 'reveal:0' }, 'POST', A);
r = await call('admin/host/next', { pin, from: 'board:0' }, 'POST', A); assert.equal(r.j.qi, 1);
now += 25000; r = await call('live/answer', { pin, sid: '6612345678', qi: 1, choice: 0 }); assert.equal(r.s, 409, 'ตอบเกินเวลา');
await call('admin/host/kick', { pin, sid: '6612340002' }, 'POST', A);
assert.equal((await call('live/state?pin=' + pin + '&sid=6612340002', null, 'GET')).s, 403);
r = await call('admin/host/end', { pin }, 'POST', A); assert.equal(r.j.state, 'ended');
r = await call('live/state?pin=' + pin + '&sid=6612345678', null, 'GET'); assert.equal(r.j.top.length, 2);
r = await call('admin/games', null, 'GET', A); assert.equal(r.j.games[0].players, 2);
r = await call('admin/game-csv?pin=' + pin, null, 'GET', A); assert.ok(r.j.includes('บอส'));

// รีเซ็ต
assert.equal((await call('admin/reset', { all: 'x' }, 'POST', A)).s, 400);
await call('admin/reset', { sid: '6612345678' }, 'POST', A);
r = await call('progress?sid=6612345678', null, 'GET'); assert.equal(r.j.progress.stars, 0);
console.log('ผ่านการทดสอบทั้งหมด ✓');
