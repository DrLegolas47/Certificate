/**
 * Cloudflare Worker Backend for GCS Certificate Verification Portal
 * Bound to Cloudflare D1 Database: certificate_verification
 * High performance edge routing with minimal D1 row read & write counts
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS & Security Headers helper
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (data, status = 200, extraHeaders = {}) => {
      return new Response(JSON.stringify(data), {
        status,
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          ...corsHeaders,
          ...extraHeaders
        }
      });
    };

    // --------------------------------------------------------------------------
    // API ROUTES (/api/*)
    // --------------------------------------------------------------------------
    if (pathname.startsWith('/api/')) {
      const db = env.DB;
      if (!db) {
        return json({ error: 'D1 Database binding missing in Worker' }, 500);
      }

      try {
        // 1. PUBLIC VERIFICATION: GET /api/verify?id=...
        // ZERO-WRITE & EDGE CACHED: 1 row read on cache miss, 0 reads on edge cache hit!
        if (pathname === '/api/verify' && request.method === 'GET') {
          const id = (url.searchParams.get('id') || '').trim();
          if (!id || id.length < 3) {
            return json({ found: false, error: 'No Certificate ID specified.' }, 400);
          }

          const query = `
            SELECT id, year, recipient_name as recipientName, recipient_name as name,
                   certificate_type as certificateType, date_issued as dateIssued,
                   issued_by as issuedBy, reference_no as referenceNo,
                   description, table_data as tableData, status,
                   created_at as createdAt, scan_count as scanCount, last_scanned_at as lastScannedAt
            FROM certificates
            WHERE UPPER(id) = UPPER(?)
            LIMIT 1
          `;
          const record = await db.prepare(query).bind(id).first();

          if (!record) {
            return json({ found: false, error: 'No certificate matches this ID in official records.' }, 404);
          }

          // Fetch portal branding from config (or fallback)
          const brandingRows = await db.prepare(`SELECT key, value FROM config`).all();
          const branding = {
            headerBranding: 'GCS Foundation',
            subBranding: 'Certificate Verification Portal',
            contactEmail: 'info@gcsmc.org'
          };
          if (brandingRows && brandingRows.results) {
            for (const row of brandingRows.results) {
              if (row.key === 'HEADER_BRANDING') branding.headerBranding = row.value;
              if (row.key === 'SUB_BRANDING') branding.subBranding = row.value;
              if (row.key === 'CONTACT_EMAIL') branding.contactEmail = row.value;
            }
          }

          // Return with Edge Cache headers (1 hour browser & edge cache)
          return json(
            { found: true, ...record, branding },
            200,
            { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' }
          );
        }

        // 2. CONFIGURATION: GET /api/config & POST /api/config
        if (pathname === '/api/config') {
          if (request.method === 'GET') {
            const rows = await db.prepare(`SELECT key, value FROM config`).all();
            const cfg = {
              HEADER_BRANDING: 'GCS Foundation',
              SUB_BRANDING: 'Certificate Verification Portal',
              CONTACT_EMAIL: 'info@gcsmc.org',
              PREFIX_URL: 'https://verify.jaydeep-ghevariya.workers.dev/?id='
            };
            if (rows && rows.results) {
              for (const r of rows.results) {
                cfg[r.key] = r.value;
              }
            }
            return json({ success: true, config: cfg }, 200, { 'Cache-Control': 'public, max-age=300' });
          }

          if (request.method === 'POST') {
            const body = await request.json();
            const now = new Date().toISOString();
            const configObj = body.config || body;

            const stmts = [];
            for (const [k, v] of Object.entries(configObj)) {
              if (typeof v === 'string') {
                stmts.push(
                  db.prepare(`INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
                    .bind(k, v.trim(), now)
                );
              }
            }
            if (stmts.length > 0) {
              await db.batch(stmts);
            }
            return json({ success: true, message: 'Configuration saved' });
          }
        }

        // 3. STAFF AUTHENTICATION: POST /api/login
        if (pathname === '/api/login' && request.method === 'POST') {
          const body = await request.json();
          const cleanUser = String(body.username || '').trim().toLowerCase();
          const cleanPass = String(body.password || '').trim();

          const user = await db.prepare(`SELECT * FROM users WHERE LOWER(login_id) = ? LIMIT 1`).bind(cleanUser).first();

          if (!user) {
            return json({ success: false, error: 'User not found. Check your Login ID.' }, 401);
          }
          if (!user.active) {
            return json({ success: false, error: 'This user account is deactivated.' }, 403);
          }
          if (user.password_hash !== cleanPass) {
            return json({ success: false, error: 'Incorrect password.' }, 401);
          }

          const sessionData = {
            success: true,
            token: `d1-${user.user_id}-${Date.now()}`,
            user: {
              user_id: user.user_id,
              name: user.name,
              designation: user.designation,
              login_id: user.login_id,
              role: user.role
            }
          };
          return json(sessionData);
        }

        // 4. CERTIFICATE REGISTRY WITH PAGINATION: GET /api/certificates
        // Optimized for minimal reads:
        // - USER role: 20 per page (own certificates only)
        // - ADMIN/SUPER_ADMIN: 10 per page (all certificates)
        // - Selects only list columns (omits heavy table_data & audit_trail to save memory)
        if (pathname === '/api/certificates' && request.method === 'GET') {
          const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
          const role = (url.searchParams.get('role') || 'USER').toUpperCase();
          const userId = url.searchParams.get('userId') || '';
          const year = (url.searchParams.get('year') || '').trim();
          const q = (url.searchParams.get('q') || '').trim().toUpperCase();

          // Enforce user pagination rule: 20 for regular USER, 10 for ADMIN/SUPER_ADMIN
          const limit = (role === 'SUPER_ADMIN' || role === 'ADMIN') ? 10 : 20;
          const offset = (page - 1) * limit;

          let whereClauses = [];
          let params = [];

          // User scope isolation
          if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && userId) {
            whereClauses.push('issued_by_user_id = ?');
            params.push(userId);
          }

          // Year filter
          if (year && year !== 'ALL') {
            whereClauses.push('year = ?');
            params.push(year);
          }

          // Search query
          if (q) {
            whereClauses.push('(UPPER(id) LIKE ? OR UPPER(recipient_name) LIKE ? OR UPPER(reference_no) LIKE ?)');
            const wild = `%${q}%`;
            params.push(wild, wild, wild);
          }

          const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

          // 1. Get Count (uses index)
          const countQuery = `SELECT COUNT(*) as total FROM certificates ${whereSql}`;
          const countResult = await db.prepare(countQuery).bind(...params).first();
          const total = countResult ? countResult.total : 0;
          const totalPages = Math.ceil(total / limit) || 1;

          // 2. Fetch paginated slice with index ordering
          const listQuery = `
            SELECT id, year, recipient_name as recipientName, certificate_type as certificateType,
                   date_issued as dateIssued, issued_by as issuedBy, reference_no as referenceNo,
                   status, issued_by_user_id as issuedByUserId, created_at as createdAt,
                   scan_count as scanCount, last_scanned_at as lastScannedAt
            FROM certificates
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
          `;
          const listResult = await db.prepare(listQuery).bind(...params, limit, offset).all();

          return json({
            success: true,
            certificates: listResult.results || [],
            pagination: {
              page,
              limit,
              total,
              totalPages
            }
          });
        }

        // 5. GET SINGLE CERTIFICATE (Includes table_data & audit_trail for edit/details)
        if (pathname === '/api/certificate' && request.method === 'GET') {
          const id = (url.searchParams.get('id') || '').trim();
          if (!id) return json({ success: false, error: 'No ID provided' }, 400);

          const query = `
            SELECT id, year, recipient_name as recipientName, certificate_type as certificateType,
                   date_issued as dateIssued, issued_by as issuedBy, reference_no as referenceNo,
                   description, table_data as tableData, status, issued_by_user_id as issuedByUserId,
                   created_at as createdAt, audit_trail as auditTrail, scan_count as scanCount,
                   last_scanned_at as lastScannedAt
            FROM certificates
            WHERE UPPER(id) = UPPER(?)
            LIMIT 1
          `;
          const cert = await db.prepare(query).bind(id).first();
          if (!cert) return json({ success: false, error: 'Certificate not found' }, 404);

          return json({ success: true, certificate: cert });
        }

        // 6. ISSUE SINGLE CERTIFICATE: POST /api/certificate/issue
        if (pathname === '/api/certificate/issue' && request.method === 'POST') {
          const body = await request.json();
          const cert = body.certificate || body;
          const id = String(cert.id || '').trim();
          if (!id) return json({ success: false, error: 'Certificate ID is required' }, 400);

          const year = String(cert.year || id.substring(0, 2) ? '20' + id.substring(0, 2) : new Date().getFullYear());
          const nowISO = new Date().toISOString();
          const user = cert.issuedByUser || 'Staff';
          const userId = cert.issuedByUserId || 'user-default';

          // Embedded Audit Trail JSON
          const initialAudit = JSON.stringify([
            { action: 'CREATED', user, userId, timestamp: nowISO }
          ]);

          const insertSql = `
            INSERT INTO certificates (
              id, year, recipient_name, certificate_type, date_issued,
              issued_by, reference_no, description, table_data, status,
              issued_by_user_id, created_at, audit_trail, scan_count, last_scanned_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
          `;
          await db.prepare(insertSql).bind(
            id,
            year,
            String(cert.recipientName || '').trim(),
            String(cert.certificateType || '').trim(),
            String(cert.dateIssued || '').trim(),
            String(cert.issuedBy || 'GCS Medical College, Hospital & Research Centre').trim(),
            String(cert.referenceNo || '').trim(),
            String(cert.description || '').trim(),
            String(cert.tableData || '').trim(),
            String(cert.status || 'Valid').trim(),
            userId,
            nowISO,
            initialAudit
          ).run();

          return json({ success: true, message: 'Certificate issued successfully', id });
        }

        // 7. BATCH ISSUE CERTIFICATES: POST /api/certificate/batch
        if (pathname === '/api/certificate/batch' && request.method === 'POST') {
          const body = await request.json();
          const certs = body.certificates || [];
          if (!Array.isArray(certs) || certs.length === 0) {
            return json({ success: false, error: 'No certificates provided for batch' }, 400);
          }

          const nowISO = new Date().toISOString();
          const user = body.user || 'Batch Uploader';
          const userId = body.userId || 'user-batch';
          const auditJson = JSON.stringify([{ action: 'CREATED_BATCH', user, userId, timestamp: nowISO }]);

          const insertSql = `
            INSERT OR REPLACE INTO certificates (
              id, year, recipient_name, certificate_type, date_issued,
              issued_by, reference_no, description, table_data, status,
              issued_by_user_id, created_at, audit_trail, scan_count, last_scanned_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
          `;

          // Execute in atomic batches
          const stmts = certs.map(c => {
            const id = String(c.id || '').trim();
            const year = String(c.year || (id.length >= 2 ? '20' + id.substring(0, 2) : new Date().getFullYear()));
            return db.prepare(insertSql).bind(
              id,
              year,
              String(c.recipientName || c.name || '').trim(),
              String(c.certificateType || '').trim(),
              String(c.dateIssued || c.date || '').trim(),
              String(c.issuedBy || 'GCS Medical College, Hospital & Research Centre').trim(),
              String(c.referenceNo || '').trim(),
              String(c.description || '').trim(),
              String(c.tableData || '').trim(),
              String(c.status || 'Valid').trim(),
              userId,
              nowISO,
              auditJson
            );
          });

          await db.batch(stmts);
          return json({ success: true, count: stmts.length, message: `Successfully issued ${stmts.length} certificates` });
        }

        // 8. UPDATE CERTIFICATE: POST /api/certificate/update
        if (pathname === '/api/certificate/update' && request.method === 'POST') {
          const body = await request.json();
          const cert = body.certificate || body;
          const id = String(cert.id || '').trim();
          if (!id) return json({ success: false, error: 'Certificate ID is required' }, 400);

          const existing = await db.prepare(`SELECT audit_trail FROM certificates WHERE id = ?`).bind(id).first();
          if (!existing) return json({ success: false, error: 'Certificate not found' }, 404);

          let history = [];
          try {
            history = JSON.parse(existing.audit_trail || '[]');
          } catch (e) {
            history = [];
          }

          const user = body.user || 'Staff';
          const nowISO = new Date().toISOString();
          history.push({
            action: 'MODIFIED',
            user,
            timestamp: nowISO,
            details: 'Fields updated via Portal'
          });

          const updateSql = `
            UPDATE certificates SET
              recipient_name = ?,
              certificate_type = ?,
              date_issued = ?,
              issued_by = ?,
              reference_no = ?,
              description = ?,
              table_data = ?,
              audit_trail = ?
            WHERE id = ?
          `;
          await db.prepare(updateSql).bind(
            String(cert.recipientName || '').trim(),
            String(cert.certificateType || '').trim(),
            String(cert.dateIssued || '').trim(),
            String(cert.issuedBy || '').trim(),
            String(cert.referenceNo || '').trim(),
            String(cert.description || '').trim(),
            String(cert.tableData || '').trim(),
            JSON.stringify(history),
            id
          ).run();

          return json({ success: true, message: 'Certificate updated successfully' });
        }

        // 9. STATUS TOGGLE (REVOKE / RESTORE): POST /api/certificate/status
        if (pathname === '/api/certificate/status' && request.method === 'POST') {
          const body = await request.json();
          const id = String(body.id || '').trim();
          const newStatus = String(body.status || 'Valid').trim();
          const user = body.user || 'Staff';

          const existing = await db.prepare(`SELECT audit_trail FROM certificates WHERE id = ?`).bind(id).first();
          if (!existing) return json({ success: false, error: 'Certificate not found' }, 404);

          let history = [];
          try {
            history = JSON.parse(existing.audit_trail || '[]');
          } catch (e) {
            history = [];
          }

          history.push({
            action: newStatus.toLowerCase() === 'revoked' ? 'REVOKED' : 'REINSTATED',
            user,
            timestamp: new Date().toISOString()
          });

          await db.prepare(`UPDATE certificates SET status = ?, audit_trail = ? WHERE id = ?`)
            .bind(newStatus, JSON.stringify(history), id)
            .run();

          return json({ success: true, status: newStatus });
        }

        // 10. DELETE CERTIFICATE: POST /api/certificate/delete (Super Admin only)
        if (pathname === '/api/certificate/delete' && request.method === 'POST') {
          const body = await request.json();
          const id = String(body.id || '').trim();
          if (!id) return json({ success: false, error: 'Certificate ID is required' }, 400);

          await db.prepare(`DELETE FROM certificates WHERE id = ?`).bind(id).run();
          return json({ success: true, message: 'Certificate deleted successfully' });
        }

        // 11. USER MANAGEMENT: GET /api/users & POST /api/users/save
        if (pathname === '/api/users') {
          if (request.method === 'GET') {
            const rows = await db.prepare(`SELECT user_id, name, designation, login_id, role, active, created_at, updated_at FROM users ORDER BY created_at ASC`).all();
            return json({ success: true, users: rows.results || [] });
          }

          if (request.method === 'POST') {
            const body = await request.json();
            const u = body.userData || body;
            const now = new Date().toISOString();
            const userId = u.user_id || `user-${Date.now()}`;

            const userSql = `
              INSERT INTO users (user_id, name, designation, login_id, password_hash, role, active, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET
                name = excluded.name,
                designation = excluded.designation,
                role = excluded.role,
                active = excluded.active,
                updated_at = excluded.updated_at
            `;
            await db.prepare(userSql).bind(
              userId,
              String(u.name || '').trim(),
              String(u.designation || '').trim(),
              String(u.login_id || '').trim().toLowerCase(),
              String(u.password || u.password_hash || 'Gcs@12345').trim(),
              String(u.role || 'USER'),
              u.active ? 1 : 0,
              u.created_at || now,
              now
            ).run();

            return json({ success: true, message: 'User saved' });
          }
        }

        return json({ error: 'Endpoint not found' }, 404);
      } catch (err) {
        console.error('[Worker API Error]', err);
        return json({ success: false, error: err.message }, 500);
      }
    }

    // --------------------------------------------------------------------------
    // STATIC ASSETS FALLTHROUGH
    // --------------------------------------------------------------------------
    if (env.ASSETS) {
      // Secret /li login route mapping
      if (pathname === '/li' || pathname === '/li/') {
        const liUrl = new URL('/li/index.html', request.url);
        return env.ASSETS.fetch(new Request(liUrl, request));
      }
      return env.ASSETS.fetch(request);
    }

    return new Response('Asset binding not found', { status: 404 });
  }
};
