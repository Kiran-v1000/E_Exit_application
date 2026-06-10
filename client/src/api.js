const BASE = (import.meta.env.VITE_API_URL || '') + '/api/v1';

export const api = async (path, { method = 'GET', body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(localStorage.token ? { Authorization: 'Bearer ' + localStorage.token } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json().catch(() => ({ success: false, message: 'Network error' }));
  if (res.status === 401 && !path.includes('/auth/')) { localStorage.clear(); location.reload(); }
  if (!json.success) throw new Error(json.message || 'Request failed');
  return json;
};
