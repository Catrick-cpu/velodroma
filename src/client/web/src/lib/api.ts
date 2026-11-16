const BASE = (import.meta as any).env?.VITE_API_BASE || '/api';
function token() { return localStorage.getItem('velodroma_token') || ''; }

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      ...(opts.headers || {})
    }
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Network error' }));
  if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data as T;
}

export const Auth = {
  register: (body: any) => api<{ token: string; user: any }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: any) => api<{ token: string; user: any }>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),
};
export const Users = {
  me: () => api<any>('/users/me'),
  updateMe: (body: any) => api<any>('/users/me', { method: 'PUT', body: JSON.stringify(body) }),
  get: (id: string) => api<any>(`/users/${id}`),
  stats: (id: string) => api<any>(`/users/${id}/stats`),
  activities: (id: string) => api<any[]>(`/users/${id}/activities`),
};
export const Activities = {
  feed: () => api<any[]>('/activities/feed'),
  explore: () => api<any[]>('/activities/explore'),
  get: (id: string) => api<any>(`/activities/${id}`),
  create: (activity: any) => api<any>('/activities', { method: 'POST', body: JSON.stringify({ activity }) }),
  kudos: (id: string) => api<any>(`/activities/${id}/kudos`, { method: 'POST' }),
  unKudos: (id: string) => api<any>(`/activities/${id}/kudos`, { method: 'DELETE' }),
  comment: (id: string, text: string) => api<any>(`/activities/${id}/comments`, { method: 'POST', body: JSON.stringify({ text }) }),
};
export const Segments = {
  list: (params?: { q?: string; world?: string }) => {
    const qs = new URLSearchParams(params as any).toString();
    return api<any[]>(`/segments${qs ? `?${qs}` : ''}`);
  },
  get: (id: string) => api<any>(`/segments/${id}`),
  leaderboard: (id: string) => api<any[]>(`/segments/${id}/leaderboard`),
  create: (body: any) => api<any>('/segments', { method: 'POST', body: JSON.stringify(body) }),
  effort: (id: string, body: any) => api<any>(`/segments/${id}/efforts`, { method: 'POST', body: JSON.stringify(body) }),
};
export const Social = {
  clubs: () => api<any[]>('/social/clubs'),
  club: (id: string) => api<any>(`/social/clubs/${id}`),
  createClub: (body: any) => api<any>('/social/clubs', { method: 'POST', body: JSON.stringify(body) }),
  joinClub: (id: string) => api<any>(`/social/clubs/${id}/join`, { method: 'POST' }),
  leaveClub: (id: string) => api<any>(`/social/clubs/${id}/leave`, { method: 'DELETE' }),
};
export const Training = {
  workouts: () => api<any[]>('/training/workouts'),
  plans: () => api<any[]>('/training/plans'),
};
