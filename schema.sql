-- Cloudflare D1 Schema for GCS Certificate Verification Portal
-- Highly optimized for minimal Read & Write operations

-- 1. Certificates Master Table (Single table with embedded audit history JSON)
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  year TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  certificate_type TEXT NOT NULL,
  date_issued TEXT NOT NULL,
  issued_by TEXT DEFAULT 'GCS Medical College, Hospital & Research Centre',
  reference_no TEXT DEFAULT '',
  description TEXT DEFAULT '',
  table_data TEXT DEFAULT '',
  status TEXT DEFAULT 'Valid', -- 'Valid' or 'Revoked'
  issued_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  audit_trail TEXT DEFAULT '[]', -- JSON array of [{action, user, timestamp, details}]
  scan_count INTEGER DEFAULT 0,
  last_scanned_at TEXT DEFAULT ''
);

-- Indexes for lightning-fast paginated queries (O(log N) row reads)
CREATE INDEX IF NOT EXISTS idx_certs_user_created ON certificates(issued_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certs_created ON certificates(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_certs_year ON certificates(year, created_at DESC);

-- 2. Staff Users Table
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT DEFAULT '',
  login_id TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'USER', -- 'SUPER_ADMIN', 'ADMIN', 'USER'
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 3. Portal Configuration Table
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Default Super Admin User (if not exists)
INSERT OR IGNORE INTO users (user_id, name, designation, login_id, password_hash, role, active, created_at, updated_at)
VALUES (
  'user-superadmin-jaydeep',
  'Dr. Jaydeep Ghevariya',
  'Portal Administrator',
  'jaydeep.ghevariya@gcsmc.org',
  '1234567890@Abc',
  'SUPER_ADMIN',
  1,
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z'
);

-- Default Config
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES 
  ('HEADER_BRANDING', 'GCS Foundation', '2026-01-01T00:00:00Z'),
  ('SUB_BRANDING', 'Certificate Verification Portal', '2026-01-01T00:00:00Z'),
  ('CONTACT_EMAIL', 'info@gcsmc.org', '2026-01-01T00:00:00Z'),
  ('PREFIX_URL', 'https://verify.jaydeep-ghevariya.workers.dev/?id=', '2026-01-01T00:00:00Z');
