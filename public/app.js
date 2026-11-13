// ส่วนกลางของทุกหน้า: เมนูบน, เรียก API, ข้อมูลผู้เล่น
const MT = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (s, el = document) => el.querySelector(s);
  async function api(path, body, opts = {}) {
    const headers = { 'content-type': 'application/json' };
    if (opts.token) headers.authorization = 'Bearer ' + opts.token;
    let r;
    try { r = await fetch('/api/' + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' }); }
    catch { const e = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต'); e.code = 'net'; throw e; }
    if (opts.raw) { if (!r.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ'); return r; }
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok || j.ok === false) { const e = new Error(j.message || 'เกิดข้อผิดพลาด'); e.code = j.code; e.status = r.status; throw e; }
    return j;
  }
  const KEY = 'mt_player';
  const me = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const setMe = p => { try { p ? localStorage.setItem(KEY, JSON.stringify(p)) : localStorage.removeItem(KEY); } catch {} };
  const adminTok = () => { try { return sessionStorage.getItem('mt_admin'); } catch { return null; } };
  const setAdminTok = t => { try { t ? sessionStorage.setItem('mt_admin', t) : sessionStorage.removeItem('mt_admin'); } catch {} };
  function nav(active) {
    const items = [['index', 'หน้าแรก', '/'], ['play', 'เกมสด', '/play.html'], ['practice', 'ฝึกคนเดียว', '/practice.html'], ['board', 'อันดับ', '/board.html'], ['admin', 'อาจารย์', '/admin.html']];
    const h = document.createElement('header'); h.className = 'top';
    h.innerHTML = `<div class="in"><a class="brand" href="/"><span class="logo">🥊</span><span>เกมทบทวนมวยไทย<small>พล 032437 ทักษะและการสอนกีฬามวยไทย</small></span></a><nav>${items.map(([k, t, u]) => `<a href="${u}" class="${k === active ? 'on' : ''} ${k === 'admin' ? 't' : ''}">${t}</a>`).join('')}</nav></div>`;
    document.body.prepend(h);
  }
  function toast(msg, ms = 2200) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = msg; document.body.append(d); setTimeout(() => d.remove(), ms); }
  const starStr = (n, max = 3) => '<span class="stars">' + '★'.repeat(n) + `<span class="off">${'★'.repeat(Math.max(0, max - n))}</span></span>`;
  // ฟอร์มเข้าสู่ระบบผู้เล่น (รหัสนักศึกษา + ชื่อเล่น)
  function loginForm(el, done, title = 'เข้าสู่ระบบผู้เล่น') {
    const p = me() || {};
    el.innerHTML = `<div class="card" style="max-width:460px;margin:0 auto"><h2>${title}</h2>
      <form><label>รหัสนักศึกษา</label><input name="sid" inputmode="numeric" autocomplete="off" maxlength="15" value="${esc(p.sid || '')}" required>
      <label>ชื่อเล่น (แสดงในตารางอันดับ)</label><input name="nick" maxlength="20" autocomplete="off" value="${esc(p.nick || '')}" required>
      <p class="err"></p><button class="btn big" style="width:100%">เริ่มเล่น 🥊</button></form>
      <p class="small muted">ระบบจะจำชื่อไว้ในเครื่องนี้ ใช้รหัสนักศึกษาเดิมทุกครั้งเพื่อสะสมดาว</p></div>`;
    const f = $('form', el);
    f.onsubmit = async ev => {
      ev.preventDefault(); const b = f.querySelector('button'); b.disabled = true; $('.err', el).textContent = '';
      try { const j = await api('player', { sid: f.sid.value, nick: f.nick.value }); setMe(j.player); done(j); }
      catch (e) { $('.err', el).textContent = e.message; b.disabled = false; }
    };
  }
  return { esc, $, api, me, setMe, nav, toast, starStr, loginForm, adminTok, setAdminTok, shapes: ['▲', '◆', '●', '■'] };
})();
