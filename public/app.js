'use strict';
const SITE = Object.assign({ college: 'Your College', department: 'Electronics & Communication Engineering', short: 'ECE', semesters: 8 }, window.SITE);
const $ = (s, r = document) => r.querySelector(s);
const appEl = $('#app');
let me = null, subjects = [];

/* ---------- helpers ---------- */
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat(9).forEach(c => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
  return e;
}
async function api(path, opts = {}) {
  const o = { credentials: 'same-origin', ...opts };
  if (o.json) { o.method = o.method || 'POST'; o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(o.json); }
  let res;
  try { res = await fetch('/api' + path, o); } catch { throw new Error('You are offline. Saved pages and files still work.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3200);
}
const fail = e => toast(e.message, true);
const fmtSize = n => !n ? '' : n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const fmtDate = s => new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const TYPES = { paper: 'Question paper', notes: 'Notes', syllabus: 'Syllabus', lab: 'Lab manual', other: 'Other' };
const isStaff = () => me && (me.role === 'faculty' || me.role === 'admin');
const field = (label, input) => h('div', null, h('label', null, label), input);
const opts = (arr, sel) => arr.map(([v, t]) => h('option', { value: v, selected: String(v) === String(sel) }, t));
const semOpts = (blank) => [[ '', blank ], ...Array.from({ length: SITE.semesters }, (_, i) => [i + 1, 'Semester ' + (i + 1)])];
const stars = n => h('span', { class: 'stars', 'aria-label': n + ' out of 5' }, '★'.repeat(n) + '☆'.repeat(5 - n));
async function loadSubjects() { try { subjects = await api('/subjects'); } catch { /* offline & uncached */ } }
function subjectOptions(blank, sel) {
  const g = {}; subjects.forEach(s => (g[s.semester] ||= []).push(s));
  return [h('option', { value: '' }, blank), ...Object.keys(g).map(sem => h('optgroup', { label: 'Semester ' + sem },
    g[sem].map(s => h('option', { value: s.id, selected: String(s.id) === String(sel) }, `${s.code} · ${s.name}`))))];
}

/* ---------- chrome ---------- */
function renderChrome(path) {
  const links = [['home', 'Home'], ['papers', 'Question papers'], ['notes', 'Notes'], ['syllabus', 'Syllabus'], ['upload', 'Upload']];
  const nav = h('nav', { 'aria-label': 'Main' }, links.map(([p, t]) =>
    h('a', { href: '#/' + p, 'aria-current': (path || 'home') === p ? 'page' : null }, t)));
  if (isStaff()) nav.append(h('a', { href: '#/manage', 'aria-current': path === 'manage' ? 'page' : null }, 'Manage'));
  if (me) nav.append(h('a', { href: '#/account', 'aria-current': path === 'account' ? 'page' : null }, me.name.split(' ')[0]),
    h('button', { onclick: async () => { await api('/auth/logout', { method: 'POST' }); me = null; location.hash = '#/home'; route(); } }, 'Log out'));
  else nav.append(h('a', { href: '#/login', 'aria-current': path === 'login' ? 'page' : null }, 'Log in'));
  $('#top').replaceChildren(h('div', { class: 'wrap' },
    h('a', { class: 'brand', href: '#/home' }, logo(), SITE.short + ' Department'), nav));
  $('#foot').replaceChildren(h('div', { class: 'wrap' },
    h('div', null, h('b', null, SITE.department), h('br'), SITE.college),
    h('div', null, SITE.address, h('br'), SITE.email)));
  document.title = SITE.short + ' Department Portal';
}
function logo() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<rect width="64" height="64" rx="14" fill="#1c3652"/><path d="M6 34h10l5-18 8 32 7-26 5 12h17" fill="none" stroke="#3fd6a4" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

/* ---------- hero waveform: an AM signal drifting across graph paper ---------- */
function waveform(canvas) {
  const ctx = canvas.getContext('2d'), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w, h2, t = 0, raf;
  const size = () => { const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1; w = canvas.width = r.width * d; h2 = canvas.height = r.height * d; };
  function draw() {
    if (!canvas.isConnected) return cancelAnimationFrame(raf);
    ctx.clearRect(0, 0, w, h2);
    const d = devicePixelRatio || 1, g = 40 * d;
    ctx.strokeStyle = 'rgba(160,200,185,.10)'; ctx.lineWidth = 1;
    for (let x = 0; x < w; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h2); ctx.stroke(); }
    for (let y = 0; y < h2; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const mid = h2 * 0.62, amp = h2 * 0.17;
    const trace = (alpha, lw, phase) => {
      ctx.beginPath(); ctx.strokeStyle = `rgba(63,214,164,${alpha})`; ctx.lineWidth = lw * d;
      for (let x = 0; x <= w; x += 2) {
        const u = x / d, env = 1 + 0.55 * Math.sin(u * 0.012 - t * 0.6 + phase);
        const y = mid + amp * env * Math.sin(u * 0.16 - t * 3 + phase) * 0.62;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    trace(0.18, 6, 0.4); trace(0.95, 2, 0);
    if (!still) { t += 0.016; raf = requestAnimationFrame(draw); }
  }
  size(); draw(); addEventListener('resize', () => { size(); if (still) draw(); });
}

/* ---------- pages ---------- */
async function home() {
  const hero = h('section', { class: 'hero' }, h('canvas', { 'aria-hidden': 'true' }),
    h('div', { class: 'wrap' },
      h('div', { class: 'college' }, SITE.college),
      h('h1', null, SITE.department),
      h('p', null, 'Previous year papers, notes and syllabus for every semester, stored on the department server and readable without internet.'),
      h('div', { class: 'row' }, h('a', { class: 'btn', href: '#/papers' }, 'Browse question papers'),
        h('a', { class: 'btn alt', href: '#/upload' }, 'Share a file'))));
  const notices = h('div', null, h('h2', null, 'Notices'));
  const recent = h('div', { class: 'list' });
  const semGrid = h('div', { class: 'sems' }, Array.from({ length: SITE.semesters }, (_, i) =>
    h('a', { href: '#/syllabus?sem=' + (i + 1) }, i + 1, h('small', null, 'Semester'))));
  appEl.replaceChildren(hero, h('section', { class: 'block' }, h('div', { class: 'wrap two' },
    notices, h('div', null, h('h2', null, 'Browse by semester'), semGrid))),
    h('section', { class: 'block', style: 'padding-top:0' }, h('div', { class: 'wrap' }, h('h2', null, 'Recently added'), recent)));
  waveform($('canvas', hero));
  try {
    const ns = await api('/notices');
    notices.append(...(ns.length ? ns.slice(0, 5).map(n => h('div', { class: 'notice' + (n.pinned ? ' pin' : '') },
      h('h3', null, n.title), h('p', { style: 'margin:0 0 2px;white-space:pre-line' }, n.body), h('span', { class: 'muted' }, fmtDate(n.created_at)))) :
      [h('div', { class: 'empty' }, 'No notices right now.')]));
  } catch (e) { notices.append(h('div', { class: 'empty' }, e.message)); }
  try {
    const rs = (await api('/resources?sort=new')).slice(0, 6);
    recent.replaceChildren(...(rs.length ? rs.map(r => resRow(r, () => home())) : [h('div', { class: 'empty' }, 'Nothing uploaded yet. Be the first to share a file.')]));
  } catch (e) { recent.replaceChildren(h('div', { class: 'empty' }, e.message)); }
}

function resRow(r, refresh) {
  const meta = [r.subject_code ? `${r.subject_code} · ${r.subject_name}` : null, r.semester ? 'Sem ' + r.semester : null,
    r.year, r.exam_type, fmtSize(r.size)].filter(Boolean).join(' · ');
  return h('div', { class: 'item' },
    h('div', null,
      h('h3', null, h('span', { class: 'tag ' + r.type }, TYPES[r.type]), r.status !== 'approved' ? h('span', { class: 'tag ' + r.status }, r.status === 'pending' ? 'Awaiting review' : 'Rejected') : null,
        h('button', { onclick: () => openResource(r.id, refresh) }, r.title)),
      h('div', { class: 'muted' }, meta),
      h('div', { class: 'muted' }, `By ${r.uploader} · ${fmtDate(r.created_at)} · ${r.downloads} download${r.downloads === 1 ? '' : 's'}`,
        r.remark_count ? [' · ', stars(Math.round(r.avg_rating || 0)), ` (${r.remark_count})`] : null)),
    h('div', { class: 'row' },
      h('button', { class: 'btn light small', onclick: () => openResource(r.id, refresh) }, 'Open'),
      h('a', { class: 'btn small', href: `/api/resources/${r.id}/download`, download: '' }, 'Download')));
}

async function library(preset = {}) {
  const st = { type: preset.type || '', q: '', semester: preset.semester || '', subject: preset.subject || '', year: '', sort: 'new' };
  const title = { paper: 'Previous year question papers', notes: 'Notes' }[st.type] || 'Library';
  const list = h('div', { class: 'list' }), count = h('p', { class: 'muted' });
  const chips = h('div', { class: 'chips' });
  const years = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - i);
  const f = {
    q: h('input', { type: 'search', placeholder: 'Search title, subject or code', 'aria-label': 'Search' }),
    sem: h('select', { 'aria-label': 'Semester' }, opts(semOpts('All semesters'), st.semester)),
    sub: h('select', { 'aria-label': 'Subject' }, subjectOptions('All subjects', st.subject)),
    year: h('select', { 'aria-label': 'Year' }, opts([['', 'Any year'], ...years.map(y => [y, y])])),
    sort: h('select', { 'aria-label': 'Sort' }, opts([['new', 'Newest first'], ['popular', 'Most downloaded'], ['year', 'Exam year']]))
  };
  const drawChips = () => chips.replaceChildren(...[['', 'All'], ...Object.entries(TYPES)].map(([v, t]) =>
    h('button', { class: 'chip', 'aria-pressed': String(st.type === v), onclick: () => { st.type = v; drawChips(); load(); } }, t)));
  async function load() {
    st.q = f.q.value; st.semester = f.sem.value; st.subject = f.sub.value; st.year = f.year.value; st.sort = f.sort.value;
    const p = new URLSearchParams(Object.entries(st).filter(([, v]) => v));
    try {
      const rs = await api('/resources?' + p);
      count.textContent = rs.length + (rs.length === 1 ? ' file' : ' files');
      list.replaceChildren(...(rs.length ? rs.map(r => resRow(r, load)) : [h('div', { class: 'empty' }, 'No files match these filters. Try clearing one, or upload what is missing.')]));
    } catch (e) { list.replaceChildren(h('div', { class: 'empty' }, e.message)); }
  }
  let tm; f.q.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(load, 250); });
  Object.values(f).slice(1).forEach(s => s.addEventListener('change', load));
  drawChips();
  appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, title), chips,
    h('div', { class: 'filters' }, h('div', { class: 'q' }, f.q), f.sem, f.sub, f.year, f.sort), count, list)));
  load();
}

async function openResource(id, refresh) {
  const item = await api('/resources/' + id).catch(() => null);
  if (!item) return toast('This file is not available (or you are offline and have not opened it before).', true);
  const dlg = h('dialog'), body = h('div', { class: 'dlg' });
  const ext = (item.original_name.split('.').pop() || '').toLowerCase();
  const canPreview = ['pdf', 'png', 'jpg', 'jpeg', 'txt'].includes(ext);
  const remarks = h('div'), form = h('div');
  const close = () => { dlg.close(); dlg.remove(); };
  const actions = h('div', { class: 'row' },
    h('a', { class: 'btn', href: `/api/resources/${id}/download`, download: '' }, 'Download'),
    canPreview ? h('a', { class: 'btn light', href: `/api/resources/${id}/view`, target: '_blank', rel: 'noopener' }, 'Open in new tab') : null);
  if (isStaff() && item.status !== 'approved') actions.append(h('button', { class: 'btn light', onclick: async () => { await api(`/resources/${id}/status`, { method: 'PATCH', json: { status: 'approved' } }).catch(fail); toast('Approved'); close(); refresh?.(); } }, 'Approve'));
  if (isStaff() && item.status === 'approved') actions.append(h('button', { class: 'btn light', onclick: async () => { await api(`/resources/${id}/status`, { method: 'PATCH', json: { status: 'rejected' } }).catch(fail); toast('Rejected'); close(); refresh?.(); } }, 'Reject'));
  if (me && (isStaff() || me.id === item.uploaded_by)) actions.append(h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete this file permanently?')) return;
    try { await api('/resources/' + id, { method: 'DELETE' }); toast('Deleted'); close(); refresh?.(); } catch (e) { fail(e); } } }, 'Delete'));
  body.append(
    h('header', null, h('div', null, h('span', { class: 'tag ' + item.type }, TYPES[item.type]), h('h2', { style: 'margin-top:6px' }, item.title),
      h('div', { class: 'muted' }, [item.subject_code ? `${item.subject_code} · ${item.subject_name}` : null, item.semester ? 'Semester ' + item.semester : null, item.year, item.exam_type].filter(Boolean).join(' · '))),
      h('button', { class: 'close', 'aria-label': 'Close', onclick: close }, '✕')),
    item.description ? h('p', null, item.description) : null, actions,
    canPreview ? (ext === 'pdf' || ext === 'txt' ? h('iframe', { class: 'preview', src: `/api/resources/${id}/view`, title: 'Preview' }) : h('img', { class: 'preview img', src: `/api/resources/${id}/view`, alt: item.title })) :
      h('p', { class: 'muted', style: 'margin-top:14px' }, 'Preview is not available for this file type. Download it to open.'),
    h('h3', null, 'Remarks'), form, remarks);
  async function loadRemarks() {
    try {
      const ms = await api('/remarks?resource_id=' + id);
      remarks.replaceChildren(...(ms.length ? ms.map(m => h('div', { class: 'remark' },
        h('div', null, h('b', null, m.name), m.role !== 'student' ? ` (${m.role})` : '', m.rating ? [' ', stars(m.rating)] : null, h('span', { class: 'muted' }, ' · ' + fmtDate(m.created_at))),
        h('div', { style: 'white-space:pre-line' }, m.body),
        me && (isStaff() || me.id === m.user_id) ? h('button', { class: 'btn light small', style: 'margin-top:6px', onclick: async () => { await api('/remarks/' + m.id, { method: 'DELETE' }).catch(fail); loadRemarks(); } }, 'Delete remark') : null)) :
        [h('p', { class: 'muted' }, 'No remarks yet.')]));
    } catch (e) { remarks.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  }
  if (me) {
    const ta = h('textarea', { placeholder: 'Is the paper complete? Are the notes accurate? Add a tip for others.', 'aria-label': 'Remark' });
    const rt = h('select', { 'aria-label': 'Rating' }, opts([['', 'No rating'], [5, '5 – Excellent'], [4, '4 – Good'], [3, '3 – Okay'], [2, '2 – Poor'], [1, '1 – Bad']]));
    form.append(h('div', { class: 'form' }, ta, h('div', { class: 'row' }, rt, h('button', { class: 'btn', onclick: async () => {
      try { await api('/remarks', { json: { resource_id: id, body: ta.value, rating: rt.value } }); ta.value = ''; toast('Remark posted'); loadRemarks(); refresh?.(); } catch (e) { fail(e); } } }, 'Post remark'))));
  } else form.append(h('p', { class: 'muted' }, h('a', { href: '#/login', onclick: close }, 'Log in'), ' to add a remark.'));
  dlg.append(body); document.body.append(dlg); dlg.addEventListener('close', () => dlg.remove()); dlg.showModal(); loadRemarks();
}

async function syllabus(q) {
  await loadSubjects();
  let sem = +q.sem || 1;
  const tabs = h('div', { class: 'tabs', role: 'tablist' }), out = h('div');
  const draw = () => {
    tabs.replaceChildren(...Array.from({ length: SITE.semesters }, (_, i) => h('button', { role: 'tab', 'aria-selected': String(sem === i + 1), onclick: () => { sem = i + 1; draw(); } }, 'Semester ' + (i + 1))));
    const subs = subjects.filter(s => s.semester === sem);
    out.replaceChildren(...(subs.length ? subs.map(s => {
      const rem = h('div');
      return h('div', { class: 'subj' }, h('h3', null, h('span', { class: 'code' }, s.code), s.name),
        h('div', { class: 'muted' }, `${s.credits} credits · ${s.resource_count} file${s.resource_count === 1 ? '' : 's'}`),
        h('p', { style: 'margin-top:10px' }, s.syllabus || 'Syllabus not added yet.'),
        h('div', { class: 'row' },
          h('a', { class: 'btn small', href: '#/library?subject=' + s.id }, 'Papers & notes'),
          h('button', { class: 'btn light small', onclick: () => subjectRemarks(s, rem) }, 'Remarks')), rem);
    }) : [h('div', { class: 'empty' }, 'No subjects added for this semester yet.' + (isStaff() ? ' Add them under Manage → Subjects.' : '')) ]));
  };
  appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, 'Syllabus'), tabs, out)));
  draw();
}
async function subjectRemarks(s, box) {
  if (box.childNodes.length) return box.replaceChildren();
  const list = h('div'), reload = async () => {
    const ms = await api('/remarks?subject_id=' + s.id).catch(() => []);
    list.replaceChildren(...(ms.length ? ms.map(m => h('div', { class: 'remark' }, h('b', null, m.name), h('span', { class: 'muted' }, ' · ' + fmtDate(m.created_at)), h('div', { style: 'white-space:pre-line' }, m.body))) : [h('p', { class: 'muted' }, 'No remarks yet.')]));
  };
  box.append(h('div', { style: 'margin-top:12px' }, list));
  if (me) { const ta = h('textarea', { placeholder: 'Add a remark about this subject: difficulty, best books, exam pattern…', 'aria-label': 'Remark' });
    box.append(h('div', { class: 'form', style: 'margin-top:10px' }, ta, h('div', null, h('button', { class: 'btn small', onclick: async () => {
      try { await api('/remarks', { json: { subject_id: s.id, body: ta.value } }); ta.value = ''; reload(); toast('Remark posted'); } catch (e) { fail(e); } } }, 'Post remark')))); }
  else box.append(h('p', { class: 'muted' }, h('a', { href: '#/login' }, 'Log in'), ' to add a remark.'));
  reload();
}

function login() {
  if (me) { location.hash = '#/account'; return; }
  let mode = 'login';
  const box = h('div', { class: 'panel auth' }), msg = h('p', { class: 'err', role: 'alert' });
  const draw = () => {
    const reg = mode === 'register';
    const i = { name: h('input', { type: 'text', autocomplete: 'name' }), roll: h('input', { type: 'text' }), sem: h('select', null, opts(semOpts('Select'))),
      email: h('input', { type: 'email', autocomplete: 'email', required: true }), pw: h('input', { type: 'password', autocomplete: reg ? 'new-password' : 'current-password', required: true }) };
    const submit = async ev => {
      ev.preventDefault(); msg.textContent = '';
      try {
        const body = reg ? { name: i.name.value, roll_no: i.roll.value, semester: i.sem.value, email: i.email.value, password: i.pw.value } : { email: i.email.value, password: i.pw.value };
        me = (await api('/auth/' + mode, { json: body })).user; toast('Welcome, ' + me.name.split(' ')[0]); location.hash = '#/home'; route();
      } catch (e) { msg.textContent = e.message; }
    };
    box.replaceChildren(h('h2', null, reg ? 'Create student account' : 'Log in'),
      h('form', { class: 'form', onsubmit: submit },
        reg ? [field('Full name', i.name), h('div', { class: 'grid2' }, field('Roll number', i.roll), field('Semester', i.sem))] : null,
        field('Email', i.email), field(reg ? 'Password (8+ characters)' : 'Password', i.pw), msg,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, reg ? 'Create account' : 'Log in'),
          h('button', { class: 'btn light', type: 'button', onclick: () => { mode = reg ? 'login' : 'register'; draw(); } }, reg ? 'I already have an account' : 'Create an account'))));
  };
  draw(); appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, box)));
}

async function upload() {
  if (!me) return appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, 'Upload a file'),
    h('div', { class: 'panel' }, h('p', null, 'Log in to upload papers, notes or syllabus files.'), h('a', { class: 'btn', href: '#/login' }, 'Log in')))));
  await loadSubjects();
  const fileIn = h('input', { type: 'file', accept: '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg,.zip' });
  const dropText = h('span', null, 'Drop a file here or click to choose. PDF, Word, PowerPoint, Excel, images, ZIP.');
  const drop = h('label', { class: 'drop' }, dropText, fileIn);
  fileIn.onchange = () => dropText.textContent = fileIn.files[0] ? `${fileIn.files[0].name} (${fmtSize(fileIn.files[0].size)})` : 'Drop a file here or click to choose.';
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) { fileIn.files = e.dataTransfer.files; fileIn.onchange(); } });
  const f = {
    title: h('input', { type: 'text', maxlength: 150, placeholder: 'e.g. Analog Electronics – End Sem 2024' }),
    type: h('select', null, opts(Object.entries(TYPES))), sem: h('select', null, opts(semOpts('Same as subject'))),
    sub: h('select', null, subjectOptions('Not linked to a subject')),
    year: h('input', { type: 'number', min: 1990, max: 2100, placeholder: 'Exam year' }),
    exam: h('select', null, opts([['', 'Not an exam paper'], ['Mid-sem', 'Mid-sem'], ['End-sem', 'End-sem'], ['Quiz', 'Quiz'], ['Supplementary', 'Supplementary']])),
    desc: h('textarea', { maxlength: 1000, placeholder: 'Anything useful: units covered, handwritten or typed, faculty name…' })
  };
  const bar = h('div', { class: 'bar', hidden: true }, h('i')), msg = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Upload file');
  const submit = ev => {
    ev.preventDefault(); msg.textContent = '';
    if (!fileIn.files[0]) { msg.textContent = 'Choose a file to upload.'; return; }
    const fd = new FormData();
    Object.entries({ title: f.title, type: f.type, semester: f.sem, subject_id: f.sub, year: f.year, exam_type: f.exam, description: f.desc }).forEach(([k, el]) => fd.append(k, el.value));
    fd.append('file', fileIn.files[0]);
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/resources'); bar.hidden = false; btn.disabled = true;
    xhr.upload.onprogress = e => { if (e.lengthComputable) $('i', bar).style.width = (e.loaded / e.total * 100) + '%'; };
    xhr.onerror = () => { btn.disabled = false; msg.textContent = 'You are offline. Connect to the department network and try again.'; };
    xhr.onload = () => {
      btn.disabled = false; const d = JSON.parse(xhr.responseText || '{}');
      if (xhr.status >= 400) { msg.textContent = d.error || 'Upload failed.'; return; }
      toast(d.status === 'approved' ? 'Uploaded and published' : 'Uploaded. A faculty member will review it before it appears.');
      location.hash = '#/account';
    };
    xhr.send(fd);
  };
  appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, 'Upload a file'),
    h('p', { class: 'muted' }, isStaff() ? 'Files you upload are published immediately.' : 'Student uploads are reviewed by faculty before they appear in the library.'),
    h('form', { class: 'form panel', onsubmit: submit }, drop, field('Title', f.title),
      h('div', { class: 'grid2' }, field('Type', f.type), field('Exam type', f.exam)),
      h('div', { class: 'grid2' }, field('Subject', f.sub), field('Semester', f.sem)), field('Year', f.year), field('Description (optional)', f.desc), bar, msg, h('div', null, btn)))));
}

async function account() {
  if (!me) { location.hash = '#/login'; return; }
  const mine = h('div', { class: 'list' }), msg = h('p', { class: 'err' });
  const cur = h('input', { type: 'password', autocomplete: 'current-password' }), nxt = h('input', { type: 'password', autocomplete: 'new-password' });
  appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, me.name),
    h('p', { class: 'muted' }, `${me.email} · ${me.role}${me.roll_no ? ' · Roll ' + me.roll_no : ''}`),
    h('h2', null, 'My uploads'), mine,
    h('h2', { style: 'margin-top:36px' }, 'Change password'),
    h('form', { class: 'form panel', onsubmit: async e => { e.preventDefault(); msg.textContent = '';
      try { await api('/auth/password', { json: { current: cur.value, next: nxt.value } }); cur.value = nxt.value = ''; toast('Password changed'); } catch (er) { msg.textContent = er.message; } } },
      field('Current password', cur), field('New password (8+ characters)', nxt), msg, h('div', null, h('button', { class: 'btn', type: 'submit' }, 'Change password'))))));
  const load = async () => { const rs = await api('/resources?mine=1').catch(() => []);
    mine.replaceChildren(...(rs.length ? rs.map(r => resRow(r, load)) : [h('div', { class: 'empty' }, 'You have not uploaded anything yet.')])); };
  load();
}

/* ---------- manage (faculty / admin) ---------- */
async function manage() {
  if (!isStaff()) { appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, 'Manage'), h('div', { class: 'empty' }, 'Faculty or admin access is required.')))); return; }
  await loadSubjects();
  const admin = me.role === 'admin';
  const panes = { review: pReview, subjects: pSubjects, notices: pNotices, ...(admin ? { users: pUsers, activity: pActivity, backup: pBackup } : {}) };
  const names = { review: 'Review uploads', subjects: 'Subjects & syllabus', notices: 'Notices', users: 'Users', activity: 'Activity log', backup: 'Backup' };
  let cur = sessionStorage.getItem('tab') || 'review'; if (!panes[cur]) cur = 'review';
  const stats = h('div', { class: 'stats' }), tabs = h('div', { class: 'tabs', role: 'tablist' }), pane = h('div');
  const draw = () => { sessionStorage.setItem('tab', cur);
    tabs.replaceChildren(...Object.keys(panes).map(k => h('button', { role: 'tab', 'aria-selected': String(k === cur), onclick: () => { cur = k; draw(); } }, names[k])));
    pane.replaceChildren(); panes[cur](pane, loadStats); };
  async function loadStats() { const s = await api('/admin/stats').catch(() => null); if (!s) return;
    stats.replaceChildren(...[['Users', s.users], ['Subjects', s.subjects], ['Published files', s.resources], ['Awaiting review', s.pending], ['Downloads', s.downloads], ['Remarks', s.remarks], ['Storage', fmtSize(s.storage_bytes) || '0 KB']].map(([l, v]) => h('div', { class: 'stat' }, h('b', null, v), l))); }
  appEl.replaceChildren(h('div', { class: 'page' }, h('div', { class: 'wrap' }, h('h1', null, 'Manage'), stats, tabs, pane)));
  loadStats(); draw();
}
async function pReview(pane, stats) {
  const list = h('div', { class: 'list' }); pane.append(h('h2', null, 'Waiting for review'), list);
  const load = async () => { const rs = await api('/resources?status=pending').catch(() => []); stats();
    list.replaceChildren(...(rs.length ? rs.map(r => { const row = resRow(r, load);
      $('.row', row).append(h('button', { class: 'btn light small', onclick: async () => { await api(`/resources/${r.id}/status`, { method: 'PATCH', json: { status: 'approved' } }).catch(fail); toast('Approved'); load(); } }, 'Approve'),
        h('button', { class: 'btn danger small', onclick: async () => { await api(`/resources/${r.id}/status`, { method: 'PATCH', json: { status: 'rejected' } }).catch(fail); toast('Rejected'); load(); } }, 'Reject')); return row; })
      : [h('div', { class: 'empty' }, 'Nothing is waiting. New student uploads will show up here.')])); };
  load();
}
function pSubjects(pane) {
  let editing = null;
  const f = { code: h('input', { type: 'text', maxlength: 20 }), name: h('input', { type: 'text', maxlength: 120 }), sem: h('select', null, opts(semOpts('Select').slice(1))),
    cr: h('input', { type: 'number', min: 0, max: 10, value: 3 }), syl: h('textarea', { style: 'min-height:150px', placeholder: 'Unit-wise syllabus text' }) };
  const msg = h('p', { class: 'err' }), table = h('div', { class: 'scroll' }), title = h('h2', null, 'Add subject');
  const reset = () => { editing = null; title.textContent = 'Add subject'; f.code.value = f.name.value = f.syl.value = ''; f.cr.value = 3; };
  const save = async () => { msg.textContent = ''; const body = { code: f.code.value, name: f.name.value, semester: f.sem.value, credits: f.cr.value, syllabus: f.syl.value };
    try { await api(editing ? '/subjects/' + editing : '/subjects', { method: editing ? 'PUT' : 'POST', json: body }); toast('Saved'); reset(); await loadSubjects(); draw(); } catch (e) { msg.textContent = e.message; } };
  const draw = () => table.replaceChildren(h('table', null, h('thead', null, h('tr', null, ['Code', 'Subject', 'Sem', 'Files', ''].map(t => h('th', null, t)))),
    h('tbody', null, subjects.map(s => h('tr', null, h('td', null, s.code), h('td', null, s.name), h('td', null, s.semester), h('td', null, s.resource_count),
      h('td', null, h('div', { class: 'row' }, h('button', { class: 'btn light small', onclick: () => { editing = s.id; title.textContent = 'Edit ' + s.code; f.code.value = s.code; f.name.value = s.name; f.sem.value = s.semester; f.cr.value = s.credits; f.syl.value = s.syllabus; scrollTo(0, 0); } }, 'Edit'),
        me.role === 'admin' ? h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('Delete ' + s.code + '? Files stay but lose their subject link.')) return; await api('/subjects/' + s.id, { method: 'DELETE' }).catch(fail); await loadSubjects(); draw(); } }, 'Delete') : null)))))));
  pane.append(h('div', { class: 'panel form' }, title, h('div', { class: 'grid2' }, field('Subject code', f.code), field('Semester', f.sem)), field('Subject name', f.name), field('Credits', f.cr), field('Syllabus', f.syl), msg,
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: save }, 'Save subject'), h('button', { class: 'btn light', onclick: reset }, 'Clear form'))), h('h2', { style: 'margin-top:30px' }, 'All subjects'), table);
  draw();
}
function pNotices(pane) {
  const t = h('input', { type: 'text', maxlength: 150 }), b = h('textarea'), pin = h('input', { type: 'checkbox' }), list = h('div');
  const load = async () => { const ns = await api('/notices').catch(() => []);
    list.replaceChildren(...(ns.length ? ns.map(n => h('div', { class: 'notice' + (n.pinned ? ' pin' : '') }, h('h3', null, n.title), h('p', { style: 'margin:0;white-space:pre-line' }, n.body),
      h('button', { class: 'btn light small', onclick: async () => { await api('/notices/' + n.id, { method: 'DELETE' }).catch(fail); load(); } }, 'Delete'))) : [h('div', { class: 'empty' }, 'No notices posted.')])); };
  pane.append(h('div', { class: 'panel form' }, h('h2', null, 'Post a notice'), field('Title', t), field('Message', b),
    h('label', { style: 'font-weight:500' }, pin, ' Pin to the top'), h('div', null, h('button', { class: 'btn', onclick: async () => {
      try { await api('/notices', { json: { title: t.value, body: b.value, pinned: pin.checked } }); t.value = b.value = ''; toast('Notice posted'); load(); } catch (e) { fail(e); } } }, 'Post notice'))),
    h('h2', { style: 'margin-top:30px' }, 'Current notices'), list);
  load();
}
function pUsers(pane) {
  const box = h('div', { class: 'scroll' }); pane.append(h('h2', null, 'Users'), box);
  const load = async () => { const us = await api('/admin/users').catch(() => []);
    box.replaceChildren(h('table', null, h('thead', null, h('tr', null, ['Name', 'Email', 'Role', 'Status', 'Actions'].map(t => h('th', null, t)))),
      h('tbody', null, us.map(u => { const self = u.id === me.id;
        const role = h('select', { disabled: self, 'aria-label': 'Role for ' + u.name, onchange: async e => { await api('/admin/users/' + u.id, { method: 'PATCH', json: { role: e.target.value } }).catch(fail); toast('Role updated'); } }, opts([['student', 'Student'], ['faculty', 'Faculty'], ['admin', 'Admin']], u.role));
        return h('tr', null, h('td', null, u.name, u.roll_no ? h('div', { class: 'muted' }, u.roll_no) : null), h('td', null, u.email), h('td', null, role), h('td', null, u.active ? 'Active' : 'Disabled'),
          h('td', null, self ? '' : h('div', { class: 'row' },
            h('button', { class: 'btn light small', onclick: async () => { await api('/admin/users/' + u.id, { method: 'PATCH', json: { active: !u.active } }).catch(fail); load(); } }, u.active ? 'Disable' : 'Enable'),
            h('button', { class: 'btn light small', onclick: async () => { const p = prompt('New password for ' + u.name + ' (8+ characters):'); if (!p) return; try { await api('/admin/users/' + u.id, { method: 'PATCH', json: { reset_password: p } }); toast('Password reset'); } catch (e) { fail(e); } } }, 'Reset password'),
            h('button', { class: 'btn danger small', onclick: async () => { if (!confirm('Delete ' + u.name + ' and all their uploads?')) return; await api('/admin/users/' + u.id, { method: 'DELETE' }).catch(fail); load(); } }, 'Delete')))); })))); };
  load();
}
function pActivity(pane) {
  const box = h('div', { class: 'scroll' }); pane.append(h('h2', null, 'Recent activity'), box);
  api('/admin/audit').then(rows => box.replaceChildren(h('table', null, h('thead', null, h('tr', null, ['When', 'Who', 'Action', 'Detail'].map(t => h('th', null, t)))),
    h('tbody', null, rows.map(r => h('tr', null, h('td', null, fmtDate(r.created_at)), h('td', null, r.name || '—'), h('td', null, r.action), h('td', null, r.detail || ''))))))).catch(fail);
}
function pBackup(pane) {
  pane.append(h('div', { class: 'panel' }, h('h2', null, 'Database backup'),
    h('p', null, 'Download a snapshot of the whole database (users, subjects, file records, remarks, notices). Uploaded files live in the server’s uploads folder: copy that folder too for a full backup.'),
    h('a', { class: 'btn', href: '/api/admin/backup', download: '' }, 'Download database backup')));
}

/* ---------- router ---------- */
const routes = { home, papers: () => library({ type: 'paper' }), notes: () => library({ type: 'notes' }), library: q => library(q), syllabus, upload, login, account, manage };
async function route() {
  const [path, qs] = location.hash.slice(2).split('?'), q = Object.fromEntries(new URLSearchParams(qs || ''));
  renderChrome(path); appEl.replaceChildren(h('p', { class: 'wrap muted', style: 'padding-top:30px' }, 'Loading…'));
  try { await (routes[path || 'home'] || home)(q); } catch (e) { appEl.replaceChildren(h('div', { class: 'wrap page' }, h('p', { class: 'err' }, e.message))); }
  window.scrollTo(0, 0); appEl.focus({ preventScroll: true });
}
addEventListener('hashchange', route);
addEventListener('offline', () => toast('You are offline. Saved pages and files still work.'));
(async () => {
  try { me = (await api('/auth/me')).user; } catch { /* offline */ }
  await loadSubjects(); route();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
