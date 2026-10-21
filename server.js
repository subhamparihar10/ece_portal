const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, DATA_DIR } = require('./db');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// JWT secret: env var, else generated once and stored locally
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(f, 'utf8');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'self'"],
  frameSrc: ["'self'"], connectSrc: ["'self'"], workerSrc: ["'self'"], upgradeInsecureRequests: null
}}}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// ---------- helpers ----------
const audit = (uid, action, detail = '') =>
  db.prepare('INSERT INTO audit_log (user_id,action,detail) VALUES (?,?,?)').run(uid || null, action, String(detail).slice(0, 500));
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (s, max = 500) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
const int = v => (v === '' || v == null || isNaN(+v) ? null : Math.trunc(+v));
const isStaff = u => u && (u.role === 'faculty' || u.role === 'admin');

function issueToken(res, user) {
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === '1' || !!res.req.secure, maxAge: 7 * 864e5 });
}
function loadUser(req, _res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token, SECRET);
    const u = db.prepare('SELECT id,name,email,role,roll_no,semester,active FROM users WHERE id=?').get(id);
    if (u && u.active) req.user = u;
  } catch {}
  next();
}
const need = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please log in first.' });
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
  next();
};
app.use(loadUser);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

// ---------- auth ----------
app.post('/api/auth/register', authLimiter, wrap((req, res) => {
  const name = clean(req.body.name, 80), email = clean(req.body.email, 120).toLowerCase(), pw = req.body.password || '';
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter your name and a valid email.' });
  if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'That email is already registered.' });
  const r = db.prepare('INSERT INTO users (name,email,password_hash,role,roll_no,semester) VALUES (?,?,?,?,?,?)')
    .run(name, email, bcrypt.hashSync(pw, 12), 'student', clean(req.body.roll_no, 30), int(req.body.semester));
  audit(r.lastInsertRowid, 'register', email);
  const user = db.prepare('SELECT id,name,email,role,roll_no,semester FROM users WHERE id=?').get(r.lastInsertRowid);
  issueToken(res, user); res.json({ user });
}));
app.post('/api/auth/login', authLimiter, wrap((req, res) => {
  const email = clean(req.body.email, 120).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || !u.active || !bcrypt.compareSync(req.body.password || '', u.password_hash))
    return res.status(401).json({ error: 'Email or password is incorrect.' });
  audit(u.id, 'login');
  issueToken(res, u);
  res.json({ user: { id: u.id, name: u.name, email: u.email, role: u.role, roll_no: u.roll_no, semester: u.semester } });
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('token'); res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => res.json({ user: req.user || null }));
app.post('/api/auth/password', need(), wrap((req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.current || '', u.password_hash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if ((req.body.next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.next, 12), u.id);
  audit(u.id, 'password_change'); res.json({ ok: true });
}));

// ---------- subjects / syllabus ----------
app.get('/api/subjects', (req, res) => {
  const sem = int(req.query.semester);
  const rows = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM resources r WHERE r.subject_id=s.id AND r.status='approved') AS resource_count
    FROM subjects s ${sem ? 'WHERE s.semester=?' : ''} ORDER BY s.semester, s.code`).all(...(sem ? [sem] : []));
  res.json(rows);
});
const subjectFields = b => [clean(b.code, 20).toUpperCase(), clean(b.name, 120), int(b.semester), int(b.credits) ?? 3, clean(b.syllabus, 8000)];
app.post('/api/subjects', need('faculty', 'admin'), wrap((req, res) => {
  const f = subjectFields(req.body);
  if (!f[0] || !f[1] || !f[2]) return res.status(400).json({ error: 'Code, name and semester are required.' });
  try {
    const r = db.prepare('INSERT INTO subjects (code,name,semester,credits,syllabus) VALUES (?,?,?,?,?)').run(...f);
    audit(req.user.id, 'subject_add', f[0]); res.json({ id: r.lastInsertRowid });
  } catch { res.status(409).json({ error: 'A subject with that code already exists.' }); }
}));
app.put('/api/subjects/:id', need('faculty', 'admin'), wrap((req, res) => {
  const f = subjectFields(req.body);
  db.prepare('UPDATE subjects SET code=?,name=?,semester=?,credits=?,syllabus=? WHERE id=?').run(...f, req.params.id);
  audit(req.user.id, 'subject_edit', f[0]); res.json({ ok: true });
}));
app.delete('/api/subjects/:id', need('admin'), wrap((req, res) => {
  db.prepare('DELETE FROM subjects WHERE id=?').run(req.params.id);
  audit(req.user.id, 'subject_delete', req.params.id); res.json({ ok: true });
}));

// ---------- resources (papers / notes / syllabus files) ----------
const ALLOWED = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.txt', '.png', '.jpg', '.jpeg', '.zip']);
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(f.originalname).toLowerCase())
  }),
  limits: { fileSize: (+process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024, files: 1 },
  fileFilter: (_r, f, cb) => ALLOWED.has(path.extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('File type not allowed.'))
});
const RES_SELECT = `SELECT r.id,r.title,r.type,r.subject_id,r.semester,r.year,r.exam_type,r.description,r.original_name,r.mime,r.size,
  r.status,r.downloads,r.created_at,r.uploaded_by,u.name AS uploader,s.code AS subject_code,s.name AS subject_name,
  (SELECT ROUND(AVG(rating),1) FROM remarks WHERE resource_id=r.id) AS avg_rating,
  (SELECT COUNT(*) FROM remarks WHERE resource_id=r.id) AS remark_count
  FROM resources r JOIN users u ON u.id=r.uploaded_by LEFT JOIN subjects s ON s.id=r.subject_id`;

app.get('/api/resources', wrap((req, res) => {
  const q = req.query, w = [], p = [];
  const mine = req.user && q.mine === '1';
  if (mine) { w.push('r.uploaded_by=?'); p.push(req.user.id); }
  else if (q.status && isStaff(req.user)) { w.push('r.status=?'); p.push(q.status); }
  else w.push("r.status='approved'");
  if (q.type) { w.push('r.type=?'); p.push(q.type); }
  if (int(q.semester)) { w.push('r.semester=?'); p.push(int(q.semester)); }
  if (int(q.subject)) { w.push('r.subject_id=?'); p.push(int(q.subject)); }
  if (int(q.year)) { w.push('r.year=?'); p.push(int(q.year)); }
  if (q.q) { w.push('(r.title LIKE ? OR r.description LIKE ? OR s.name LIKE ? OR s.code LIKE ?)'); const l = `%${clean(q.q, 80)}%`; p.push(l, l, l, l); }
  const order = { new: 'r.created_at DESC', popular: 'r.downloads DESC', year: 'r.year DESC' }[q.sort] || 'r.created_at DESC';
  res.json(db.prepare(`${RES_SELECT} WHERE ${w.join(' AND ')} ORDER BY ${order} LIMIT 300`).all(...p));
}));

app.post('/api/resources', need(), (req, res, next) => upload.single('file')(req, res, e => e ? res.status(400).json({ error: e.message }) : next()),
  wrap((req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });
    const b = req.body, type = ['paper', 'notes', 'syllabus', 'lab', 'other'].includes(b.type) ? b.type : 'other';
    const title = clean(b.title, 150);
    if (!title) { fs.unlink(req.file.path, () => {}); return res.status(400).json({ error: 'Add a title.' }); }
    const subj = int(b.subject_id);
    const sem = int(b.semester) ?? (subj ? db.prepare('SELECT semester FROM subjects WHERE id=?').get(subj)?.semester : null);
    const status = isStaff(req.user) ? 'approved' : 'pending';
    const r = db.prepare(`INSERT INTO resources (title,type,subject_id,semester,year,exam_type,description,filename,original_name,mime,size,uploaded_by,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, type, subj, sem, int(b.year), clean(b.exam_type, 30), clean(b.description, 1000),
      req.file.filename, req.file.originalname.slice(0, 200), req.file.mimetype, req.file.size, req.user.id, status);
    audit(req.user.id, 'upload', `${title} [${status}]`);
    res.json({ id: r.lastInsertRowid, status });
  }));

app.get('/api/resources/:id', wrap((req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(404).json({ error: 'File not found.' });
  const r = db.prepare(`${RES_SELECT} WHERE r.id=?`).get(req.params.id);
  if (!r || !(r.status === 'approved' || (req.user && (isStaff(req.user) || req.user.id === r.uploaded_by)))) return res.status(404).json({ error: 'File not found.' });
  res.json(r);
}));

function canSee(user, r) { return r.status === 'approved' || (user && (isStaff(user) || user.id === r.uploaded_by)); }
function sendFile(req, res, disposition) {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r || !canSee(req.user, r)) return res.status(404).json({ error: 'File not found.' });
  const fp = path.join(UPLOAD_DIR, r.filename);
  if (!fs.existsSync(fp)) return res.status(410).json({ error: 'File is missing on the server.' });
  if (disposition === 'attachment') db.prepare('UPDATE resources SET downloads=downloads+1 WHERE id=?').run(r.id);
  res.setHeader('Content-Type', r.mime || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(r.original_name)}`);
  fs.createReadStream(fp).pipe(res);
}
app.get('/api/resources/:id/download', (req, res) => sendFile(req, res, 'attachment'));
app.get('/api/resources/:id/view', (req, res) => sendFile(req, res, 'inline'));

app.patch('/api/resources/:id/status', need('faculty', 'admin'), wrap((req, res) => {
  if (!['approved', 'rejected', 'pending'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare('UPDATE resources SET status=? WHERE id=?').run(req.body.status, req.params.id);
  audit(req.user.id, 'moderate', `#${req.params.id} -> ${req.body.status}`); res.json({ ok: true });
}));
app.delete('/api/resources/:id', need(), wrap((req, res) => {
  const r = db.prepare('SELECT * FROM resources WHERE id=?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found.' });
  if (!(isStaff(req.user) || r.uploaded_by === req.user.id)) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('DELETE FROM resources WHERE id=?').run(r.id);
  fs.unlink(path.join(UPLOAD_DIR, r.filename), () => {});
  audit(req.user.id, 'resource_delete', r.title); res.json({ ok: true });
}));

// ---------- remarks ----------
app.get('/api/remarks', wrap((req, res) => {
  const col = int(req.query.resource_id) ? 'resource_id' : int(req.query.subject_id) ? 'subject_id' : null;
  if (!col) return res.status(400).json({ error: 'resource_id or subject_id required.' });
  res.json(db.prepare(`SELECT m.id,m.rating,m.body,m.created_at,m.user_id,u.name,u.role FROM remarks m JOIN users u ON u.id=m.user_id
    WHERE m.${col}=? ORDER BY m.created_at DESC LIMIT 200`).all(int(req.query[col])));
}));
app.post('/api/remarks', need(), wrap((req, res) => {
  const body = clean(req.body.body, 1000), rid = int(req.body.resource_id), sid = int(req.body.subject_id), rating = int(req.body.rating);
  if (!body || (!rid && !sid)) return res.status(400).json({ error: 'Write a remark first.' });
  if (rating && (rating < 1 || rating > 5)) return res.status(400).json({ error: 'Rating must be 1-5.' });
  db.prepare('INSERT INTO remarks (resource_id,subject_id,user_id,rating,body) VALUES (?,?,?,?,?)').run(rid, rid ? null : sid, req.user.id, rating, body);
  res.json({ ok: true });
}));
app.delete('/api/remarks/:id', need(), wrap((req, res) => {
  const m = db.prepare('SELECT * FROM remarks WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found.' });
  if (!(isStaff(req.user) || m.user_id === req.user.id)) return res.status(403).json({ error: 'Not allowed.' });
  db.prepare('DELETE FROM remarks WHERE id=?').run(m.id); res.json({ ok: true });
}));

// ---------- notices ----------
app.get('/api/notices', (_req, res) =>
  res.json(db.prepare('SELECT id,title,body,pinned,created_at FROM notices ORDER BY pinned DESC, created_at DESC LIMIT 50').all()));
app.post('/api/notices', need('faculty', 'admin'), wrap((req, res) => {
  const t = clean(req.body.title, 150), b = clean(req.body.body, 3000);
  if (!t || !b) return res.status(400).json({ error: 'Title and message are required.' });
  db.prepare('INSERT INTO notices (title,body,pinned,created_by) VALUES (?,?,?,?)').run(t, b, req.body.pinned ? 1 : 0, req.user.id);
  audit(req.user.id, 'notice_add', t); res.json({ ok: true });
}));
app.delete('/api/notices/:id', need('faculty', 'admin'), wrap((req, res) => {
  db.prepare('DELETE FROM notices WHERE id=?').run(req.params.id); res.json({ ok: true });
}));

// ---------- admin ----------
app.get('/api/admin/stats', need('faculty', 'admin'), (_req, res) => {
  const c = sql => db.prepare(sql).get().n;
  res.json({
    users: c('SELECT COUNT(*) n FROM users'), subjects: c('SELECT COUNT(*) n FROM subjects'),
    resources: c("SELECT COUNT(*) n FROM resources WHERE status='approved'"), pending: c("SELECT COUNT(*) n FROM resources WHERE status='pending'"),
    downloads: c('SELECT COALESCE(SUM(downloads),0) n FROM resources'), remarks: c('SELECT COUNT(*) n FROM remarks'),
    storage_bytes: c('SELECT COALESCE(SUM(size),0) n FROM resources')
  });
});
app.get('/api/admin/users', need('admin'), (_req, res) =>
  res.json(db.prepare('SELECT id,name,email,role,roll_no,semester,active,created_at FROM users ORDER BY created_at DESC').all()));
app.patch('/api/admin/users/:id', need('admin'), wrap((req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: "You can't change your own role or status." });
  if (req.body.role) {
    if (!['student', 'faculty', 'admin'].includes(req.body.role)) return res.status(400).json({ error: 'Invalid role.' });
    db.prepare('UPDATE users SET role=? WHERE id=?').run(req.body.role, id);
  }
  if (req.body.active != null) db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active ? 1 : 0, id);
  if (req.body.reset_password) {
    if (req.body.reset_password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(req.body.reset_password, 12), id);
  }
  audit(req.user.id, 'user_edit', `#${id} ${JSON.stringify({ role: req.body.role, active: req.body.active })}`); res.json({ ok: true });
}));
app.delete('/api/admin/users/:id', need('admin'), wrap((req, res) => {
  if (+req.params.id === req.user.id) return res.status(400).json({ error: "You can't delete yourself." });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); audit(req.user.id, 'user_delete', req.params.id); res.json({ ok: true });
}));
app.get('/api/admin/audit', need('admin'), (_req, res) =>
  res.json(db.prepare(`SELECT a.id,a.action,a.detail,a.created_at,u.name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200`).all()));
app.get('/api/admin/backup', need('admin'), wrap(async (req, res) => {
  const out = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  await db.backup(out);
  audit(req.user.id, 'backup');
  res.download(out, `ece-backup-${new Date().toISOString().slice(0, 10)}.db`, () => fs.unlink(out, () => {}));
}));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- static frontend ----------
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large.' : 'Something went wrong on the server.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`ECE portal running at http://localhost:${PORT}`));
