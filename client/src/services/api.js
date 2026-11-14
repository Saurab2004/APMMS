// One Axios client for the whole app: cookies are sent automatically (HttpOnly JWT),
// the CSRF header is added to every request, and errors are turned into friendly messages.
import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'X-Requested-With': 'APMMS' },
  timeout: 30000,
});

export const SESSION_EXPIRED = 'apmms:session-expired';
export const PASSWORD_CHANGE = 'apmms:password-change';
export const PLATFORM_SESSION_EXPIRED = 'apmms:platform-session-expired';
export const PLATFORM_PASSWORD_CHANGE = 'apmms:platform-password-change';

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const res = error.response;
    const data = res?.data && typeof res.data === 'object' && !(res.data instanceof Blob) ? res.data : null;
    error.status = res?.status;
    error.details = data?.details;
    error.code = data?.code;
    if (!res) error.userMessage = error.code === 'ECONNABORTED' ? 'The server took too long to answer.' : 'Cannot reach the server. Check your connection and that the API is running.';
    else error.userMessage = data?.message || `Request failed (${res.status})`;

    const url = error.config?.url || '';
    // The platform admin console has its own session: its errors must never log an institution user out (and vice versa).
    if (url.startsWith('/platform')) {
      const isPlatformAuth = ['/platform/auth/login', '/platform/auth/me', '/platform/setup'].some((u) => url.startsWith(u));
      if (res?.status === 401 && !isPlatformAuth) window.dispatchEvent(new Event(PLATFORM_SESSION_EXPIRED));
      if (res?.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event(PLATFORM_PASSWORD_CHANGE));
      return Promise.reject(error);
    }
    const isAuthCall = url.startsWith('/auth/login') || url.startsWith('/auth/me') || url.startsWith('/auth/register');
    if (res?.status === 401 && !isAuthCall) window.dispatchEvent(new Event(SESSION_EXPIRED));
    if (res?.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event(PASSWORD_CHANGE));
    return Promise.reject(error);
  }
);

export const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';

/** GET returning just the `data` field (and `meta` if you ask for it). */
export async function get(url, params) {
  const r = await api.get(url, { params });
  return r.data.data;
}
export async function getPaged(url, params) {
  const r = await api.get(url, { params });
  return { items: r.data.data, meta: r.data.meta || {} };
}
export const post = async (url, body, config) => (await api.post(url, body, config)).data.data;
export const put = async (url, body, config) => (await api.put(url, body, config)).data.data;
export const patch = async (url, body, config) => (await api.patch(url, body, config)).data.data;
export const del = async (url) => (await api.delete(url)).data.data;

const filenameFrom = (cd = '') => {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) return decodeURIComponent(star[1]);
  const plain = /filename="?([^";]+)"?/i.exec(cd);
  return plain ? plain[1] : 'download';
};

/** Fetches a protected file as a Blob (the browser sends the login cookie). */
export async function fetchBlob(url, params) {
  const r = await api.get(url, { params, responseType: 'blob' });
  return { blob: r.data, filename: filenameFrom(r.headers['content-disposition']), type: r.headers['content-type'] };
}

/** Downloads a protected file with the browser's normal "save" behaviour. */
export async function downloadFile(url, fallbackName) {
  const { blob, filename } = await fetchBlob(url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fallbackName || filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
