/**
 * GCS Certificate Portal - API & Data Layer
 * Connects to Google Apps Script Web App with local persistence fallback
 */

import { STORAGE_KEYS, DEFAULT_CONFIG, DEFAULT_USERS, ROLES } from './config.js';

/**
 * In-memory cache so we don't re-fetch config.json on every call.
 * Populated by initApi() at app startup.
 */
let _scriptUrlCache = null;

/**
 * Initialise the API layer.
 * Fetches /config.json (served by Cloudflare, same on every device) and
 * seeds localStorage so all subsequent getScriptUrl() calls use the live URL.
 * Call once at the very start of the app before any other api.* call.
 */
export async function initApi() {
  try {
    const res = await fetch('/config.json?_=' + Date.now()); // bust cache
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.SCRIPT_URL) {
        _scriptUrlCache = cfg.SCRIPT_URL;
        // Seed localStorage so subsequent synchronous calls also get the right URL
        localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, cfg.SCRIPT_URL);
        console.log('[API] Script URL loaded from config.json:', cfg.SCRIPT_URL);
        return;
      }
    }
  } catch (err) {
    console.warn('[API] Could not fetch /config.json, using localStorage/fallback:', err);
  }
  // Fallback: use whatever is in localStorage (or hardcoded default)
  _scriptUrlCache = localStorage.getItem(STORAGE_KEYS.SCRIPT_URL) || DEFAULT_CONFIG.SCRIPT_URL;
}

function getScriptUrl() {
  // Prefer in-memory cache (set by initApi), then localStorage, then hardcoded default
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
  /**
   * Set Google Apps Script Web App URL.
   * Saves to both in-memory cache and localStorage so it takes effect
   * immediately without a page reload.
   */
  setScriptUrl(url) {
    const clean = (url || '').trim();
    _scriptUrlCache = clean;                                // update in-memory cache
    localStorage.setItem(STORAGE_KEYS.SCRIPT_URL, clean);  // persist for this session
    return clean;
  },

  getScriptUrl() {
    return getScriptUrl();
  },

  /**
   * Staff Authentication (POST to Google Apps Script or offline fallback)
   */
  async login(username, password) {
    const scriptUrl = getScriptUrl();
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    // 1. Try Google Apps Script if configured
    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'login', username: cleanUser, password: cleanPass })
        });
        const d = await res.json();
        if (d && d.success) {
          sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(d));
          return d;
        } else if (d && d.error) {
          throw new Error(d.error);
        }
      } catch (err) {
        if (err.message && (err.message.includes('Incorrect') || err.message.includes('deactivated') || err.message.includes('not found'))) {
          throw err;
        }
        console.warn('Apps Script login failed, falling back to local credentials:', err);
      }
    }

    // 2. Offline fallback
    const store = getLocalStore();
    const user = store.users.find(u => u.login_id.toLowerCase() === cleanUser);

    if (!user) {
      throw new Error('User not found. Check your Login ID.');
    }
    if (!user.active) {
      throw new Error('This user account is deactivated.');
    }
    if (user.password !== cleanPass) {
      throw new Error('Incorrect password.');
    }

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
   */
  async verifyCertificate(id) {
    const cleanId = String(id || '').trim();
    if (!cleanId) return { found: false, error: 'No Certificate ID specified.' };

    const scriptUrl = getScriptUrl();

    // 1. Try Google Apps Script (Primary source of truth)
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
        console.warn('Apps Script verification fetch failed, falling back to local registry:', err);
      }
    }

    // 2. Local Fallback (for offline testing)
    const store = getLocalStore();
    const cert = store.certificates.find(c => c.id.toUpperCase() === cleanId.toUpperCase());
    if (cert) {
      cert.scanCount = (cert.scanCount || 0) + 1;
      cert.lastScannedAt = new Date().toISOString();
      saveLocalStore(store);

      return {
        found: true,
        ...cert,
        recipientName: cert.recipientName || cert.name || 'Recipient',
        branding: {
          headerBranding: store.config.HEADER_BRANDING || DEFAULT_CONFIG.HEADER_BRANDING,
          subBranding: store.config.SUB_BRANDING || DEFAULT_CONFIG.SUB_BRANDING,
          contactEmail: store.config.CONTACT_EMAIL || DEFAULT_CONFIG.CONTACT_EMAIL
        }
      };
    }

    return { found: false, error: 'No certificate matches this ID in official records.' };
  },

  /**
   * List Certificates by Year
   */
  async listCertificates(year) {
    const targetYear = String(year || new Date().getFullYear());
    const scriptUrl = getScriptUrl();

    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?action=listCertificates&year=${encodeURIComponent(targetYear)}`);
        const d = await res.json();
        if (d && d.success) return d.certificates || [];
      } catch (err) {
        console.warn('Apps Script list failed:', err);
      }
    }

    // Local fallback
    const store = getLocalStore();
    const yrPrefix = targetYear.slice(-2);
    return store.certificates.filter(c => c.id.startsWith(yrPrefix));
  },

  /**
   * Search Certificates by Query
   */
  async searchCertificates(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];

    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?action=search&q=${encodeURIComponent(q)}`);
        const d = await res.json();
        if (d && d.success) return d.results || [];
      } catch (err) {
        console.warn('Apps Script search failed:', err);
      }
    }

    // Local fallback
    const store = getLocalStore();
    return store.certificates.filter(c =>
      c.id.toLowerCase().includes(q) ||
      ((c.recipientName || c.name) && (c.recipientName || c.name).toLowerCase().includes(q)) ||
      (c.referenceNo && c.referenceNo.toLowerCase().includes(q))
    );
  },

  /**
   * Issue Single Certificate (Dual-Mode POST with GET Fallback)
   */
  async issueCertificate(certData) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Staff';

    const payload = {
      ...certData,
      issuedByUser: user,
      createdAt: new Date().toISOString(),
      scanCount: 0,
      lastScannedAt: ''
    };

    let cloudSaved = false;
    let cloudError = '';

    if (scriptUrl) {
      // Step A: Attempt POST
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'issueCertificate', certificate: payload })
        });
        const text = await res.text();
        try {
          const d = JSON.parse(text);
          if (d && d.success) {
            cloudSaved = true;
          } else if (d && d.error) {
            cloudError = d.error;
          }
        } catch (pe) {
          if (text.includes('doPost') || text.includes('Error')) {
            cloudError = 'Apps Script deployment missing doPost. Update Code.gs in Google Sheets.';
          }
        }
      } catch (postErr) {
        cloudError = postErr.message;
      }

      // Step B: Attempt GET Fallback if POST didn't succeed
      if (!cloudSaved) {
        try {
          const getUrl = `${scriptUrl}?action=issueCertificate&payload=${encodeURIComponent(JSON.stringify(payload))}`;
          const resGet = await fetch(getUrl);
          const dGet = await resGet.json();
          if (dGet && dGet.success) {
            cloudSaved = true;
          }
        } catch (getErr) {
          console.warn('GET fallback save failed:', getErr);
        }
      }
    }

    // Always update local cache
    const store = getLocalStore();
    store.certificates.unshift(payload);
    saveLocalStore(store);

    if (!cloudSaved && scriptUrl) {
      throw new Error(
        `Cloud sync failed: ${cloudError || 'Could not save to Google Sheets'}. ` +
        `Please ensure you updated your Google Sheet with the new Code.gs (Extensions > Apps Script > Deploy > New deployment).`
      );
    }

    return { success: true, id: payload.id, message: 'Certificate issued successfully.' };
  },

  /**
   * Batch Issue Certificates (150+ records) with Dual-Mode POST/GET
   */
  async batchIssue(certificates) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Staff';

    let cloudSaved = false;
    let cloudError = '';

    if (scriptUrl) {
      // Step A: Attempt POST
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'batchIssue',
            certificates: certificates,
            issuedByUser: user
          })
        });
        const text = await res.text();
        try {
          const d = JSON.parse(text);
          if (d && d.success) {
            cloudSaved = true;
          } else if (d && d.error) {
            cloudError = d.error;
          }
        } catch (pe) {
          cloudError = 'Apps Script deployment missing doPost. Update Code.gs in Google Sheets.';
        }
      } catch (postErr) {
        cloudError = postErr.message;
      }

      // Step B: Attempt GET Fallback
      if (!cloudSaved) {
        try {
          const getUrl = `${scriptUrl}?action=batchIssue&payload=${encodeURIComponent(JSON.stringify(certificates))}`;
          const resGet = await fetch(getUrl);
          const dGet = await resGet.json();
          if (dGet && dGet.success) {
            cloudSaved = true;
          }
        } catch (getErr) {
          console.warn('Batch GET fallback failed:', getErr);
        }
      }
    }

    // Local save
    const store = getLocalStore();
    store.certificates.unshift(...certificates);
    saveLocalStore(store);

    if (!cloudSaved && scriptUrl) {
      throw new Error(
        `Cloud batch sync failed: ${cloudError || 'Could not save to Google Sheets'}. ` +
        `Please ensure you deployed the new Code.gs in Google Sheets.`
      );
    }

    return { success: true, count: certificates.length, message: 'Batch certificates issued successfully.' };
  },

  /**
   * Update Status (Revoke / Reinstate)
   */
  async updateStatus(id, newStatus) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Admin';

    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'updateStatus', id, status: newStatus, user })
        });
        const d = await res.json();
        if (d && d.success) {
          const store = getLocalStore();
          const target = store.certificates.find(c => c.id === id);
          if (target) target.status = newStatus;
          saveLocalStore(store);
          return d;
        }
      } catch (err) {
        console.warn('Apps Script update status failed:', err);
      }
    }

    // Local update
    const store = getLocalStore();
    const target = store.certificates.find(c => c.id === id);
    if (target) {
      target.status = newStatus;
      saveLocalStore(store);
      return { success: true, id, status: newStatus };
    }
    return { success: false, error: 'Certificate not found.' };
  },

  /**
   * Update Certificate Details
   */
  async updateCertificate(certData) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Admin';

    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'updateCertificate', certificate: certData, user })
        });
        const d = await res.json();
        if (d && d.success) {
          const store = getLocalStore();
          const idx = store.certificates.findIndex(c => c.id === certData.id);
          if (idx !== -1) store.certificates[idx] = { ...store.certificates[idx], ...certData };
          saveLocalStore(store);
          return d;
        }
      } catch (err) {
        console.warn('Apps Script edit certificate failed:', err);
      }
    }

    // Local update
    const store = getLocalStore();
    const idx = store.certificates.findIndex(c => c.id === certData.id);
    if (idx !== -1) {
      store.certificates[idx] = { ...store.certificates[idx], ...certData };
      saveLocalStore(store);
      return { success: true, id: certData.id, message: 'Updated locally.' };
    }
    return { success: false, error: 'Certificate not found.' };
  },

  /**
   * Delete Certificate (Super Admin only)
   */
  async deleteCertificate(id) {
    const cleanId = String(id || '').trim();
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Super Admin';

    if (scriptUrl) {
      // Step A: POST
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'deleteCertificate', id: cleanId, user })
        });
        const d = await res.json();
        if (d && d.success) {
          // Remove from local cache too
          const store = getLocalStore();
          store.certificates = store.certificates.filter(c => c.id !== cleanId);
          saveLocalStore(store);
          return d;
        } else if (d && d.error) {
          throw new Error(d.error);
        }
      } catch (err) {
        console.warn('Apps Script deleteCertificate POST failed, trying GET fallback:', err);
      }

      // Step B: GET fallback
      try {
        const getUrl = `${scriptUrl}?action=deleteCertificate&id=${encodeURIComponent(cleanId)}&user=${encodeURIComponent(user)}`;
        const resGet = await fetch(getUrl);
        const dGet = await resGet.json();
        if (dGet && dGet.success) {
          const store = getLocalStore();
          store.certificates = store.certificates.filter(c => c.id !== cleanId);
          saveLocalStore(store);
          return dGet;
        }
      } catch (getErr) {
        console.warn('GET fallback delete failed:', getErr);
      }
    }

    // Local-only delete
    const store = getLocalStore();
    store.certificates = store.certificates.filter(c => c.id !== cleanId);
    saveLocalStore(store);
    return { success: true, id: cleanId, message: 'Deleted locally (offline mode).' };
  },

  /**
   * Upload all certificates currently stored in local browser offline store into Google Sheets
   */
  async syncOfflineCertificates() {
    const store = getLocalStore();
    const certs = store.certificates || [];
    if (certs.length === 0) return { count: 0, total: 0, message: 'No offline certificates found.' };

    const scriptUrl = getScriptUrl();
    if (!scriptUrl) throw new Error('No Apps Script Web App URL configured.');

    let count = 0;
    for (const cert of certs) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'issueCertificate', certificate: cert })
        });
        const d = await res.json();
        if (d && d.success) {
          count++;
          continue;
        }
      } catch (e) {}

      try {
        const getUrl = `${scriptUrl}?action=issueCertificate&payload=${encodeURIComponent(JSON.stringify(cert))}`;
        const res = await fetch(getUrl);
        const d = await res.json();
        if (d && d.success) count++;
      } catch (e2) {}
    }
    return { count, total: certs.length };
  },

  /**
   * Load System Config
   */
  async getConfig() {
    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?action=getConfig`);
        const d = await res.json();
        if (d && d.success && d.config) {
          const store = getLocalStore();
          store.config = { ...store.config, ...d.config };
          saveLocalStore(store);
          return store.config;
        }
      } catch (err) {
        console.warn('Apps Script getConfig failed:', err);
      }
    }
    return getLocalStore().config;
  },

  /**
   * Save System Config (Super Admin only)
   */
  async saveConfig(newConfig) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const user = session?.user?.name || 'Super Admin';

    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'saveConfig', config: newConfig, user })
        });
        const d = await res.json();
        if (d && d.success) {
          const store = getLocalStore();
          store.config = { ...store.config, ...newConfig };
          saveLocalStore(store);
          return store.config;
        }
      } catch (err) {
        console.warn('Apps Script saveConfig failed:', err);
      }
    }

    const store = getLocalStore();
    store.config = { ...store.config, ...newConfig };
    saveLocalStore(store);
    return store.config;
  },

  /**
   * User Management (Super Admin only)
   */
  async getUsers() {
    const scriptUrl = getScriptUrl();
    if (scriptUrl) {
      try {
        const res = await fetch(`${scriptUrl}?action=getUsers`);
        const d = await res.json();
        if (d && d.success) return d.users || [];
      } catch (err) {
        console.warn('Apps Script getUsers failed:', err);
      }
    }
    return getLocalStore().users;
  },

  async saveUser(userData) {
    const scriptUrl = getScriptUrl();
    const session = this.getSession();
    const adminUser = session?.user?.name || 'Super Admin';

    if (scriptUrl) {
      try {
        const res = await fetch(scriptUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'saveUser', userData, adminUser })
        });
        const d = await res.json();
        if (d && d.success) {
          const store = getLocalStore();
          const idx = store.users.findIndex(u => u.login_id === userData.login_id);
          if (idx !== -1) store.users[idx] = { ...store.users[idx], ...userData };
          else store.users.push(userData);
          saveLocalStore(store);
          return d;
        }
      } catch (err) {
        console.warn('Apps Script saveUser failed:', err);
      }
    }

    // Local user save
    const store = getLocalStore();
    const idx = store.users.findIndex(u => u.login_id === userData.login_id);
    if (idx !== -1) store.users[idx] = { ...store.users[idx], ...userData };
    else store.users.push(userData);
    saveLocalStore(store);
    return { success: true, message: 'User saved locally.' };
  }
};
