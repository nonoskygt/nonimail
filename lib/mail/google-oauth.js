'use strict';
// "Conectar con Google": OAuth 2.0 para apps de escritorio (cliente propio de cada usuario),
// PKCE + redirect loopback a esta misma app. El token sirve para IMAP y SMTP (XOAUTH2).
const crypto = require('crypto');

// Las variables NONIMAIL_GOOGLE_* existen solo para las pruebas (Google falso en localhost)
const ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.NONIMAIL_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revoke: process.env.NONIMAIL_GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
};
const GMAIL_SCOPE = 'https://mail.google.com/';
const SCOPES = `${GMAIL_SCOPE} openid email`;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function createPkce() {
  const verifier = b64url(crypto.randomBytes(48));
  return { verifier, challenge: b64url(crypto.createHash('sha256').update(verifier).digest()) };
}

function buildAuthUrl({ clientId, redirectUri, state, challenge, loginHint, authUrl = ENDPOINTS.auth }) {
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES,
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  });
  if (loginHint) q.set('login_hint', loginHint);
  return `${authUrl}?${q}`;
}

function emailFromIdToken(idToken) {
  try { return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || ''; }
  catch (_) { return ''; }
}

async function tokenRequest(url, params) {
  const r = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params), signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const msg = j.error_description || j.error || `HTTP ${r.status}`;
    throw new Error(j.error === 'invalid_grant' ? `Google rechazó el acceso (${msg}). Volvé a "Conectar con Google".` : `Google: ${msg}`);
  }
  return j;
}

async function exchangeCode({ clientId, clientSecret, code, verifier, redirectUri, tokenUrl = ENDPOINTS.token }) {
  const j = await tokenRequest(tokenUrl, {
    client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: redirectUri,
  });
  if (!String(j.scope || '').split(' ').includes(GMAIL_SCOPE)) throw new Error('No se otorgó el permiso de Gmail. Volvé a conectar y marcá el acceso al correo.');
  if (!j.refresh_token) throw new Error('Google no devolvió un token de renovación. Quitá el acceso en myaccount.google.com/permissions y volvé a conectar.');
  return { refreshToken: j.refresh_token, accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000, email: emailFromIdToken(j.id_token) };
}

async function refreshAccessToken({ clientId, clientSecret, refreshToken, tokenUrl = ENDPOINTS.token }) {
  const j = await tokenRequest(tokenUrl, { client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
}

async function revoke(token, revokeUrl = ENDPOINTS.revoke) {
  try { await fetch(`${revokeUrl}?token=${encodeURIComponent(token)}`, { method: 'POST', signal: AbortSignal.timeout(10000) }); } catch (_) {}
}

// Token de acceso en memoria, renovado 1 minuto antes de vencer
class TokenCache {
  constructor({ tokenUrl } = {}) { this.tokenUrl = tokenUrl || ENDPOINTS.token; this.cache = new Map(); }
  seed(refreshToken, accessToken, expiresAt) { this.cache.set(refreshToken, { accessToken, expiresAt }); }
  async get({ clientId, clientSecret, refreshToken }) {
    const c = this.cache.get(refreshToken);
    if (c && c.expiresAt - 60000 > Date.now()) return c.accessToken;
    const t = await refreshAccessToken({ clientId, clientSecret, refreshToken, tokenUrl: this.tokenUrl });
    this.cache.set(refreshToken, t);
    return t.accessToken;
  }
  clear() { this.cache.clear(); }
}

module.exports = { ENDPOINTS, SCOPES, GMAIL_SCOPE, createPkce, buildAuthUrl, exchangeCode, refreshAccessToken, revoke, emailFromIdToken, TokenCache };
