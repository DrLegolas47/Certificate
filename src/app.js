/**
 * GCS Certificate Verification & Issuance Portal - Main Application Orchestrator
 * Developed for GCS Medical College, Hospital & Research Centre / GCS Foundation
 */

import { api, initApi } from './api.js';
import { auth } from './auth.js';
import { qrEngine } from './qr.js';
import { tableEngine } from './table_engine.js';
import { ROLES, CERTIFICATE_TYPES } from './config.js';
import { APPS_SCRIPT_CODE } from './appscript_code.js';

const root = document.querySelector('#app');
let activeTab = 'single';
let currentConfig = null;
let currentYear = String(new Date().getFullYear());
let registrySort = { field: 'createdAt', order: 'desc' };

/**
 * Toast Notification Helper
 */
function showToast(message, duration = 3500) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * HTML Escape Helper
 */
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[m]));

/**
 * Format YYYY-MM-DD to "DD MMMM YYYY"
 */
function formatDateToStandard(dateStr) {
  if (!dateStr) return '';
  if (/^\d{1,2}\s+[a-zA-Z]+\s+\d{4}$/.test(dateStr.trim())) return dateStr.trim();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

/**
 * Format standard date to YYYY-MM-DD for <input type="date">
 */
function formatDateToPicker(dateStr) {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
  return d.toISOString().split('T')[0];
}

/**
 * Router - Dispatches view based on URL params and session state
 */
export async function initApp() {
  const urlParams = new URLSearchParams(window.location.search);
  const certId = urlParams.get('id');

  // Check login route: path ending in /li or query param li, login
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  const isLoginRoute = path.endsWith('/li') || urlParams.has('li') || urlParams.get('login') === 'true' || urlParams.has('login');

  await initApi();
  currentConfig = await api.getConfig();

  // 1. Direct Public Verification Link (?id=...)
  if (certId) {
    renderPublicVerification(certId);
    return;
  }

  // 2. Check existing authenticated session
  const session = api.getSession();
  if (session && session.user) {
    renderDashboard(session);
    return;
  }

  // 3. Secret Staff Login Route (/li or ?li)
  if (isLoginRoute) {
    auth.renderLoginScreen(root, () => {
      const cleanPath = window.location.pathname.replace(/\/li\/?$/, '/') || '/';
      window.history.pushState({}, '', cleanPath);
      initApp();
    });
    return;
  }

  // 4. Public Gateway without ?id= (Official Institutional Overview & Authenticity)
  renderPublicGateway();
}

/**
 * ==============================================================================
 * 1. PUBLIC VERIFICATION VIEW (?id=...)
 * ==============================================================================
 */
async function renderPublicVerification(id) {
  const brand = currentConfig.HEADER_BRANDING || 'GCS Foundation';
  const subBrand = (currentConfig.SUB_BRANDING && currentConfig.SUB_BRANDING !== 'Institute of GCS Foundation')
    ? currentConfig.SUB_BRANDING
    : 'Certificate Verification Portal';
  const email = currentConfig.CONTACT_EMAIL || 'info@gcsmc.org';

  root.innerHTML = `
    <div class="verify-shell">
      <div class="verify-header">
        <img src="./assets/gcs_foundation_logo.png" alt="GCS Foundation Logo" style="height: 58px; margin-bottom: 8px;">
        <h1 style="font-size: 20px; margin-bottom: 2px;">${esc(brand)}</h1>
        <p class="mono" style="font-size: 11px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase;">
          ${esc(subBrand)}
        </p>
      </div>

      <main class="verify-card" id="verify-card">
        <div class="verify-seal unknown" id="verify-seal">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/></svg>
        </div>
        <h2 id="verify-status-title" style="text-align: center; font-size: 18px; margin-bottom: 4px;">Checking Official Record...</h2>
        <p id="verify-status-desc" style="text-align: center; font-size: 13px; color: var(--muted); margin-bottom: 20px;">
          Validating credential against the institutional registry.
        </p>
        <div id="verify-details-holder"></div>
      </main>

      <footer style="max-width: 500px; margin-top: 24px; text-align: center; font-size: 11px; color: var(--muted); line-height: 1.6;">
        This verification service confirms whether the credential corresponds to an authentic record maintained by ${esc(brand)}.<br>
        For inquiries regarding this certificate, contact <a href="mailto:${esc(email)}" style="color: var(--brand); font-weight: 600;">${esc(email)}</a> referencing the Certificate ID.
      </footer>
    </div>
  `;

  const seal = root.querySelector('#verify-seal');
  const title = root.querySelector('#verify-status-title');
  const desc = root.querySelector('#verify-status-desc');
  const details = root.querySelector('#verify-details-holder');

  const record = await api.verifyCertificate(id);

  if (!record || !record.found) {
    seal.className = 'verify-seal unknown';
    seal.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
    title.textContent = 'Certificate Not Found';
    desc.textContent = 'No certificate matching this ID was found in the official institutional register. Please verify the QR code on the original certificate.';
    return;
  }

  const isRevoked = String(record.status || '').toLowerCase() === 'revoked';

  seal.className = `verify-seal ${isRevoked ? 'revoked' : 'valid'}`;
  seal.innerHTML = isRevoked
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6 9 17l-5-5"/></svg>`;

  title.textContent = isRevoked ? 'Certificate Revoked / Suspended' : 'Officially Verified Certificate';
  desc.textContent = isRevoked
    ? 'This certificate was located in the official registry, but its status has been marked as REVOKED by the issuing authority.'
    : `This certificate is authentic and matches the verified register maintained by ${esc(record.branding?.headerBranding || brand)}.`;

  // Render non-empty fields only (Dynamic Blank Suppression)
  let fieldsHtml = `
    <div style="border-top: 1px solid var(--line-light); margin-top: 18px; padding-top: 12px;">
      <div class="verify-field">
        <div class="verify-label">Recipient Name</div>
        <div class="verify-value" style="font-size: 17px; color: var(--brand);">${esc(record.recipientName || record.name)}</div>
      </div>
      <div class="verify-field">
        <div class="verify-label">Certificate Type</div>
        <div class="verify-value">${esc(record.certificateType)}</div>
      </div>
      <div class="verify-field">
        <div class="verify-label">Issued By</div>
        <div class="verify-value">${esc(record.issuedBy || 'GCS Foundation')}</div>
      </div>
      <div class="verify-field">
        <div class="verify-label">Date Issued</div>
        <div class="verify-value">${esc(record.dateIssued)}</div>
      </div>
  `;

  if (record.referenceNo) {
    fieldsHtml += `
      <div class="verify-field">
        <div class="verify-label">Outward / Reference No</div>
        <div class="verify-value mono">${esc(record.referenceNo)}</div>
      </div>
    `;
  }

  if (record.description) {
    fieldsHtml += `
      <div class="verify-field">
        <div class="verify-label">Description / Remarks</div>
        <div class="verify-value" style="font-size: 13.5px; color: var(--ink-secondary);">${esc(record.description)}</div>
      </div>
    `;
  }

  // Render Complex Tabular Data if present
  if (record.tableData) {
    fieldsHtml += tableEngine.renderHtml(record.tableData);
  }

  fieldsHtml += `
      <div class="neu-panel" style="display: flex; align-items: center; justify-content: space-between; margin-top: 18px;">
        <div>
          <div class="verify-label" style="margin-bottom: 2px;">Official Registry Status</div>
          <div style="font-size: 12px; color: var(--muted);">Validated against primary institutional ledger</div>
        </div>
        <span class="badge ${isRevoked ? 'revoked' : 'valid'}">
          ${isRevoked ? 'Not Valid / Revoked' : 'Official Record: Valid'}
        </span>
      </div>

      <div class="verify-id-box">
        <strong>CERTIFICATE ID:</strong> &nbsp;${esc(record.id)}
      </div>
    </div>
  `;

  details.innerHTML = fieldsHtml;
}

/**
 * ==============================================================================
 * 2. PUBLIC GATEWAY VIEW (When visited without ?id= and not logged in)
 * ==============================================================================
 */
function renderPublicGateway() {
  const brand = currentConfig.HEADER_BRANDING || 'GCS Foundation';

  root.innerHTML = `
    <div class="verify-shell" style="max-width: 780px; margin: 0 auto; padding: 42px 18px;">
      <div class="verify-header">
        <img src="./assets/gcs_foundation_logo.png" alt="GCS Foundation Logo" style="height: 66px; margin-bottom: 14px;">
        <h1 style="font-size: 24px; font-weight: 800; color: var(--brand); margin-bottom: 6px; letter-spacing: -0.02em;">
          Certificate Verification Portal
        </h1>
        <p class="mono" style="font-size: 12px; color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600;">
          Institutes of GCS Foundation
        </p>
      </div>

      <div class="verify-card" style="max-width: 100%; padding: 36px 30px;">
        <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 22px;">
          <div class="verify-seal valid" style="width: 64px; height: 64px; margin: 0; box-shadow: var(--neu-drop-sm);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width: 32px; height: 32px;">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
        </div>

        <h2 style="font-size: 20px; font-weight: 750; text-align: center; color: var(--ink); margin-bottom: 12px;">
          Official Credential Registry &amp; Authenticity Gateway
        </h2>
        <p style="text-align: center; font-size: 14px; color: var(--ink-secondary); line-height: 1.65; max-width: 620px; margin: 0 auto 28px;">
          This portal serves as the centralized official verification service for academic degrees, internship completion certificates, clinical CME programs, and professional qualifications issued across the educational and healthcare institutes under <strong>${esc(brand)}</strong>.
        </p>

        <!-- 3-Step Verification Guide -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px;">
          <div class="neu-panel" style="text-align: center; padding: 20px 14px;">
            <div style="font-size: 26px; margin-bottom: 10px;">📱</div>
            <div style="font-weight: 700; font-size: 13.5px; color: var(--brand); margin-bottom: 6px;">1. Scan Document QR</div>
            <div style="font-size: 12px; color: var(--muted); line-height: 1.55;">
              Every authentic certificate issued by GCS Foundation bears a tamper-evident, encrypted QR code printed on the physical or digital document.
            </div>
          </div>

          <div class="neu-panel" style="text-align: center; padding: 20px 14px;">
            <div style="font-size: 26px; margin-bottom: 10px;">🔒</div>
            <div style="font-weight: 700; font-size: 13.5px; color: var(--brand); margin-bottom: 6px;">2. Direct Registry Query</div>
            <div style="font-size: 12px; color: var(--muted); line-height: 1.55;">
              Scanning directs your mobile camera directly to the secure verification gateway, querying the institutional registrar records in real-time.
            </div>
          </div>

          <div class="neu-panel" style="text-align: center; padding: 20px 14px;">
            <div style="font-size: 26px; margin-bottom: 10px;">✓</div>
            <div style="font-weight: 700; font-size: 13.5px; color: var(--brand); margin-bottom: 6px;">3. Instant Validation</div>
            <div style="font-size: 12px; color: var(--muted); line-height: 1.55;">
              Recipient name, qualification title, issue date, and certificate validity status are displayed with institutional authentication seals.
            </div>
          </div>
        </div>

        <!-- Security & Privacy Guarantee -->
        <div class="neu-panel" style="background: rgba(26, 54, 93, 0.03); border-left: 4px solid var(--brand); padding: 18px 20px; font-size: 13px; color: var(--ink-secondary); line-height: 1.6; margin-bottom: 24px;">
          <div style="font-weight: 700; color: var(--brand); margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
            🛡️ Anti-Fraud &amp; Candidate Privacy Policy
          </div>
          To prevent unauthorized recipient data scraping and protect candidate privacy under institutional confidentiality guidelines, open manual keyword searching is restricted. Public verification is strictly document-bound via physical QR code validation.
        </div>

        <!-- Institutional Scope -->
        <div style="text-align: center; font-size: 13px; color: var(--muted); border-top: 1px solid var(--line-light); padding-top: 20px; line-height: 1.8;">
          <strong>Constituent Institutes:</strong><br>
          GCS Medical College • GCS School &amp; College of Nursing • GCS Physiotherapy College
        </div>
      </div>

      <footer style="max-width: 620px; margin: 24px auto 0; text-align: center; font-size: 12px; color: var(--muted); line-height: 1.75;">
        <div style="margin-bottom: 6px;">
          Official Website: <a href="https://gcsmc.org" target="_blank" rel="noopener noreferrer" style="color: var(--brand); font-weight: 700; text-decoration: none;">gcsmc.org</a>
        </div>
        For third-party verification inquiries, embassies, employers, or credential checks, contact the Registrar Office at <a href="mailto:${esc(currentConfig.CONTACT_EMAIL || 'info@gcsmc.org')}" style="color: var(--brand); font-weight: 600; text-decoration: none;">${esc(currentConfig.CONTACT_EMAIL || 'info@gcsmc.org')}</a> referencing the Certificate ID.
      </footer>
    </div>
  `;
}

/**
 * ==============================================================================
 * 3. AUTHENTICATED PORTAL DASHBOARD (Super Admin, Admin, User)
 * ==============================================================================
 */
function renderDashboard(session) {
  const brand = currentConfig.HEADER_BRANDING || 'GCS Foundation';
  const user = session.user;
  const isSuperAdmin = user.role === ROLES.SUPER_ADMIN;
  const isAdmin = user.role === ROLES.ADMIN || isSuperAdmin;

  root.innerHTML = `
    <header class="top-nav">
      <div class="nav-brand">
        <img src="./assets/gcs_foundation_logo.png" alt="GCS Foundation Logo" class="nav-logo">
        <div class="brand-text-wrap">
          <span class="brand-title" id="nav-brand-title">${esc(brand)}</span>
          <span class="brand-sub">Certificate Issuance &amp; Verification</span>
        </div>
      </div>

      <!-- Staff Manual ID Search Box -->
      <div class="nav-search-wrap">
        <input type="text" id="staff-search-input" placeholder="Search Certificate ID or Name..." style="padding: 8px 14px; font-size: 13px;">
        <button type="button" class="btn sm" id="btn-staff-search">Search</button>
      </div>

      <div class="nav-actions">
        <div style="display: flex; flex-direction: column; align-items: flex-end;">
          <span style="font-weight: 700; font-size: 13px; color: var(--brand);">${esc(user.name)}</span>
          <span class="badge ${isSuperAdmin ? 'role-super' : (isAdmin ? 'role-admin' : 'role-user')}">
            ${esc(user.role)}
          </span>
        </div>
        <button type="button" class="btn sm danger" id="btn-logout" title="Sign Out">Sign Out</button>
      </div>
    </header>

    <main style="max-width: 1100px; margin: 28px auto; padding: 0 18px;">
      <!-- Navigation Tabs -->
      <nav class="nav-tabs">
        <button type="button" class="nav-tab-btn ${activeTab === 'single' ? 'active' : ''}" data-tab="single">
          Issue Single Certificate
        </button>
        <button type="button" class="nav-tab-btn ${activeTab === 'bulk' ? 'active' : ''}" data-tab="bulk">
          Bulk CSV Issuance (150+ Records)
        </button>
        <button type="button" class="nav-tab-btn ${activeTab === 'registry' ? 'active' : ''}" data-tab="registry">
          Certificate Registry
        </button>
        ${isSuperAdmin ? `
          <button type="button" class="nav-tab-btn ${activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
            System Settings &amp; Users
          </button>
        ` : ''}
      </nav>

      <!-- Active Tab Container -->
      <section id="tab-content"></section>
    </main>

    <div id="modal-container"></div>
  `;

  // Top Nav Events
  root.querySelector('#btn-logout').addEventListener('click', () => {
    api.logout();
    const cleanPath = window.location.pathname.replace(/\/li\/?$/, '/') || '/';
    window.history.pushState({}, '', cleanPath);
    initApp();
  });

  const searchInput = root.querySelector('#staff-search-input');
  const searchBtn = root.querySelector('#btn-staff-search');
  const handleStaffSearch = async () => {
    const q = searchInput.value.trim();
    if (!q) return;
    const results = await api.searchCertificates(q);
    openSearchResultsModal(q, results);
  };
  searchBtn.addEventListener('click', handleStaffSearch);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleStaffSearch();
  });

  // Tab switching
  root.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.getAttribute('data-tab');
      renderDashboard(session);
    });
  });

  const tabContainer = root.querySelector('#tab-content');
  if (activeTab === 'single') renderSingleIssueTab(tabContainer, session);
  else if (activeTab === 'bulk') renderBulkIssueTab(tabContainer, session);
  else if (activeTab === 'registry') renderRegistryTab(tabContainer, session);
  else if (activeTab === 'settings' && isSuperAdmin) renderSettingsTab(tabContainer, session);
}

/**
 * ==============================================================================
 * TAB 1: SINGLE CERTIFICATE ISSUANCE & QR GENERATOR
 * ==============================================================================
 */
function renderSingleIssueTab(container, session) {
  let generatedId = qrEngine.generateId(currentYear);
  const todayYMD = new Date().toISOString().split('T')[0];

  container.innerHTML = `
    <div class="neu-card">
      <h2>Issue Single Certificate</h2>
      <p>Enter certificate details to immediately generate an official 14-character ID and copyable QR code.</p>

      <form id="single-cert-form" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; margin-top: 18px;">
        <label>
          Issue Year
          <select name="issueYear" id="select-issue-year">
            <option value="2026" ${currentYear === '2026' ? 'selected' : ''}>2026 (Sheet 2026, Prefix 26)</option>
            <option value="2027" ${currentYear === '2027' ? 'selected' : ''}>2027 (Sheet 2027, Prefix 27)</option>
            <option value="2028" ${currentYear === '2028' ? 'selected' : ''}>2028 (Sheet 2028, Prefix 28)</option>
          </select>
        </label>

        <label>
          Auto-Generated Certificate ID (14 Chars)
          <div style="display: flex; gap: 8px;">
            <input type="text" name="certId" id="cert-id-input" value="${generatedId}" readonly class="mono" style="font-weight: 700;">
            <button type="button" class="btn sm" id="btn-regen-id" title="Regenerate unique ID">↻ New</button>
          </div>
        </label>

        <label style="grid-column: 1 / -1;">
          Recipient Name (with Title) *
          <input type="text" name="recipientName" required placeholder="e.g. Dr. Jaydeep Ghevariya">
        </label>

        <!-- Certificate Type with Select Dropdown + Custom Open Typing -->
        <label>
          Certificate Type (Select or Type Custom) *
          <input list="cert-types-list" name="certificateType" id="cert-type-input" required placeholder="Select or type custom type..." autocomplete="off">
          <datalist id="cert-types-list">
            ${CERTIFICATE_TYPES.map(t => `<option value="${esc(t)}"></option>`).join('')}
          </datalist>
        </label>

        <!-- Date Selection Option Required -->
        <label>
          Date Issued *
          <input type="date" name="dateIssuedPicker" id="date-issued-picker" required value="${todayYMD}">
        </label>

        <label>
          Issued By (Department / Institution)
          <input type="text" name="issuedBy" value="${esc(currentConfig.HEADER_BRANDING || 'GCS Foundation')}">
        </label>

        <label>
          Reference / Registration No (Optional)
          <input type="text" name="referenceNo" placeholder="e.g. GMC/36401 or GCSMC/INT/2026/101">
        </label>

        <label style="grid-column: 1 / -1;">
          Description / Narrative (Optional)
          <textarea name="description" rows="2" placeholder="Brief remarks or award description (leave blank if not needed)"></textarea>
        </label>

        <!-- Complex Tabular Data Option B -->
        <div style="grid-column: 1 / -1;" class="neu-panel">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-weight: 700; color: var(--brand);">Complex Tabular Schedule / Postings (Optional)</span>
            <button type="button" class="btn sm" id="btn-insert-sample-table">Insert Sample Posting Schedule</button>
          </div>
          <p style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">
            Formatted as Option B: <code>Department|From Date|To Date|Status; Medicine|01/01/2026|31/01/2026|Completed; ...</code>
          </p>
          <textarea name="tableData" id="table-data-input" rows="3" placeholder="Leave empty if this certificate has no tabular records"></textarea>
        </div>

        <div style="grid-column: 1 / -1; margin-top: 10px;">
          <button type="submit" class="btn primary" style="padding: 12px 28px; width: 100%;">
            Issue Certificate &amp; Generate QR Code
          </button>
        </div>
      </form>
    </div>

    <!-- QR Output Container -->
    <div id="single-qr-result" style="display: none;"></div>
  `;

  const form = container.querySelector('#single-cert-form');
  const yearSelect = container.querySelector('#select-issue-year');
  const idInput = container.querySelector('#cert-id-input');
  const regenBtn = container.querySelector('#btn-regen-id');
  const sampleTableBtn = container.querySelector('#btn-insert-sample-table');
  const qrResultBox = container.querySelector('#single-qr-result');

  yearSelect.addEventListener('change', () => {
    currentYear = yearSelect.value;
    generatedId = qrEngine.generateId(currentYear);
    idInput.value = generatedId;
  });

  regenBtn.addEventListener('click', () => {
    generatedId = qrEngine.generateId(currentYear);
    idInput.value = generatedId;
  });

  sampleTableBtn.addEventListener('click', () => {
    container.querySelector('#table-data-input').value =
      'Department | From Date | To Date | Status ; ' +
      'General Medicine | 01/01/2026 | 31/01/2026 | Completed ; ' +
      'General Surgery | 01/02/2026 | 28/02/2026 | Completed ; ' +
      'Obstetrics & Gynaecology | 01/03/2026 | 28/03/2026 | Completed ; ' +
      'Paediatrics | 29/03/2026 | 25/04/2026 | Completed';
    showToast('Sample posting schedule inserted.');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const datePickerVal = formData.get('dateIssuedPicker');
    const formattedDate = formatDateToStandard(datePickerVal);

    const cert = {
      id: idInput.value.trim(),
      recipientName: formData.get('recipientName').trim(),
      certificateType: formData.get('certificateType').trim(),
      dateIssued: formattedDate,
      issuedBy: formData.get('issuedBy').trim(),
      referenceNo: formData.get('referenceNo').trim(),
      description: formData.get('description').trim(),
      tableData: tableEngine.stringifyForStorage(formData.get('tableData'))
    };

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving certificate into registry...';

    try {
      await api.issueCertificate(cert);
      showToast('Certificate successfully issued!');

      // Render QR Code Canvas
      const prefixUrl = currentConfig.PREFIX_URL || (window.location.origin + window.location.pathname + '?id=');
      const verifyUrl = `${prefixUrl}${encodeURIComponent(cert.id)}`;
      const canvas = await qrEngine.renderQrCanvas(verifyUrl, cert.id);

      qrResultBox.style.display = 'block';
      qrResultBox.innerHTML = `
        <div class="neu-card qr-preview-box">
          <h3 style="color: var(--success); margin-bottom: 6px;">✓ Certificate Created Successfully</h3>
          <p style="font-size: 13px; margin-bottom: 16px;">
            Copy this QR image directly to paste into Microsoft Word or download as PNG.
          </p>

          <div class="qr-canvas-holder" id="canvas-placeholder"></div>

          <div class="qr-actions">
            <button type="button" class="btn primary" id="btn-copy-qr">
              📋 Copy QR Image (Paste in Word)
            </button>
            <button type="button" class="btn" id="btn-download-qr">
              💾 Download PNG
            </button>
            <a href="${verifyUrl}" target="_blank" class="btn" style="text-decoration: none;">
              ↗ Open Verification Page
            </a>
          </div>

          <div style="margin-top: 16px; font-size: 12px; color: var(--muted); text-align: center;" class="mono">
            Direct Link: ${verifyUrl}
          </div>
        </div>
      `;

      qrResultBox.querySelector('#canvas-placeholder').appendChild(canvas);

      qrResultBox.querySelector('#btn-copy-qr').addEventListener('click', async () => {
        const res = await qrEngine.copyToClipboard(canvas);
        showToast(res.message);
      });

      qrResultBox.querySelector('#btn-download-qr').addEventListener('click', () => {
        qrEngine.downloadCanvas(canvas, `${cert.id}_${cert.recipientName.replace(/\s+/g, '_')}_QR.png`);
      });

      // Prepare new ID for next issuance
      generatedId = qrEngine.generateId(currentYear);
      idInput.value = generatedId;
      qrResultBox.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      alert('Error saving certificate: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Issue Certificate & Generate QR Code';
    }
  });
}

/**
 * ==============================================================================
 * TAB 2: BULK CSV ISSUANCE (150+ RECORDS WITH OPTION B TABLES)
 * ==============================================================================
 */
function renderBulkIssueTab(container, session) {
  container.innerHTML = `
    <div class="neu-card">
      <h2>Bulk CSV Certificate Issuance</h2>
      <p>Issue up to 150+ certificates in one batch. Download the template, fill details, and upload to receive a ZIP package of all generated QR codes plus a mapped index file.</p>

      <div style="display: flex; gap: 12px; margin: 20px 0; flex-wrap: wrap;">
        <button type="button" class="btn primary" id="btn-download-csv-template">
          📥 1. Download CSV Template (with Option B Table Support)
        </button>
      </div>

      <div class="neu-panel" style="margin-bottom: 24px;">
        <label style="margin-bottom: 0;">
          <strong>2. Upload Filled CSV File</strong>
          <input type="file" id="bulk-csv-file" accept=".csv" style="margin-top: 8px;">
        </label>
      </div>

      <div id="bulk-preview-area" style="display: none;"></div>
      <div id="bulk-progress-area" style="display: none;"></div>
    </div>
  `;

  const templateBtn = container.querySelector('#btn-download-csv-template');
  const fileInput = container.querySelector('#bulk-csv-file');
  const previewArea = container.querySelector('#bulk-preview-area');
  const progressArea = container.querySelector('#bulk-progress-area');

  templateBtn.addEventListener('click', () => {
    downloadSampleCsv();
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const text = await file.text();
    const rows = parseCsvText(text);

    if (rows.length === 0) {
      alert('The uploaded CSV file is empty or formatted incorrectly.');
      return;
    }

    const batchYear = currentYear;
    const certificates = rows.map(r => ({
      id: qrEngine.generateId(batchYear),
      recipientName: r.RecipientName || '',
      certificateType: r.CertificateType || 'Certificate of Completion',
      dateIssued: r.DateIssued || new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()),
      issuedBy: r.IssuedBy || currentConfig.HEADER_BRANDING || 'GCS Foundation',
      referenceNo: r.ReferenceNo || '',
      description: r.Description || '',
      tableData: tableEngine.stringifyForStorage(r.TableData || ''),
      status: 'Valid'
    }));

    previewArea.style.display = 'block';
    previewArea.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <h3 style="margin-bottom: 0;">Verified ${certificates.length} Records Ready for Issuance</h3>
        <button type="button" class="btn primary" id="btn-confirm-bulk-issue" style="padding: 10px 22px;">
          ⚡ Issue All ${certificates.length} Records &amp; Generate QR ZIP
        </button>
      </div>

      <div class="neu-table-wrap" style="max-height: 380px; overflow-y: auto;">
        <table class="neu-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Generated ID</th>
              <th>Recipient Name</th>
              <th>Type</th>
              <th>Date</th>
              <th>Table Data</th>
            </tr>
          </thead>
          <tbody>
            ${certificates.slice(0, 50).map((c, i) => `
              <tr>
                <td>${i + 1}</td>
                <td class="mono"><strong>${esc(c.id)}</strong></td>
                <td>${esc(c.recipientName)}</td>
                <td>${esc(c.certificateType)}</td>
                <td>${esc(c.dateIssued)}</td>
                <td>${c.tableData ? '<span class="badge valid">Has Table</span>' : '<span style="color: var(--muted);">-</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${certificates.length > 50 ? `<p style="font-size: 12px; color: var(--muted); margin-top: 8px;">Showing first 50 of ${certificates.length} records in preview.</p>` : ''}
    `;

    previewArea.querySelector('#btn-confirm-bulk-issue').addEventListener('click', async () => {
      const confirmBtn = previewArea.querySelector('#btn-confirm-bulk-issue');
      confirmBtn.disabled = true;

      progressArea.style.display = 'block';
      progressArea.innerHTML = `
        <div class="neu-panel" style="margin-top: 20px; text-align: center;">
          <h4 id="progress-text" style="color: var(--brand);">Processing Batch Issuance...</h4>
          <div style="background: var(--line); border-radius: 10px; height: 12px; overflow: hidden; margin: 12px 0;">
            <div id="progress-bar-fill" style="background: var(--brand); width: 0%; height: 100%; transition: width 0.15s ease;"></div>
          </div>
          <p id="progress-sub" style="font-size: 12px; color: var(--muted);">Saving rows to registry and compiling high-resolution QR codes...</p>
        </div>
      `;

      const progressText = progressArea.querySelector('#progress-text');
      const progressFill = progressArea.querySelector('#progress-bar-fill');

      try {
        progressText.textContent = 'Writing records into registry...';
        await api.batchIssue(certificates);

        const prefixUrl = currentConfig.PREFIX_URL || (window.location.origin + window.location.pathname + '?id=');
        await qrEngine.packageBatchZip(certificates, prefixUrl, (current, total) => {
          const pct = Math.round((current / total) * 100);
          progressText.textContent = `Generating QR Codes: ${current} of ${total} (${pct}%)`;
          progressFill.style.width = `${pct}%`;
        });

        progressText.textContent = `✓ Successfully Issued and Packaged ${certificates.length} Certificates!`;
        progressArea.querySelector('#progress-sub').textContent = 'Your ZIP archive and mapping index file have been downloaded to your computer.';
        showToast(`Batch of ${certificates.length} certificates issued successfully!`);
      } catch (err) {
        alert('Batch issue error: ' + err.message);
      } finally {
        confirmBtn.disabled = false;
      }
    });
  });
}

function downloadSampleCsv() {
  const headers = ['RecipientName', 'CertificateType', 'DateIssued', 'IssuedBy', 'ReferenceNo', 'Description', 'TableData'];
  const sampleRows = [
    [
      'Dr. Jaydeep Ghevariya',
      'Internship Completion Certificate',
      '12 December 2026',
      'GCS Foundation',
      'GCSMC/INT/2026/01',
      'Compulsory Rotating Medical Internship completed satisfactorily.',
      'Department | From Date | To Date | Status ; Medicine | 01/01/2026 | 31/01/2026 | Completed ; Surgery | 01/02/2026 | 28/02/2026 | Completed ; OBGY | 01/03/2026 | 28/03/2026 | Completed ; Paediatrics | 29/03/2026 | 25/04/2026 | Completed'
    ],
    [
      'Dr. Priya Shah',
      'Certificate of Participation',
      '14 August 2026',
      'GCS Foundation',
      'GCSMC/CME/2026/88',
      'Attended National Conference on Medical Education',
      ''
    ]
  ];

  const csvStr = [
    headers.join(','),
    ...sampleRows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
  ].join('\r\n');

  const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'GCS_Certificate_Bulk_Template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  const parseLine = line => {
    const result = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuote && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        result.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    result.push(entry.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const rowObj = {};
    headers.forEach((h, idx) => {
      rowObj[h] = values[idx] || '';
    });
    if (rowObj.RecipientName) {
      rows.push(rowObj);
    }
  }

  return rows;
}

/**
 * ==============================================================================
 * TAB 3: CERTIFICATE REGISTRY & LIFECYCLE MANAGEMENT (WITH SORTING & ISSUED BY)
 * ==============================================================================
 */
async function renderRegistryTab(container, session) {
  const isSuperOrAdmin = session.user.role === ROLES.SUPER_ADMIN || session.user.role === ROLES.ADMIN;
  const pageSize = isSuperOrAdmin ? 10 : 20;
  const roleLabel = isSuperOrAdmin ? '10 records / page (All Users)' : '20 records / page (My Records)';
  let currentPage = 1;

  container.innerHTML = `
    <div class="neu-card">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 16px;">
        <div>
          <h2>Certificate Registry</h2>
          <p style="margin-bottom: 0;">Browse, sort, edit details, or toggle validation status (Revoke / Reinstate).</p>
          <span style="display: inline-block; font-size: 11px; color: var(--brand); background: rgba(0,102,153,0.08); padding: 2px 8px; border-radius: 4px; margin-top: 6px; font-weight: 600;">
            ⚡ D1 Edge Mode: ${roleLabel}
          </span>
        </div>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <label style="margin-bottom: 0; display: inline-flex; flex-direction: row; align-items: center; gap: 6px;">
            <span style="font-size: 12px; color: var(--muted);">Sort By:</span>
            <select id="registry-sort-select" style="width: auto; padding: 6px 10px; font-size: 12px;">
              <option value="createdAt_desc">Date Issued (Newest First)</option>
              <option value="createdAt_asc">Date Issued (Oldest First)</option>
              <option value="recipientName_asc">Recipient Name (A to Z)</option>
              <option value="recipientName_desc">Recipient Name (Z to A)</option>
              <option value="issuedBy_asc">Issued By (A to Z)</option>
              <option value="id_asc">Certificate ID</option>
            </select>
          </label>
          <select id="registry-year-filter" style="width: auto; padding: 6px 10px; font-size: 12px;">
            <option value="2026" ${currentYear === '2026' ? 'selected' : ''}>Year 2026</option>
            <option value="2027" ${currentYear === '2027' ? 'selected' : ''}>Year 2027</option>
            <option value="2028" ${currentYear === '2028' ? 'selected' : ''}>Year 2028</option>
            <option value="ALL">All Years</option>
          </select>
          <button type="button" class="btn sm" id="btn-refresh-registry">↻ Refresh</button>
        </div>
      </div>

      <div id="registry-table-holder">
        <p style="color: var(--muted);">Loading records...</p>
      </div>

      <!-- Pagination Footer -->
      <div id="registry-pagination-holder" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border);"></div>
    </div>
  `;

  const yearSelect = container.querySelector('#registry-year-filter');
  const sortSelect = container.querySelector('#registry-sort-select');
  const refreshBtn = container.querySelector('#btn-refresh-registry');
  const tableHolder = container.querySelector('#registry-table-holder');
  const paginationHolder = container.querySelector('#registry-pagination-holder');

  const loadData = async (targetPage = 1) => {
    currentPage = targetPage;
    tableHolder.innerHTML = '<p style="color: var(--muted);">Loading records from Cloudflare D1...</p>';
    paginationHolder.innerHTML = '';

    const res = await api.listCertificates(yearSelect.value, currentPage);
    const list = res.certificates || [];
    const pagination = res.pagination || { page: 1, limit: pageSize, total: list.length, totalPages: 1 };

    if (!list || list.length === 0) {
      tableHolder.innerHTML = `
        <div class="neu-panel" style="text-align: center; color: var(--muted); padding: 30px;">
          No certificates found for year ${yearSelect.value} (Page ${currentPage}).
        </div>
      `;
      return;
    }

    // Apply Client Sorting to current page slice
    const [field, order] = sortSelect.value.split('_');
    list.sort((a, b) => {
      let valA = String(a[field] || '').toLowerCase();
      let valB = String(b[field] || '').toLowerCase();
      if (field === 'dateIssued' || field === 'createdAt') {
        const dA = new Date(a[field] || a.dateIssued || 0).getTime();
        const dB = new Date(b[field] || b.dateIssued || 0).getTime();
        return order === 'asc' ? dA - dB : dB - dA;
      }
      return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });

    tableHolder.innerHTML = `
      <div class="neu-table-wrap">
        <table class="neu-table">
          <thead>
            <tr>
              <th style="cursor: pointer;" data-sort="id">Certificate ID ⇕</th>
              <th style="cursor: pointer;" data-sort="recipientName">Recipient Name ⇕</th>
              <th style="cursor: pointer;" data-sort="certificateType">Type ⇕</th>
              <th style="cursor: pointer;" data-sort="dateIssued">Date Issued ⇕</th>
              <th style="cursor: pointer;" data-sort="issuedBy">Issued By ⇕</th>
              <th style="cursor: pointer;" data-sort="status">Status ⇕</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${list.map(c => `
              <tr>
                <td class="mono"><strong>${esc(c.id)}</strong></td>
                <td><strong>${esc(c.recipientName)}</strong></td>
                <td>${esc(c.certificateType)}</td>
                <td>${esc(c.dateIssued)}</td>
                <td>${esc(c.issuedBy || 'GCS Foundation')}</td>
                <td>
                  <span class="badge ${String(c.status).toLowerCase() === 'revoked' ? 'revoked' : 'valid'}">
                    ${esc(c.status || 'Valid')}
                  </span>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                  <button type="button" class="btn sm btn-view-qr" data-id="${esc(c.id)}" title="View QR and Details">QR / Link</button>
                  <button type="button" class="btn sm btn-view-audit" data-id="${esc(c.id)}" title="View Audit Trail">History</button>
                  <button type="button" class="btn sm btn-edit-cert" data-id="${esc(c.id)}" title="Edit Details">Edit</button>
                  <button type="button" class="btn sm ${String(c.status).toLowerCase() === 'revoked' ? 'success' : 'danger'} btn-toggle-status" data-id="${esc(c.id)}" data-status="${esc(c.status || 'Valid')}">
                    ${String(c.status).toLowerCase() === 'revoked' ? 'Reinstate' : 'Revoke'}
                  </button>
                  ${session.user.role === ROLES.SUPER_ADMIN ? `
                    <button type="button" class="btn sm danger btn-delete-cert" data-id="${esc(c.id)}" title="Permanently Delete Certificate" style="background: rgba(180,40,40,0.18); border-color: rgba(220,50,50,0.4);">🗑 Delete</button>
                  ` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Render Pagination Controls
    const startIdx = (pagination.page - 1) * pagination.limit + 1;
    const endIdx = Math.min(pagination.page * pagination.limit, pagination.total);

    paginationHolder.innerHTML = `
      <div style="font-size: 13px; color: var(--muted);">
        Showing <strong>${startIdx}–${endIdx}</strong> of <strong>${pagination.total}</strong> records (Page ${pagination.page} of ${pagination.totalPages})
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button type="button" class="btn sm" id="btn-page-prev" ${pagination.page <= 1 ? 'disabled' : ''}>
          ◀ Prev
        </button>
        <span style="font-size: 12px; font-weight: 600; padding: 0 4px;">
          ${pagination.page} / ${pagination.totalPages}
        </span>
        <button type="button" class="btn sm" id="btn-page-next" ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>
          Next ▶
        </button>
      </div>
    `;

    const prevBtn = paginationHolder.querySelector('#btn-page-prev');
    const nextBtn = paginationHolder.querySelector('#btn-page-next');
    if (prevBtn) prevBtn.addEventListener('click', () => loadData(currentPage - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => loadData(currentPage + 1));

    // Header sort clicks
    tableHolder.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const targetField = th.getAttribute('data-sort');
        const [currField, currOrder] = sortSelect.value.split('_');
        const nextOrder = (currField === targetField && currOrder === 'asc') ? 'desc' : 'asc';
        sortSelect.value = `${targetField}_${nextOrder}`;
        loadData(currentPage);
      });
    });

    // Action: View QR
    tableHolder.querySelectorAll('.btn-view-qr').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const cert = list.find(item => item.id === id);
        if (cert) openQrModal(cert);
      });
    });

    // Action: View Audit History
    tableHolder.querySelectorAll('.btn-view-audit').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const full = await api.getCertificate(id);
        if (full) openAuditModal(full);
        else showToast('Could not load audit history');
      });
    });

    // Action: Edit
    tableHolder.querySelectorAll('.btn-edit-cert').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const full = await api.getCertificate(id);
        if (full) openEditModal(full, () => loadData(currentPage));
        else {
          const cert = list.find(item => item.id === id);
          if (cert) openEditModal(cert, () => loadData(currentPage));
        }
      });
    });

    // Action: Status Toggle
    tableHolder.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const current = btn.getAttribute('data-status');
        const next = String(current).toLowerCase() === 'revoked' ? 'Valid' : 'Revoked';

        if (confirm(`Are you sure you want to change certificate ${id} status to ${next}?`)) {
          btn.disabled = true;
          await api.updateStatus(id, next);
          showToast(`Status updated to ${next}!`);
          loadData(currentPage);
        }
      });
    });

    // Action: Delete (Super Admin only)
    tableHolder.querySelectorAll('.btn-delete-cert').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (confirm(`⚠️ PERMANENTLY DELETE certificate ${id}?\n\nThis action CANNOT be undone. The record will be removed from Cloudflare D1.\n\nType YES in the next prompt to confirm.`)) {
          const confirmation = prompt('Type YES to confirm permanent deletion:');
          if (confirmation && confirmation.trim().toUpperCase() === 'YES') {
            btn.disabled = true;
            btn.textContent = 'Deleting…';
            try {
              await api.deleteCertificate(id);
              showToast(`Certificate ${id} permanently deleted.`);
              loadData(currentPage);
            } catch (err) {
              alert('Delete failed: ' + err.message);
              btn.disabled = false;
              btn.textContent = '🗑 Delete';
            }
          }
        }
      });
    });
  };

  yearSelect.addEventListener('change', () => loadData(1));
  sortSelect.addEventListener('change', () => loadData(1));
  refreshBtn.addEventListener('click', () => loadData(currentPage));
  loadData(1);
}

function openAuditModal(cert) {
  let trail = [];
  try {
    trail = typeof cert.auditTrail === 'string' ? JSON.parse(cert.auditTrail || '[]') : (cert.auditTrail || []);
  } catch (e) {
    trail = [];
  }

  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">Audit History: ${esc(cert.id)}</h3>
      <button type="button" class="btn sm modal-close-btn">✕</button>
    </div>
    <div style="max-height: 400px; overflow-y: auto;">
      <p style="font-size: 13px; color: var(--muted); margin-bottom: 14px;">
        Recipient: <strong>${esc(cert.recipientName)}</strong> | Type: <strong>${esc(cert.certificateType)}</strong>
      </p>
      ${trail.length === 0 ? `
        <p style="color: var(--muted); text-align: center; padding: 20px;">No audit logs recorded for this entry.</p>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 10px;">
          ${trail.map(t => `
            <div style="padding: 10px 14px; background: rgba(0,0,0,0.03); border-left: 3px solid var(--brand); border-radius: 4px;">
              <div style="display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; margin-bottom: 4px;">
                <span class="badge ${t.action === 'REVOKED' ? 'revoked' : 'valid'}">${esc(t.action)}</span>
                <span style="color: var(--muted);">${new Date(t.timestamp).toLocaleString()}</span>
              </div>
              <div style="font-size: 12px; color: var(--text);">
                User: <strong>${esc(t.user || 'Staff')}</strong> ${t.details ? `— ${esc(t.details)}` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
    <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
      <button type="button" class="btn modal-close-btn">Close</button>
    </div>
  `);
}

/**
 * ==============================================================================
 * TAB 4: SYSTEM SETTINGS, USERS & APPS SCRIPT GENERATOR (Super Admin Only)
 * ==============================================================================
 */
async function renderSettingsTab(container, session) {
  const cfg = await api.getConfig();
  const users = await api.getUsers();

  container.innerHTML = `
    <!-- Database Architecture Overview -->
    <div class="neu-card" style="border-left: 4px solid var(--brand);">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="margin-bottom: 4px;">Database Architecture &amp; Mirror Status</h2>
          <p style="margin-bottom: 0;">Cloudflare D1 serves all verification queries instantly at the edge, while Google Sheets acts as a live spreadsheet mirror and backup.</p>
        </div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <span style="font-size: 11px; background: rgba(0, 168, 104, 0.12); color: #00875a; padding: 4px 10px; border-radius: 6px; font-weight: 600;">
            ✓ D1 Primary: Active (certificate_verification)
          </span>
          <span style="font-size: 11px; background: rgba(0, 102, 153, 0.12); color: var(--brand); padding: 4px 10px; border-radius: 6px; font-weight: 600;">
            ⇄ Google Sheets: Live Mirror
          </span>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; margin-top: 18px;">
        <div class="neu-panel" style="padding: 14px;">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">⚡ Cloudflare D1 (Primary Engine)</div>
          <p style="font-size: 12px; color: var(--muted); margin-bottom: 0;">
            Handles public verification in &lt;20ms. Paginated registry (20/page for Users, 10/page for Admins). Single-cell embedded audit trail.
          </p>
        </div>
        <div class="neu-panel" style="padding: 14px;">
          <div style="font-weight: 600; font-size: 13px; margin-bottom: 4px;">📊 Google Sheets (Live Mirror)</div>
          <p style="font-size: 12px; color: var(--muted); margin-bottom: 0;">
            All creations and edits are automatically mirrored to your Google Drive spreadsheet in the background for manual viewing and audits.
          </p>
        </div>
      </div>

      <!-- Two-Way Synchronization Controls -->
      <div style="display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap;">
        <button type="button" class="btn primary sm" id="btn-pull-sheets-to-d1">
          📥 Pull / Sync Google Sheet Records into D1
        </button>
        <button type="button" class="btn sm" id="btn-push-d1-to-sheets">
          ⬆ Push All D1 Records to Google Sheet Mirror
        </button>
        <button type="button" class="btn sm" id="btn-test-script">
          🔌 Test Google Sheet Mirror Connection
        </button>
      </div>
    </div>

    <!-- Institutional Branding & Configuration -->
    <div class="neu-card">
      <h2>System Settings &amp; Institutional Branding</h2>
      <p>Configure dynamic header branding, verification URL prefix, and Google Sheet mirror webhook.</p>

      <form id="settings-form" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-top: 20px;">
        <label style="grid-column: 1 / -1;">
          Header Institutional Branding Title *
          <input type="text" name="HEADER_BRANDING" value="${esc(cfg.HEADER_BRANDING || '')}" required placeholder="e.g. GCS Foundation">
        </label>

        <label style="grid-column: 1 / -1;">
          Sub-Branding / Institutional Tagline
          <input type="text" name="SUB_BRANDING" value="${esc(cfg.SUB_BRANDING || '')}" placeholder="e.g. Institute of GCS Foundation">
        </label>

        <label style="grid-column: 1 / -1;">
          Public Verification Base URL (Prefix URL for QR code encoding) *
          <input type="url" name="PREFIX_URL" value="${esc(cfg.PREFIX_URL || '')}" required placeholder="e.g. https://verify.jaydeep-ghevariya.workers.dev/?id=">
        </label>

        <label>
          Contact Email Address
          <input type="email" name="CONTACT_EMAIL" value="${esc(cfg.CONTACT_EMAIL || '')}">
        </label>

        <label>
          Google Sheet Mirror Web App URL (/exec)
          <input type="url" id="script-url-input" value="${esc(api.getScriptUrl())}" placeholder="Paste Google Apps Script /exec URL here">
        </label>

        <div style="grid-column: 1 / -1; display: flex; gap: 12px; margin-top: 10px; flex-wrap: wrap;">
          <button type="submit" class="btn primary" style="padding: 10px 24px;">Save Settings</button>
        </div>
      </form>
    </div>

    <!-- Google Sheets Master File & Apps Script Mirror Generator -->
    <div class="neu-card">
      <h2>Google Sheets Mirror Backend &amp; Template</h2>
      <p>Download the pre-configured master Google Sheets template or copy the mirror backend Apps Script code.</p>

      <div style="display: flex; gap: 12px; margin: 18px 0; flex-wrap: wrap;">
        <a href="./assets/GCS_Master_Database_Template.xlsx" download="GCS_Master_Database_Template.xlsx" class="btn primary" style="text-decoration: none;">
          📥 Download Master Google Sheets Template (.xlsx)
        </a>
        <button type="button" class="btn" id="btn-copy-appscript">
          📋 Copy Apps Script Code
        </button>
        <button type="button" class="btn" id="btn-download-appscript">
          💾 Download Code.gs
        </button>
      </div>

      <div class="neu-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <strong>Apps Script Source (Code.gs)</strong>
          <span style="font-size: 11px; color: var(--muted);">Extensions > Apps Script in Google Sheets</span>
        </div>
        <textarea id="appscript-viewer" rows="8" readonly class="mono" style="font-size: 11px; background: rgba(0,0,0,0.03);">${esc(APPS_SCRIPT_CODE)}</textarea>
      </div>
    </div>

    <!-- User Management Card -->
    <div class="neu-card">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
        <div>
          <h2>Staff User Management</h2>
          <p style="margin-bottom: 0;">Add and manage authorized staff members (Super Admin, Admin, User).</p>
        </div>
        <button type="button" class="btn primary sm" id="btn-add-user">+ Add New Staff</button>
      </div>

      <div class="neu-table-wrap">
        <table class="neu-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login ID / Email</th>
              <th>Designation</th>
              <th>Role</th>
              <th>Active</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td><strong>${esc(u.name)}</strong></td>
                <td>${esc(u.login_id)}</td>
                <td>${esc(u.designation || '-')}</td>
                <td><span class="badge ${u.role === 'SUPER_ADMIN' ? 'role-super' : 'role-admin'}">${esc(u.role)}</span></td>
                <td>${u.active ? '<span class="badge valid">Active</span>' : '<span class="badge revoked">Inactive</span>'}</td>
                <td>
                  ${u.role !== 'SUPER_ADMIN' ? `
                    <button type="button" class="btn sm ${u.active ? 'danger' : 'success'} btn-toggle-user" data-id="${esc(u.login_id)}" data-active="${u.active}">
                      ${u.active ? 'Deactivate' : 'Activate'}
                    </button>
                  ` : '<span style="color: var(--muted); font-size: 11px;">Protected</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Settings Save
  container.querySelector('#settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newConfig = {
      HEADER_BRANDING: formData.get('HEADER_BRANDING').trim(),
      SUB_BRANDING: formData.get('SUB_BRANDING').trim(),
      PREFIX_URL: formData.get('PREFIX_URL').trim(),
      CONTACT_EMAIL: formData.get('CONTACT_EMAIL').trim()
    };
    const scriptUrl = container.querySelector('#script-url-input').value.trim();
    api.setScriptUrl(scriptUrl);

    await api.saveConfig(newConfig);
    currentConfig = newConfig;
    const navTitleEl = document.querySelector('#nav-brand-title');
    if (navTitleEl) navTitleEl.textContent = newConfig.HEADER_BRANDING;
    showToast('Settings saved successfully!');
  });

  // Test Connection
  container.querySelector('#btn-test-script').addEventListener('click', async () => {
    const scriptUrl = container.querySelector('#script-url-input').value.trim();
    if (!scriptUrl) {
      alert('Please enter a Google Apps Script Web App URL first.');
      return;
    }
    api.setScriptUrl(scriptUrl);
    try {
      const res = await fetch(`${scriptUrl}?action=test`);
      const d = await res.json();
      if (d && d.success) {
        alert('✓ Connection Successful! Backend is operational.');
      } else if (d && d.error === 'No valid ID provided.') {
        alert('⚠️ Warning: Your Google Apps Script is currently running the OLD script (GScript.txt).\n\nPlease open Google Sheets > Extensions > Apps Script, paste the updated code from the generator below, and click Deploy > Manage deployments > Edit > New version!');
      } else {
        alert('Backend responded but returned error: ' + JSON.stringify(d));
      }
    } catch (err) {
      alert('Failed to connect to Google Apps Script URL: ' + err.message);
    }
  });

  // Pull from Google Sheet Mirror into D1
  container.querySelector('#btn-pull-sheets-to-d1')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-pull-sheets-to-d1');
    btn.disabled = true;
    btn.textContent = 'Syncing from Sheets...';
    try {
      const res = await api.syncGoogleSheetToD1();
      alert(`✓ Sync Complete!\nSuccessfully imported ${res.count} certificates from Google Sheet into Cloudflare D1.`);
    } catch (err) {
      alert('Sync failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '📥 Pull / Sync Google Sheet Records into D1';
    }
  });

  // Push all D1 records to Google Sheet Mirror
  container.querySelector('#btn-push-d1-to-sheets')?.addEventListener('click', async () => {
    const btn = container.querySelector('#btn-push-d1-to-sheets');
    btn.disabled = true;
    btn.textContent = 'Pushing to Sheets...';
    try {
      const res = await api.syncD1ToGoogleSheet();
      alert(`✓ Mirror Push Complete!\nSuccessfully mirrored ${res.count} D1 certificates to your Google Sheet.`);
    } catch (err) {
      alert('Mirror push failed: ' + err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '⬆ Push All D1 Records to Google Sheet Mirror';
    }
  });

  // Copy Apps Script Code
  container.querySelector('#btn-copy-appscript').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_CODE);
      showToast('Apps Script code copied to clipboard!');
    } catch (e) {
      const ta = container.querySelector('#appscript-viewer');
      ta.select();
      document.execCommand('copy');
      showToast('Apps Script code copied!');
    }
  });

  // Download Code.gs
  container.querySelector('#btn-download-appscript').addEventListener('click', () => {
    const blob = new Blob([APPS_SCRIPT_CODE], { type: 'text/javascript;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Code.gs';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Code.gs downloaded!');
  });

  // User toggle
  container.querySelectorAll('.btn-toggle-user').forEach(btn => {
    btn.addEventListener('click', async () => {
      const loginId = btn.getAttribute('data-id');
      const isActive = btn.getAttribute('data-active') === 'true';
      const targetUser = users.find(u => u.login_id === loginId);
      if (targetUser) {
        targetUser.active = !isActive;
        await api.saveUser(targetUser);
        showToast(`User ${loginId} status updated!`);
        renderSettingsTab(container, session);
      }
    });
  });

  // Add User
  container.querySelector('#btn-add-user').addEventListener('click', () => {
    openAddUserModal(() => renderSettingsTab(container, session));
  });
}

/**
 * ==============================================================================
 * MODAL DIALOGS
 * ==============================================================================
 */
function openModal(contentHtml) {
  const modalContainer = document.querySelector('#modal-container');
  modalContainer.innerHTML = `
    <div class="modal-overlay" id="active-modal">
      <div class="modal-content">
        ${contentHtml}
      </div>
    </div>
  `;
  const modal = modalContainer.querySelector('#active-modal');
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  const closeBtn = modal.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}

function closeModal() {
  const modalContainer = document.querySelector('#modal-container');
  if (modalContainer) modalContainer.innerHTML = '';
}

async function openQrModal(cert) {
  const prefixUrl = currentConfig.PREFIX_URL || (window.location.origin + window.location.pathname + '?id=');
  const verifyUrl = `${prefixUrl}${encodeURIComponent(cert.id)}`;
  const canvas = await qrEngine.renderQrCanvas(verifyUrl, cert.id);

  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
      <h3 style="margin: 0;">QR Code &amp; Verification Details</h3>
      <button type="button" class="btn sm modal-close-btn">✕</button>
    </div>

    <div style="text-align: center;">
      <div class="qr-canvas-holder" id="modal-canvas-box" style="margin: 10px auto; max-width: 320px;"></div>
      <div style="margin: 14px 0; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
        <button type="button" class="btn primary" id="modal-btn-copy">📋 Copy QR Image</button>
        <button type="button" class="btn" id="modal-btn-download">💾 Download PNG</button>
        <a href="${verifyUrl}" target="_blank" class="btn" style="text-decoration: none;">↗ Open Verification Link</a>
      </div>
      <div class="verify-field" style="text-align: left; margin-top: 16px;">
        <div class="verify-label">Recipient Name</div>
        <div class="verify-value">${esc(cert.recipientName)}</div>
      </div>
      <div class="verify-field" style="text-align: left;">
        <div class="verify-label">Certificate Type</div>
        <div class="verify-value">${esc(cert.certificateType)}</div>
      </div>
      <div class="verify-field" style="text-align: left;">
        <div class="verify-label">Issued By</div>
        <div class="verify-value">${esc(cert.issuedBy || 'GCS Foundation')}</div>
      </div>
    </div>
  `);

  const box = document.querySelector('#modal-canvas-box');
  box.appendChild(canvas);

  document.querySelector('#modal-btn-copy').addEventListener('click', async () => {
    const res = await qrEngine.copyToClipboard(canvas);
    showToast(res.message);
  });

  document.querySelector('#modal-btn-download').addEventListener('click', () => {
    qrEngine.downloadCanvas(canvas, `${cert.id}_QR.png`);
  });
}

function openEditModal(cert, onSave) {
  const dateValForPicker = formatDateToPicker(cert.dateIssued);

  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">Edit Certificate: ${esc(cert.id)}</h3>
      <button type="button" class="btn sm modal-close-btn">✕</button>
    </div>

    <form id="modal-edit-form" style="display: flex; flex-direction: column; gap: 12px;">
      <label>
        Recipient Name
        <input type="text" name="recipientName" value="${esc(cert.recipientName)}" required>
      </label>
      <label>
        Certificate Type (Select or Type Custom)
        <input list="modal-cert-types" name="certificateType" value="${esc(cert.certificateType)}" required>
        <datalist id="modal-cert-types">
          ${CERTIFICATE_TYPES.map(t => `<option value="${esc(t)}"></option>`).join('')}
        </datalist>
      </label>
      <label>
        Date Issued
        <input type="date" name="dateIssuedPicker" value="${dateValForPicker}" required>
      </label>
      <label>
        Issued By
        <input type="text" name="issuedBy" value="${esc(cert.issuedBy || '')}">
      </label>
      <label>
        Reference / Registration No
        <input type="text" name="referenceNo" value="${esc(cert.referenceNo || '')}">
      </label>
      <label>
        Description / Remarks
        <textarea name="description" rows="2">${esc(cert.description || '')}</textarea>
      </label>
      <label>
        Tabular Data (Option B format or JSON)
        <textarea name="tableData" rows="3">${esc(cert.tableData || '')}</textarea>
      </label>

      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
        <button type="button" class="btn modal-close-btn">Cancel</button>
        <button type="submit" class="btn primary">Save Changes</button>
      </div>
    </form>
  `);

  document.querySelector('#modal-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const datePickerVal = formData.get('dateIssuedPicker');
    const formattedDate = formatDateToStandard(datePickerVal);

    const updated = {
      id: cert.id,
      recipientName: formData.get('recipientName').trim(),
      certificateType: formData.get('certificateType').trim(),
      dateIssued: formattedDate,
      issuedBy: formData.get('issuedBy').trim(),
      referenceNo: formData.get('referenceNo').trim(),
      description: formData.get('description').trim(),
      tableData: tableEngine.stringifyForStorage(formData.get('tableData'))
    };

    await api.updateCertificate(updated);
    showToast('Certificate updated successfully!');
    closeModal();
    if (onSave) onSave();
  });
}

function openAddUserModal(onSuccess) {
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">Add New Staff User</h3>
      <button type="button" class="btn sm modal-close-btn">✕</button>
    </div>

    <form id="modal-add-user-form" style="display: flex; flex-direction: column; gap: 12px;">
      <label>
        Full Name *
        <input type="text" name="name" required placeholder="e.g. Dr. Priya Shah">
      </label>
      <label>
        Designation
        <input type="text" name="designation" placeholder="e.g. Academic Coordinator">
      </label>
      <label>
        Login ID / Email *
        <input type="email" name="login_id" required placeholder="e.g. priya.shah@gcsmc.org">
      </label>
      <label>
        Initial Password *
        <input type="password" name="password" required value="Gcs@12345">
      </label>
      <label>
        Role
        <select name="role">
          <option value="${ROLES.USER}">User (Issuance &amp; QR Only)</option>
          <option value="${ROLES.ADMIN}">Admin (Issuance, Revoke &amp; Edit)</option>
          <option value="${ROLES.SUPER_ADMIN}">Super Admin</option>
        </select>
      </label>

      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;">
        <button type="button" class="btn modal-close-btn">Cancel</button>
        <button type="submit" class="btn primary">Create User</button>
      </div>
    </form>
  `);

  document.querySelector('#modal-add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const newUser = {
      name: formData.get('name').trim(),
      designation: formData.get('designation').trim(),
      login_id: formData.get('login_id').trim().toLowerCase(),
      password: formData.get('password').trim(),
      role: formData.get('role'),
      active: true
    };

    await api.saveUser(newUser);
    showToast('Staff user created successfully!');
    closeModal();
    if (onSuccess) onSuccess();
  });
}

function openSearchResultsModal(query, results) {
  openModal(`
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3 style="margin: 0;">Search Results for "${esc(query)}" (${results.length})</h3>
      <button type="button" class="btn sm modal-close-btn">✕</button>
    </div>

    ${results.length === 0 ? `
      <p style="color: var(--muted); text-align: center; padding: 20px;">No certificates found matching your search term.</p>
    ` : `
      <div class="neu-table-wrap">
        <table class="neu-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Recipient Name</th>
              <th>Type</th>
              <th>Issued By</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${results.map(r => `
              <tr>
                <td class="mono"><strong>${esc(r.id)}</strong></td>
                <td>${esc(r.recipientName)}</td>
                <td>${esc(r.certificateType)}</td>
                <td>${esc(r.issuedBy || 'GCS Foundation')}</td>
                <td><span class="badge ${String(r.status).toLowerCase() === 'revoked' ? 'revoked' : 'valid'}">${esc(r.status || 'Valid')}</span></td>
                <td>
                  <a href="${currentConfig.PREFIX_URL || '?id='}${encodeURIComponent(r.id)}" target="_blank" class="btn sm">
                    Verify ↗
                  </a>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `}
  `);
}

// Global Router Listener
window.addEventListener('popstate', initApp);
initApp();
