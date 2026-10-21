// SQLite database (single local file -> works fully offline)
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'ece.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student','faculty','admin')),
  roll_no TEXT,
  semester INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  semester INTEGER NOT NULL,
  credits INTEGER DEFAULT 3,
  syllabus TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('paper','notes','syllabus','lab','other')),
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  semester INTEGER,
  year INTEGER,
  exam_type TEXT,
  description TEXT DEFAULT '',
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS remarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_filter ON resources(status, type, semester, subject_id);
CREATE INDEX IF NOT EXISTS idx_remarks_res ON remarks(resource_id);
`);

// ---- Seed: admin account + starter subjects ----
const adminEmail = (process.env.ADMIN_EMAIL || 'admin@ece.local').toLowerCase();
const isProd = process.env.NODE_ENV === 'production';
// In production never fall back to the well-known default password: generate one and print it once.
const generated = isProd && !process.env.ADMIN_PASSWORD;
const adminPass = process.env.ADMIN_PASSWORD || (generated ? require('crypto').randomBytes(9).toString('base64url') : 'Admin@12345');
if (!db.prepare('SELECT 1 FROM users WHERE role = ?').get('admin')) {
  db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
    .run('Department Admin', adminEmail, bcrypt.hashSync(adminPass, 12), 'admin');
  console.log(`[seed] Admin created: ${adminEmail}  (change the password after first login)`);
  if (generated) console.log(`[seed] ADMIN_PASSWORD was not set, so a temporary password was generated: ${adminPass}`);
}
if (!db.prepare('SELECT 1 FROM subjects LIMIT 1').get()) {
  const ins = db.prepare('INSERT INTO subjects (code,name,semester,credits,syllabus) VALUES (?,?,?,?,?)');
  const seed = [
    ['EC301', 'Network Analysis & Synthesis', 3, 4, 'Network theorems, transient analysis, two-port networks, filters, Foster & Cauer synthesis.'],
    ['EC302', 'Analog Electronics', 3, 4, 'BJT/FET biasing, small-signal models, amplifiers, feedback, op-amp applications, oscillators.'],
    ['EC303', 'Digital Electronics', 3, 4, 'Boolean algebra, combinational and sequential logic, FSMs, memories, PLDs.'],
    ['EC401', 'Signals & Systems', 4, 4, 'LTI systems, Fourier series/transform, Laplace and Z-transforms, sampling.'],
    ['EC402', 'Electromagnetic Theory', 4, 3, 'Maxwell equations, wave propagation, transmission lines, waveguides, antennas basics.'],
    ['EC501', 'Analog & Digital Communication', 5, 4, 'AM/FM, noise, PCM, DM, ASK/FSK/PSK, information theory, error coding.'],
    ['EC502', 'Microprocessors & Microcontrollers', 5, 4, '8085/8051/ARM architecture, interfacing, interrupts, embedded C.'],
    ['EC601', 'Digital Signal Processing', 6, 4, 'DFT/FFT, FIR/IIR filter design, multirate processing, DSP processors.'],
    ['EC602', 'VLSI Design', 6, 4, 'CMOS logic, layout, timing, Verilog/VHDL, FPGA flow.'],
    ['EC701', 'Microwave & Antenna Engineering', 7, 3, 'S-parameters, microwave devices, antenna arrays, radar basics.'],
  ];
  const tx = db.transaction(() => seed.forEach(r => ins.run(...r)));
  tx();
}

module.exports = { db, DATA_DIR };
