import { useAsync } from './useAsync.js';
import { get, getPaged } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

/** The single project of the logged-in student (null if the group has none yet). */
export function useMyProject() {
  const { user } = useAuth();
  return useAsync(async () => {
    if (user?.role !== 'student') return { projectId: null };
    const { projectId } = await get('/projects/mine');
    if (!projectId) return { projectId: null };
    return { projectId, detail: await get(`/projects/${projectId}`) };
  }, []);
}

/** Projects the staff member may see (assigned ones for supervisors, all for the coordinator). */
export function useProjectOptions() {
  return useAsync(async () => (await getPaged('/projects', { limit: 100 })).items, []);
}
