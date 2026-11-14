/** Applied to document AND worker responses by both supported local servers. */
export const securityHeaders={
  'Content-Security-Policy':"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' ws://127.0.0.1:4180; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; font-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'; base-uri 'none'",
  'Permissions-Policy':'camera=(self), microphone=(), geolocation=()',
  'Referrer-Policy':'no-referrer',
  'X-Content-Type-Options':'nosniff',
  'Cross-Origin-Resource-Policy':'same-origin',
};
