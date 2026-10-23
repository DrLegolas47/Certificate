/**
 * GCS Certificate Verification & Issuance Portal - Configuration & Constants
 */

export const STORAGE_KEYS = {
  SESSION: 'gcsmc.cert.session.v1',
  LOCAL_DATA: 'gcsmc.cert.localdata.v1',
  SCRIPT_URL: 'gcsmc.cert.script_url.v1'
};

export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  USER: 'USER'
};

export const DEFAULT_CONFIG = {
  PREFIX_URL: window.location.origin + (window.location.pathname.endsWith('/') ? window.location.pathname : window.location.pathname + '/') + '?id=',
  HEADER_BRANDING: 'GCS Foundation',
  SUB_BRANDING: 'Certificate Verification Portal',
  CONTACT_EMAIL: 'info@gcsmc.org',
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxCXyqcI8Fgvffpc7PzYL9hXP0sWqZpaueams3EZNZ4XTksCJQg8V21DYYe_Vb_zSGH/exec'
};

export const DEFAULT_USERS = [
  {
    user_id: 'user-superadmin-jaydeep',
    name: 'Dr. Jaydeep Ghevariya',
    designation: 'Portal Administrator',
    login_id: 'jaydeep.ghevariya@gcsmc.org',
    password: '1234567890@Abc',
    role: ROLES.SUPER_ADMIN,
    active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z'
  }
];

export const CERTIFICATE_TYPES = [
  'Certificate of Participation',
  'Certificate of Completion',
  'Internship Completion Certificate',
  'Certificate of Appreciation',
  'Certificate of Excellence',
  'Workshop / CME Attendance',
  'Experience Certificate'
];
