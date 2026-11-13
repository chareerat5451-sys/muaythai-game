// ตรรกะหลักของระบบเกมทบทวน พล 032437 (แยกจาก Netlify เพื่อให้ทดสอบได้)
// store: อ็อบเจกต์ที่มี get(key,{type:'json'}), setJSON(key,val), delete(key), list({prefix})
import crypto from 'node:crypto';
import { CHAPTERS, QUIZ, PICS, MATCH, ORDER } from './data.mjs';

export const COURSE = { code: 'พล 032437', name: 'ทักษะและการสอนกีฬามวยไทย' };
const SESSION_MS = 3 * 3600_000;      // อายุรอบฝึก
const ROOM_MS = 6 * 3600_000;         // อายุห้องเกมสด
const GRACE_MS = 1500;                // เผื่อเวลาเครือข่ายตอนตอบเกมสด
const BOARD_TTL = 20_000;             // แคชตารางอันดับ
export const LEVELS = [
  [0, 'นักมวยฝึกหัด'], [10, 'นักมวยดาวรุ่ง'], [25, 'นักมวยมือรอง'],
  [45, 'นักมวยมือหนึ่ง'], [70, 'แชมป์เวที'], [95, 'ปรมาจารย์มวยไทย'],
];
const STAGES = ['quiz', 'image', 'match', 'order'];
export const STAGE_NAME = { quiz: 'ตอบคำถาม', image: 'ทายชื่อท่าจากภาพ', match: 'จับคู่', order: 'เรียงลำดับ' };

// ---------- utilities ----------
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});
const err = (status, code, message) => json({ ok: false, code, message }, status);
const rnd = (n = 16) => crypto.randomBytes(n).toString('hex');
const normSid = s => String(s || '').replace(/\s+/g, '').trim();
const normNick = s => String(s || '').normalize('NFC').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
const validSid = s => /^[0-9A-Za-z-]{5,15}$/.test(s);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pick = arr => arr[crypto.randomInt(arr.length)];
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// รหัสผ่านอาจารย์ผู้ดูแลเกม เก็บเป็นค่า SHA-256 (ไม่ใช่ตัวรหัสจริง) ตั้ง ADMIN_PASSWORD ใน Netlify เพื่อเปลี่ยนได้
const ADMIN_HASH = '964c20b54d79b4fea8024ee88a7cbd2562092deeffaf0bec4e9d0c4b63bb16d1';
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function checkPassword(pw, env) { return env.ADMIN_PASSWORD ? safeEq(pw, env.ADMIN_PASSWORD) : safeEq(sha(pw), ADMIN_HASH); }
async function getSecret(ctx) {
  if (ctx.env.TOKEN_SECRET) return ctx.env.TOKEN_SECRET;
  if (ctx._secret) return ctx._secret;
  let rec = await ctx.store.get('sys/secret', { type: 'json' });
  if (!rec) { rec = { k: rnd(32) }; await ctx.store.setJSON('sys/secret', rec); }
  return (ctx._secret = rec.k);
}
function sign(payload, key) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', key).update(body).digest('base64url');
}
function verify(token, key, now) {
  if (!token || !String(token).includes('.')) return null;
  const [body, mac] = String(token).split('.');
  if (!safeEq(mac, crypto.createHmac('sha256', key).update(body).digest('base64url'))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > now ? p : null; } catch { return null; }
}
async function body(req) { try { return await req.json(); } catch { return {}; } }
const get = (store, k) => store.get(k, { type: 'json' });
async function listKeys(store, prefix) { const { blobs } = await store.list({ prefix }); return blobs.map(b => b.key); }
async function readAll(store, prefix) {
  const keys = await listKeys(store, prefix);
  return (await Promise.all(keys.map(k => get(store, k)))).filter(Boolean);
}
export function levelOf(stars) {
  let i = 0; for (let k = 0; k < LEVELS.length; k++) if (stars >= LEVELS[k][0]) i = k;
  const next = LEVELS[i + 1];
  return { level: i + 1, title: LEVELS[i][1], nextAt: next ? next[0] : null, nextTitle: next ? next[1] : null };
}
const starsOf = pct => (pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0);
const maskSid = s => (s.length > 3 ? '•'.repeat(Math.min(4, s.length - 3)) + s.slice(-3) : s);

// ---------- เนื้อหา ----------
function stagesOf(ch) {
  const out = ['quiz'];
  if (PICS.some(p => p.ch === ch)) out.push('image');
  if (MATCH.some(m => m.ch === ch)) out.push('match');
  if (ORDER.some(o => o.ch === ch)) out.push('order');
  return out;
}
export const MAP = Object.keys(CHAPTERS).map(Number).map(ch => ({ ch, title: CHAPTERS[ch], stages: stagesOf(ch) }));
const ALL_STAGES = MAP.flatMap(m => m.stages.map(s => m.ch + '-' + s));
const MAX_STARS = ALL_STAGES.length * 3;

// ข้อคำถามแบบเลือกตอบ (ทั้ง quiz และ image) -> { kind, q, o[], a, exp, page, img, cap }
function quizItem(q) {
  const order = q.type === 'tf' ? [0, 1] : shuffle(q.o.map((_, i) => i));
  return { kind: 'quiz', id: q.id, type: q.type, q: q.q, o: order.map(i => q.o[i]), a: order.indexOf(q.a), exp: q.exp, page: q.page };
}
function picItem(p) {
  const pool = PICS.filter(x => x.cat === p.cat && x.name !== p.name);
  const names = [...new Set(shuffle(pool).map(x => x.name))].slice(0, 3);
  const o = shuffle([p.name, ...names]);
  return { kind: 'image', id: p.id, type: 'mc', q: 'ภาพนี้คือท่าใด', img: '/img/' + p.img, o, a: o.indexOf(p.name), exp: p.cap, page: null, cat: p.cat };
}
const publicItem = (it, n) => ({ n, kind: it.kind, type: it.type, q: it.q, o: it.o, ...(it.img ? { img: it.img, cat: it.cat } : {}) });

// ---------- ผู้เล่น ----------
async function register(req, ctx) {
  const b = await body(req); const sid = normSid(b.sid); const nick = normNick(b.nick);
  if (!validSid(sid)) return err(400, 'sid', 'รหัสนักศึกษาไม่ถูกต้อง');
  if (!nick) return err(400, 'nick', 'กรุณากรอกชื่อเล่น');
  const k = 'player/' + sid; const cur = await get(ctx.store, k);
  const rec = { sid, nick, created: cur?.created || ctx.now, seen: ctx.now };
  await ctx.store.setJSON(k, rec);
  const prog = await get(ctx.store, 'prog/' + sid);
  if (prog && prog.nick !== nick) { prog.nick = nick; await ctx.store.setJSON('prog/' + sid, prog); }
  return json({ ok: true, player: { sid, nick }, progress: progView(prog, sid, nick) });
}
function progView(p, sid, nick) {
  p = p || { sid, nick, stages: {}, stars: 0, points: 0 };
  return { sid: p.sid, nick: p.nick, stages: p.stages, stars: p.stars, points: p.points, maxStars: MAX_STARS, ...levelOf(p.stars) };
}

// ---------- ฝึกคนเดียว ----------
async function practiceStart(req, ctx) {
  const b = await body(req); const sid = normSid(b.sid); const ch = Number(b.ch); const stage = String(b.stage);
  const player = await get(ctx.store, 'player/' + sid);
  if (!player) return err(401, 'player', 'กรุณาเข้าสู่ระบบด้วยรหัสนักศึกษาและชื่อเล่นก่อน');
  if (!CHAPTERS[ch] || !STAGES.includes(stage) || !stagesOf(ch).includes(stage)) return err(400, 'stage', 'ไม่พบด่านนี้');
  const id = rnd(12); const sess = { id, sid, ch, stage, started: ctx.now, ans: {}, done: false };
  let view;
  if (stage === 'quiz') {
    sess.items = shuffle(QUIZ.filter(q => q.ch === ch)).map(quizItem);
  } else if (stage === 'image') {
    sess.items = shuffle(PICS.filter(p => p.ch === ch)).slice(0, 10).map(picItem);
  } else if (stage === 'match') {
    const set = pick(MATCH.filter(m => m.ch === ch));
    const right = shuffle(set.pairs.map((_, i) => i));
    sess.set = set.id; sess.key = set.pairs.map((_, i) => right.indexOf(i)); // left i -> right index
    view = { title: set.title, left: set.pairs.map(p => p[0]), right: right.map(i => set.pairs[i][1]) };
  } else {
    const set = pick(ORDER.filter(o => o.ch === ch));
    let perm = shuffle(set.items.map((_, i) => i));
    if (perm.every((v, i) => v === i)) perm = [...perm.slice(1), perm[0]];
    sess.set = set.id; sess.perm = perm;
    view = { title: set.title, list: perm.map(i => set.items[i]) };
  }
  if (sess.items) view = { items: sess.items.map(publicItem) };
  await ctx.store.setJSON('sess/' + id, sess);
  const token = sign({ s: id, sid, exp: ctx.now + SESSION_MS }, await getSecret(ctx));
  return json({ ok: true, token, ch, stage, title: CHAPTERS[ch], stageName: STAGE_NAME[stage], ...view });
}
async function loadSess(b, ctx) {
  const p = verify(b.token, await getSecret(ctx), ctx.now);
  if (!p) return [null, err(401, 'token', 'รอบนี้หมดอายุ กรุณาเริ่มใหม่')];
  const sess = await get(ctx.store, 'sess/' + p.s);
  if (!sess || sess.sid !== p.sid) return [null, err(404, 'sess', 'ไม่พบรอบการเล่น')];
  return [sess, null];
}
async function practiceAnswer(req, ctx) {
  const b = await body(req); const [sess, e] = await loadSess(b, ctx); if (e) return e;
  if (!sess.items) return err(400, 'stage', 'ด่านนี้ไม่ใช่แบบเลือกตอบ');
  const n = Number(b.n); const it = sess.items[n];
  if (!it) return err(400, 'n', 'ไม่พบข้อนี้');
  if (sess.done) return err(409, 'done', 'จบรอบนี้แล้ว');
  if (!(n in sess.ans)) {
    const c = Number.isInteger(b.choice) && b.choice >= 0 && b.choice < it.o.length ? b.choice : -1;
    sess.ans[n] = { c, ok: c === it.a };
    await ctx.store.setJSON('sess/' + sess.id, sess);
  }
  const a = sess.ans[n];
  return json({ ok: true, correct: a.ok, choice: a.c, answer: it.a, exp: it.exp, page: it.page });
}
async function practiceFinish(req, ctx) {
  const b = await body(req); const [sess, e] = await loadSess(b, ctx); if (e) return e;
  let correct, total, detail;
  if (sess.done) return json({ ok: true, ...sess.result });
  if (sess.items) {
    total = sess.items.length; correct = Object.values(sess.ans).filter(a => a.ok).length;
  } else if (sess.stage === 'match') {
    const pairs = Array.isArray(b.pairs) ? b.pairs.map(Number) : [];
    total = sess.key.length; correct = sess.key.filter((r, i) => pairs[i] === r).length;
    const set = MATCH.find(m => m.id === sess.set);
    detail = { key: sess.key, pairs, solution: set.pairs };
  } else {
    const order = Array.isArray(b.order) ? b.order.map(Number) : [];  // ลำดับดัชนีของรายการที่แสดง
    const placed = order.map(i => sess.perm[i]);                         // แปลงกลับเป็นดัชนีจริง
    total = sess.perm.length; correct = placed.filter((v, i) => v === i).length;
    const set = ORDER.find(o => o.id === sess.set);
    detail = { solution: set.items, placedOk: placed.map((v, i) => v === i) };
  }
  const pct = total ? Math.round((correct / total) * 100) : 0; const stars = starsOf(pct);
  const key = sess.ch + '-' + sess.stage;
  const pk = 'prog/' + sess.sid; const player = await get(ctx.store, 'player/' + sess.sid);
  const prog = (await get(ctx.store, pk)) || { sid: sess.sid, nick: player?.nick || '', stages: {}, stars: 0, points: 0, plays: 0 };
  const prev = prog.stages[key] || { best: 0, stars: 0, plays: 0 };
  const newBest = pct > prev.best, newStars = Math.max(0, stars - prev.stars);
  prog.stages[key] = { best: Math.max(prev.best, pct), stars: Math.max(prev.stars, stars), plays: prev.plays + 1, last: ctx.now };
  prog.stars = Object.values(prog.stages).reduce((s, x) => s + x.stars, 0);
  prog.points = Object.values(prog.stages).reduce((s, x) => s + x.best, 0);
  prog.plays = (prog.plays || 0) + 1; prog.updated = ctx.now; if (player) prog.nick = player.nick;
  const before = levelOf(prog.stars - newStars).level;
  await ctx.store.setJSON(pk, prog);
  sess.done = true; sess.result = { correct, total, pct, stars, newBest, newStars, levelUp: levelOf(prog.stars).level > before, detail, progress: progView(prog) };
  await ctx.store.setJSON('sess/' + sess.id, sess);
  return json({ ok: true, ...sess.result });
}

// ---------- ตารางอันดับ ----------
async function boardData(ctx, fresh) {
  const c = !fresh && (await get(ctx.store, 'cache/board'));
  if (c && ctx.now - c.at < BOARD_TTL) return c.rows;
  const rows = (await readAll(ctx.store, 'prog/'))
    .map(p => ({ sid: p.sid, nick: p.nick, stars: p.stars, points: p.points, plays: p.plays || 0, updated: p.updated || 0, ...levelOf(p.stars) }))
    .sort((a, b) => b.points - a.points || b.stars - a.stars || a.updated - b.updated);
  await ctx.store.setJSON('cache/board', { at: ctx.now, rows });
  return rows;
}
async function leaderboard(req, ctx) {
  const sid = normSid(new URL(req.url).searchParams.get('sid'));
  const rows = await boardData(ctx);
  const pub = r => ({ nick: r.nick, tag: maskSid(r.sid), stars: r.stars, points: r.points, title: r.title, level: r.level });
  const me = rows.findIndex(r => r.sid === sid);
  return json({ ok: true, maxStars: MAX_STARS, total: rows.length, top: rows.slice(0, 50).map((r, i) => ({ rank: i + 1, ...pub(r), me: r.sid === sid })), me: me >= 0 ? { rank: me + 1, ...pub(rows[me]) } : null });
}
async function progress(req, ctx) {
  const sid = normSid(new URL(req.url).searchParams.get('sid'));
  const player = await get(ctx.store, 'player/' + sid);
  if (!player) return err(404, 'player', 'ไม่พบผู้เล่น');
  return json({ ok: true, progress: progView(await get(ctx.store, 'prog/' + sid), sid, player.nick) });
}

// ---------- เกมสด (แบบ Kahoot) ----------
// room: เขียนโดยอาจารย์ (host) เท่านั้น / ผู้เล่นเขียนไฟล์ของตัวเอง: live/{pin}/p/{sid}, live/{pin}/a/{qi}/{sid}
const RK = pin => `live/${pin}/room`;
function livePoints(t, T) { return Math.max(500, Math.round(1000 * (1 - 0.5 * Math.min(1, t / T)))); }
function liveQuestion(room, it, qi, now) {
  const left = Math.max(0, room.seconds * 1000 - (now - room.qStart));
  return { qi, kind: it.kind, type: it.type, q: it.q, o: it.o, img: it.img || null, seconds: room.seconds, remainMs: left };
}
async function hostCreate(b, ctx) {
  const chapters = (Array.isArray(b.chapters) ? b.chapters : []).map(Number).filter(c => CHAPTERS[c]);
  if (!chapters.length) return err(400, 'ch', 'กรุณาเลือกบทอย่างน้อย 1 บท');
  const kinds = (Array.isArray(b.kinds) ? b.kinds : ['quiz']).filter(k => k === 'quiz' || k === 'image');
  if (!kinds.length) return err(400, 'kind', 'กรุณาเลือกประเภทคำถาม');
  let pool = [];
  if (kinds.includes('quiz')) pool.push(...QUIZ.filter(q => chapters.includes(q.ch)).map(quizItem));
  if (kinds.includes('image')) pool.push(...PICS.filter(p => chapters.includes(p.ch)).map(picItem));
  if (!pool.length) return err(400, 'empty', 'บทที่เลือกไม่มีคำถามประเภทนี้');
  const count = Math.max(1, Math.min(Number(b.count) || 10, 30, pool.length));
  const seconds = Math.max(10, Math.min(Number(b.seconds) || 20, 90));
  let pin; for (let i = 0; i < 20; i++) { pin = String(crypto.randomInt(100000, 1000000)); if (!(await get(ctx.store, RK(pin)))) break; }
  const room = { pin, state: 'lobby', qi: -1, qs: shuffle(pool).slice(0, count), seconds, chapters, kinds, created: ctx.now, qStart: 0, scores: {}, reveal: null, kicked: [] };
  await ctx.store.setJSON(RK(pin), room);
  await ctx.store.setJSON('livelog/' + pin, { pin, created: ctx.now, chapters, kinds, count: room.qs.length, state: 'lobby' });
  return json({ ok: true, pin, count: room.qs.length });
}
async function livePlayers(store, pin) { return readAll(store, `live/${pin}/p/`); }
async function hostState(room, ctx) {
  const players = (await livePlayers(ctx.store, room.pin)).filter(p => !room.kicked.includes(p.sid));
  let answered = 0;
  if (room.state === 'question') answered = (await listKeys(ctx.store, `live/${room.pin}/a/${room.qi}/`)).length;
  const it = room.qs[room.qi];
  return json({
    ok: true, pin: room.pin, state: room.state, qi: room.qi, total: room.qs.length, seconds: room.seconds, serverNow: ctx.now,
    players: players.map(p => ({ sid: p.sid, nick: p.nick })), answered,
    question: it && room.state !== 'lobby' ? { ...liveQuestion(room, it, room.qi, ctx.now), a: room.state === 'question' ? undefined : it.a, exp: it.exp, page: it.page } : null,
    reveal: room.reveal, board: ranking(room).slice(0, 10),
  });
}
function ranking(room) {
  return Object.values(room.scores).filter(s => !room.kicked.includes(s.sid))
    .sort((a, b) => b.score - a.score || b.correct - a.correct || a.time - b.time)
    .map((s, i) => ({ rank: i + 1, sid: s.sid, nick: s.nick, score: s.score, correct: s.correct, streak: s.streak }));
}
async function doReveal(room, ctx) {
  const it = room.qs[room.qi]; const T = room.seconds * 1000;
  const players = await livePlayers(ctx.store, room.pin);
  for (const p of players) room.scores[p.sid] ||= { sid: p.sid, nick: p.nick, score: 0, correct: 0, streak: 0, time: 0 };
  const answers = await readAll(ctx.store, `live/${room.pin}/a/${room.qi}/`);
  const dist = it.o.map(() => 0); const per = {};
  const bySid = Object.fromEntries(answers.map(a => [a.sid, a]));
  for (const s of Object.values(room.scores)) {
    const a = bySid[s.sid];
    if (a && a.c >= 0 && a.c < dist.length) dist[a.c]++;
    const ok = !!a && a.c === it.a && a.t <= T + GRACE_MS;
    let gain = 0;
    if (ok) { s.streak += 1; gain = livePoints(a.t, T) + Math.min(s.streak - 1, 5) * 100; s.correct += 1; s.time += a.t; }
    else s.streak = 0;
    s.score += gain; per[s.sid] = { ok, gain, answered: !!a };
  }
  room.reveal = { qi: room.qi, a: it.a, dist, per, count: answers.length };
}
async function hostNext(room, ctx) {
  if (room.state === 'lobby' || room.state === 'board') {
    if (room.qi + 1 >= room.qs.length) { room.state = 'ended'; room.ended = ctx.now; }
    else { room.qi += 1; room.state = 'question'; room.qStart = ctx.now; room.reveal = null; }
  } else if (room.state === 'question') { await doReveal(room, ctx); room.state = 'reveal'; }
  else if (room.state === 'reveal') { room.state = room.qi + 1 >= room.qs.length ? 'ended' : 'board'; if (room.state === 'ended') room.ended = ctx.now; }
  await saveRoom(room, ctx);
}
async function saveRoom(room, ctx) {
  await ctx.store.setJSON(RK(room.pin), room);
  if (room.state === 'ended' || room.state === 'lobby') {
    const top = ranking(room);
    await ctx.store.setJSON('livelog/' + room.pin, { pin: room.pin, created: room.created, ended: room.ended || null, chapters: room.chapters, kinds: room.kinds, count: room.qs.length, state: room.state, players: top.length, top: top.slice(0, 3).map(r => ({ nick: r.nick, score: r.score })) });
  }
}
async function liveJoin(req, ctx) {
  const b = await body(req); const pin = String(b.pin || '').replace(/\D/g, ''); const sid = normSid(b.sid); const nick = normNick(b.nick);
  if (!validSid(sid) || !nick) return err(400, 'player', 'กรุณากรอกรหัสนักศึกษาและชื่อเล่น');
  const room = await get(ctx.store, RK(pin));
  if (!room || ctx.now - room.created > ROOM_MS) return err(404, 'pin', 'ไม่พบห้องเกม ตรวจสอบรหัส PIN อีกครั้ง');
  if (room.state === 'ended') return err(410, 'ended', 'เกมนี้จบแล้ว');
  if (room.kicked.includes(sid)) return err(403, 'kicked', 'อาจารย์นำคุณออกจากห้องนี้');
  const k = `live/${pin}/p/${sid}`; const cur = await get(ctx.store, k);
  await ctx.store.setJSON(k, { sid, nick, joined: cur?.joined || ctx.now });
  const pk = 'player/' + sid; const pl = await get(ctx.store, pk);
  if (!pl) await ctx.store.setJSON(pk, { sid, nick, created: ctx.now, seen: ctx.now });
  return json({ ok: true, pin, nick, state: room.state });
}
async function liveState(req, ctx) {
  const u = new URL(req.url); const pin = String(u.searchParams.get('pin') || '').replace(/\D/g, ''); const sid = normSid(u.searchParams.get('sid'));
  const room = await get(ctx.store, RK(pin));
  if (!room) return err(404, 'pin', 'ไม่พบห้องเกม');
  if (room.kicked.includes(sid)) return err(403, 'kicked', 'อาจารย์นำคุณออกจากห้องนี้');
  const out = { ok: true, pin, state: room.state, qi: room.qi, total: room.qs.length, serverNow: ctx.now };
  const it = room.qs[room.qi];
  const rank = ranking(room); const mi = rank.findIndex(r => r.sid === sid);
  const me = mi >= 0 ? rank[mi] : { score: 0, correct: 0, streak: 0 };
  out.me = { rank: mi >= 0 ? mi + 1 : null, score: me.score, correct: me.correct, streak: me.streak, players: rank.length };
  if (room.state === 'question') {
    out.question = liveQuestion(room, it, room.qi, ctx.now);
    out.answered = !!(await get(ctx.store, `live/${pin}/a/${room.qi}/${sid}`));
  } else if (room.state === 'reveal') {
    out.question = { qi: room.qi, q: it.q, o: it.o, img: it.img || null, type: it.type };
    out.reveal = { a: it.a, exp: it.exp, page: it.page, mine: room.reveal?.per?.[sid] || { ok: false, gain: 0, answered: false } };
  } else if (room.state === 'board' || room.state === 'ended') {
    out.top = rank.slice(0, room.state === 'ended' ? 10 : 5).map(r => ({ rank: r.rank, nick: r.nick, score: r.score }));
  }
  return json(out);
}
async function liveAnswer(req, ctx) {
  const b = await body(req); const pin = String(b.pin || '').replace(/\D/g, ''); const sid = normSid(b.sid);
  const room = await get(ctx.store, RK(pin));
  if (!room) return err(404, 'pin', 'ไม่พบห้องเกม');
  if (room.state !== 'question' || Number(b.qi) !== room.qi) return err(409, 'closed', 'หมดเวลาตอบข้อนี้แล้ว');
  if (!(await get(ctx.store, `live/${pin}/p/${sid}`)) || room.kicked.includes(sid)) return err(403, 'player', 'ยังไม่ได้เข้าห้องนี้');
  const t = ctx.now - room.qStart;
  if (t > room.seconds * 1000 + GRACE_MS) return err(409, 'late', 'หมดเวลาตอบข้อนี้แล้ว');
  const k = `live/${pin}/a/${room.qi}/${sid}`;
  if (await get(ctx.store, k)) return json({ ok: true, already: true });
  const c = Number(b.choice);
  await ctx.store.setJSON(k, { sid, c: Number.isInteger(c) ? c : -1, t });
  return json({ ok: true, t });
}

// ---------- ผู้ดูแล ----------
async function adminLogin(req, ctx) {
  const b = await body(req);
  if (!checkPassword(String(b.password || ''), ctx.env)) { await new Promise(r => setTimeout(r, 800)); return err(401, 'auth', 'รหัสผ่านไม่ถูกต้อง'); }
  return json({ ok: true, token: sign({ role: 'admin', exp: ctx.now + 12 * 3600_000 }, await getSecret(ctx)) });
}
const csv = rows => '﻿' + rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
async function admin(req, ctx, action) {
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!verify(auth, await getSecret(ctx), ctx.now)) return err(401, 'auth', 'กรุณาเข้าสู่ระบบใหม่');
  const b = req.method === 'POST' ? await body(req) : {}; const u = new URL(req.url);
  const pinOf = () => String(b.pin || u.searchParams.get('pin') || '').replace(/\D/g, '');
  switch (action) {
    case 'meta': return json({ ok: true, map: MAP, counts: { quiz: QUIZ.length, pics: PICS.length, match: MATCH.length, order: ORDER.length } });
    case 'progress': {
      const rows = await boardData(ctx, true); const players = await readAll(ctx.store, 'player/');
      const seen = new Set(rows.map(r => r.sid));
      for (const p of players) if (!seen.has(p.sid)) rows.push({ sid: p.sid, nick: p.nick, stars: 0, points: 0, plays: 0, updated: 0, ...levelOf(0) });
      if (u.searchParams.get('format') === 'csv') {
        const progs = Object.fromEntries((await readAll(ctx.store, 'prog/')).map(p => [p.sid, p]));
        const head = ['อันดับ', 'รหัสนักศึกษา', 'ชื่อเล่น', 'ดาวรวม', 'คะแนนรวม', 'เลเวล', 'จำนวนครั้งที่เล่น', ...ALL_STAGES.map(k => 'ดาว ' + k.replace('-', ' ') )];
        const body = rows.map((r, i) => [i + 1, r.sid, r.nick, r.stars, r.points, r.title, r.plays, ...ALL_STAGES.map(k => progs[r.sid]?.stages?.[k]?.stars ?? '')]);
        return new Response(csv([head, ...body]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="game-progress.csv"' } });
      }
      return json({ ok: true, rows, stages: ALL_STAGES, maxStars: MAX_STARS });
    }
    case 'player': {
      const sid = normSid(u.searchParams.get('sid'));
      return json({ ok: true, player: await get(ctx.store, 'player/' + sid), progress: await get(ctx.store, 'prog/' + sid) });
    }
    case 'reset': {
      if (b.sid) { const sid = normSid(b.sid); await ctx.store.delete('prog/' + sid); if (b.removePlayer) await ctx.store.delete('player/' + sid); }
      else if (b.all === 'ยืนยันล้างทั้งหมด') {
        for (const k of [...(await listKeys(ctx.store, 'prog/')), ...(await listKeys(ctx.store, 'sess/'))]) await ctx.store.delete(k);
        if (b.removePlayers) for (const k of await listKeys(ctx.store, 'player/')) await ctx.store.delete(k);
      } else return err(400, 'confirm', 'ต้องยืนยันการล้างข้อมูล');
      await ctx.store.delete('cache/board');
      return json({ ok: true });
    }
    case 'games': return json({ ok: true, games: (await readAll(ctx.store, 'livelog/')).sort((a, b) => b.created - a.created) });
    case 'game-csv': {
      const room = await get(ctx.store, RK(pinOf())); if (!room) return err(404, 'pin', 'ไม่พบห้องเกม');
      const head = ['อันดับ', 'รหัสนักศึกษา', 'ชื่อเล่น', 'คะแนน', 'ตอบถูก', `จากทั้งหมด`];
      const rows = ranking(room).map(r => [r.rank, r.sid, r.nick, r.score, r.correct, room.qs.length]);
      return new Response(csv([head, ...rows]), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="live-${room.pin}.csv"` } });
    }
    case 'host/create': return hostCreate(b, ctx);
  }
  if (action.startsWith('host/')) {
    const room = await get(ctx.store, RK(pinOf()));
    if (!room) return err(404, 'pin', 'ไม่พบห้องเกม');
    switch (action) {
      case 'host/state': return hostState(room, ctx);
      case 'host/next': {
        if (room.state === 'ended') return hostState(room, ctx);
        if (b.from && b.from !== `${room.state}:${room.qi}`) return hostState(room, ctx); // กันกดซ้ำ
        await hostNext(room, ctx); return hostState(room, ctx);
      }
      case 'host/kick': { const sid = normSid(b.sid); if (!room.kicked.includes(sid)) room.kicked.push(sid); await saveRoom(room, ctx); return hostState(room, ctx); }
      case 'host/end': { room.state = 'ended'; room.ended = ctx.now; await saveRoom(room, ctx); return hostState(room, ctx); }
    }
  }
  return err(404, 'nf', 'ไม่พบคำสั่ง');
}

// ---------- router ----------
export async function handle(req, ctx) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  try {
    if (req.method === 'GET') {
      if (path === 'meta') return json({ ok: true, course: COURSE, map: MAP, maxStars: MAX_STARS, levels: LEVELS, stageName: STAGE_NAME });
      if (path === 'leaderboard') return await leaderboard(req, ctx);
      if (path === 'progress') return await progress(req, ctx);
      if (path === 'live/state') return await liveState(req, ctx);
    }
    if (req.method === 'POST') {
      if (path === 'player') return await register(req, ctx);
      if (path === 'practice/start') return await practiceStart(req, ctx);
      if (path === 'practice/answer') return await practiceAnswer(req, ctx);
      if (path === 'practice/finish') return await practiceFinish(req, ctx);
      if (path === 'live/join') return await liveJoin(req, ctx);
      if (path === 'live/answer') return await liveAnswer(req, ctx);
      if (path === 'admin/login') return await adminLogin(req, ctx);
    }
    if (path.startsWith('admin/')) return await admin(req, ctx, path.slice(6));
    return err(404, 'nf', 'ไม่พบเส้นทาง');
  } catch (e) {
    console.error(e);
    return err(500, 'server', 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่');
  }
}
