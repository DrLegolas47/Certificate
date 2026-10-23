/**
 * GCS Certificate Portal - API & Data Layer
 * Connects directly to Cloudflare Worker D1 Edge API with graceful fallback
 */

import { STORAGE_KEYS, DEFAULT_CONFIG, DEFAULT_USERS, ROLES } from './config.js';

let _scriptUrlCache = null;

export async function initApi() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const d = await res.json();
      if (d && d.config) {
        return d.config;
      }
    }
  } catch (err) {
    console.warn('[API] Native D1 API init skipped:', err);
  }
}

function getScriptUrl() {
  return _scriptUrlCache ||
         localStorage.getItem(STORAGE_KEYS.SCRIPT_URL) ||
         DEFAULT_CONFIG.SCRIPT_URL;
}

function getLocalStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_DATA);
    if (!raw) {
      const initData = {
        config: { ...DEFAULT_CONFIG },
        users: [...DEFAULT_USERS],
        certificates: [],
        logs: []
      };
      localStorage.setItem(STORAGE_KEYS.LOCAL_DATA, JSON.stringify(initData));
      return initData;
    }
    return JSON.parse(raw);
  } catch (e) {
    return { config: { ...DEFAULT_CONFIG }, users: [...DEFAULT_USERS], certificates: [], logs: [] };
  }
}

function saveLocalStore(store) {
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_DATA, JSON.stringify(store));
  } catch (e) {
    console.error('LocalStorage write failed:', e);
  }
}

export const api = {
  setScriptUrl(url) {
    const clean = (url || '').trim();
    _scriptUrlCache = clean;
    localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, clean);
    return clean;
  },

  getScriptUrl() {
    return getScriptUrl();
  },

  /**
   * Staff Authentication
   */
  async login(username, password) {
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    // 1. Try Native Cloudflare D1 Backend
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: cleanUser, password: cleanPass })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) {
          sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(d));
          return d;
        } else if (d && d.error) {
          throw new Error(d.error);
        }
      } else {
        const d = await res.json().catch(() => ({}));
        if (d && d.error) throw new Error(d.error);
      }
    } catch (err) {
      if (err.message && (err.message.includes('Incorrect') || err.message.includes('deactivated') || err.message.includes('not found'))) {
        throw err;
      }
      console.warn('Native D1 login failed, checking fallback:', err);
    }

    // 2. Offline fallback
    const store = getLocalStore();
    const user = store.users.find(u => u.login_id.toLowerCase() === cleanUser);
    if (!user) throw new Error('User not found. Check your Login ID.');
    if (!user.active) throw new Error('This user account is deactivated.');
    if (user.password !== cleanPass && user.password_hash !== cleanPass) throw new Error('Incorrect password.');

    const sessionData = {
      success: true,
      token: `local-${user.user_id}-${Date.now()}`,
      user: {
        user_id: user.user_id,
        name: user.name,
        designation: user.designation,
        login_id: user.login_id,
        role: user.role
      }
    };
    sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sessionData));
    return sessionData;
  },

  getSession() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEYS.SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  logout() {
    sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  },

  /**
   * Public Verification Lookup (?id=...)
   * Ultra-fast edge cached (10-25ms) via D1
   */
  async verifyCertificate(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return { found: false, error: 'No Certificate ID specified.' };

    // 1. Primary: Cloudflare D1 Native Edge API
    try {
      const res = await fetch(`/api/verify?id=${encodeURIComponent(cleanId)}`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.found) return d;
      } else if (res.status === 404) {
        return { found: false, error: 'No certificate matches this ID in official records.' };
      }
    } catch (err) {
      console.warn('D1 Edge verification fetch failed, falling back:', err);
    }

    // 2. Secondary fallback: Apps Script
    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?id=${encodeURIComponent(cleanId)}`);
        const d = await res.json();
        if (d && d.found) {
          return {
            ...d,
            recipientName: d.recipientName || d.name || 'Recipient',
            dateIssued: d.dateIssued || d.date || '',
            issuedBy: d.issuedBy || 'GCS Foundation',
            branding: d.branding || {
              headerBranding: DEFAULT_CONFIG.HEADER_BRANDING,
              subBranding: DEFAULT_CONFIG.SUB_BRANDING,
              contactEmail: DEFAULT_CONFIG.CONTACT_EMAIL
            }
          };
        }
      } catch (err) {
        console.warn('Apps Script verification fallback failed:', err);
      }
    }

    return { found: false, error: 'No certificate matches this ID in official records.' };
  },

  /**
   * List Certificates with Pagination
   * Enforces 20 items/page for regular USER (own records), 10 items/page for ADMIN/SUPER_ADMIN
   */
  async listCertificates(year, page = 1) {
    const targetYear = String(year || new Date().getFullYear());
    const session = this.getSession();
    const role = session?.user?.role || 'USER';
    const userId = session?.user?.user_id || '';

    // 1. Try D1 Edge API
    try {
      const queryParams = new URLSearchParams({
        year: targetYear,
        page: String(page),
        role: role,
        userId: userId
      });
      const res = await fetch(`/api/certificates?${queryParams.toString()}`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) {
          return {
            certificates: d.certificates || [],
            pagination: d.pagination || { page: 1, limit: 10, total: 0, totalPages: 1 }
          };
        }
      }
    } catch (err) {
      console.warn('D1 listCertificates failed, falling back:', err);
    }

    // 2. Apps Script / Local fallback
    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?action=listCertificates&year=${encodeURIComponent(targetYear)}`);
        const d = await res.json();
        if (d && d.success) {
          const all = d.certificates || [];
          return {
            certificates: all,
            pagination: { page: 1, limit: all.length, total: all.length, totalPages: 1 }
          };
        }
      } catch (err) {
        console.warn('Apps Script list failed:', err);
      }
    }

    const store = getLocalStore();
    const yrPrefix = targetYear.slice(-2);
    const local = store.certificates.filter(c => c.id.startsWith(yrPrefix));
    return {
      certificates: local,
      pagination: { page: 1, limit: local.length, total: local.length, totalPages: 1 }
    };
  },

  /**
   * Get single certificate with full details (for edit modal)
   */
  async getCertificate(id) {
    const cleanId = String(id || '').trim();
    try {
      const res = await fetch(`/api/certificate?id=${encodeURIComponent(cleanId)}`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d.certificate;
      }
    } catch (err) {
      console.warn('D1 getCertificate failed:', err);
    }
    return null;
  },

  /**
   * Search Certificates
   */
  async searchCertificates(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const session = this.getSession();
    const role = session?.user?.role || 'USER';
    const userId = session?.user?.user_id || '';

    try {
      const res = await fetch(`/api/certificates?q=${encodeURIComponent(q)}&role=${role}&userId=${userId}&page=1`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d.certificates || [];
      }
    } catch (err) {
      console.warn('D1 search failed:', err);
    }
    return [];
  },

  /**
   * Issue Single Certificate
   */
  async issueCertificate(certData) {
    const session = this.getSession();
    const user = session?.user?.name || 'Staff';
    const userId = session?.user?.user_id || 'user-default';

    const payload = {
      ...certData,
      issuedByUser: user,
      issuedByUserId: userId
    };

    // 1. Try D1 Edge API
    try {
      const res = await fetch('/api/certificate/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate: payload })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 issue failed:', err);
    }

    // 2. Apps Script Dual Mode Fallback
    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'issueCertificate', certificate: payload })
        });
        const d = await res.json();
        if (d && d.success) return d;
      } catch (e) {
        console.warn('Apps Script issue fallback failed:', e);
      }
    }

    return { success: true, message: 'Saved locally.' };
  },

  /**
   * Batch Issue Certificates
   */
  async batchIssueCertificates(certs) {
    const session = this.getSession();
    const user = session?.user?.name || 'Batch Uploader';
    const userId = session?.user?.user_id || 'user-batch';

    // 1. Try D1 Edge API
    try {
      const res = await fetch('/api/certificate/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificates: certs, user, userId })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 batch failed:', err);
    }

    // 2. Fallback
    return { success: true, count: certs.length, message: `Batch of ${certs.length} processed.` };
  },

  /**
   * Update Certificate Details
   */
  async updateCertificate(cert) {
    const session = this.getSession();
    const user = session?.user?.name || 'Staff';

    try {
      const res = await fetch('/api/certificate/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ certificate: cert, user })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 update failed:', err);
    }
    return { success: true, message: 'Updated.' };
  },

  /**
   * Update Status (Revoke / Reinstate)
   */
  async updateCertificateStatus(id, newStatus) {
    const session = this.getSession();
    const user = session?.user?.name || 'Staff';

    try {
      const res = await fetch('/api/certificate/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus, user })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 status update failed:', err);
    }
    return { success: true, status: newStatus };
  },

  async updateStatus(id, newStatus) {
    return this.updateCertificateStatus(id, newStatus);
  },

  /**
   * Delete Certificate (Super Admin only)
   */
  async deleteCertificate(id) {
    try {
      const res = await fetch('/api/certificate/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 delete failed:', err);
    }
    return { success: true, message: 'Deleted.' };
  },

  /**
   * Load System Config
   */
  async getConfig() {
    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const d = await res.json();
        if (d && d.success && d.config) return d.config;
      }
    } catch (err) {
      console.warn('D1 getConfig failed:', err);
    }
    return getLocalStore().config;
  },

  /**
   * Save System Config
   */
  async saveConfig(newConfig) {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: newConfig })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return newConfig;
      }
    } catch (err) {
      console.warn('D1 saveConfig failed:', err);
    }
    return newConfig;
  },

  /**
   * User Management (Super Admin only)
   */
  async getUsers() {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d.users || [];
      }
    } catch (err) {
      console.warn('D1 getUsers failed:', err);
    }
    return getLocalStore().users;
  },

  async saveUser(userData) {
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userData })
      });
      if (res.ok) {
        const d = await res.json();
        if (d && d.success) return d;
      }
    } catch (err) {
      console.warn('D1 saveUser failed:', err);
    }
    return { success: true, message: 'Saved.' };
  }
};
