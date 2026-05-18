const viteEnv = import.meta.env || {};
const configuredApiBaseUrl = (viteEnv.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiUrl(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${configuredApiBaseUrl}${normalizedPath}`;
}
