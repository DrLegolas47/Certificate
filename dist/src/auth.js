/**
 * GCS Certificate Portal - Authentication & Security (Matching Internship_GCS)
 * Built-in 5-digit CAPTCHA generator + Neumorphic Login Card
 */

import { api } from './api.js';

let currentCaptcha = '';

function generateCaptchaCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

export const auth = {
  renderLoginScreen(container, onSuccess) {
    currentCaptcha = generateCaptchaCode();

    container.innerHTML = `
      <section class="login-shell">
        <div class="login-copy">
          <img src="./assets/gcs_foundation_logo.png" alt="GCS Foundation Logo" class="login-logo">
          <h1 style="font-size: 24px; margin-bottom: 4px;">Certificate Issuance &amp; Verification Portal</h1>
          <p class="mono" style="font-size: 12px; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase;">
            GCS Foundation
          </p>
        </div>

        <form class="login-card" id="login-form">
          <h2 style="font-size: 20px; text-align: center; margin-bottom: 4px;">Staff Sign In</h2>
          <p style="text-align: center; font-size: 13px; color: var(--muted); margin-bottom: 22px;">
            Authorized access for academic coordinators and administrators
          </p>

          <label>
            Login ID / Username
            <input type="text" name="username" required placeholder="e.g. jaydeep.ghevariya@gcsmc.org" autocomplete="username">
          </label>

          <label>
            Password
            <input type="password" name="password" required placeholder="Enter your password" autocomplete="current-password">
          </label>

          <label>
            Security Verification Code
            <div class="captcha-box">
              <span class="captcha-display" id="captcha-display">${currentCaptcha}</span>
              <button type="button" class="btn icon-btn" id="refresh-captcha" title="Regenerate Security Code">↻</button>
            </div>
            <input type="text" name="captcha" inputmode="numeric" required placeholder="Enter the 5-digit code shown above" autocomplete="off">
          </label>

          <button type="submit" class="btn primary" style="width: 100%; margin-top: 10px; padding: 12px;">
            Sign In to Portal
          </button>

          <div id="login-error" class="form-error"></div>
          
          <div style="margin-top: 20px; text-align: center;">
            <a href="javascript:void(0)" id="back-to-verify" style="font-size: 12px; color: var(--brand); font-weight: 600; text-decoration: none;">
              ← Back to Verification Portal
            </a>
          </div>
        </form>
      </section>
    `;

    const form = container.querySelector('#login-form');
    const refreshBtn = container.querySelector('#refresh-captcha');
    const displayEl = container.querySelector('#captcha-display');
    const errorEl = container.querySelector('#login-error');
    const backBtn = container.querySelector('#back-to-verify');

    refreshBtn.addEventListener('click', () => {
      currentCaptcha = generateCaptchaCode();
      displayEl.textContent = currentCaptcha;
    });

    backBtn.addEventListener('click', () => {
      const cleanPath = window.location.pathname.replace(/\/li\/?$/, '/') || '/';
      window.history.pushState({}, '', cleanPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const formData = new FormData(form);
      const enteredCaptcha = String(formData.get('captcha') || '').trim();

      if (enteredCaptcha !== currentCaptcha) {
        errorEl.textContent = 'Security code did not match. A new code has been generated.';
        currentCaptcha = generateCaptchaCode();
        displayEl.textContent = currentCaptcha;
        return;
      }

      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Verifying credentials...';

      try {
        const username = formData.get('username');
        const password = formData.get('password');
        await api.login(username, password);
        if (onSuccess) onSuccess();
      } catch (err) {
        errorEl.textContent = err.message || 'Login failed.';
        currentCaptcha = generateCaptchaCode();
        displayEl.textContent = currentCaptcha;
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In to Portal';
      }
    });
  }
};
