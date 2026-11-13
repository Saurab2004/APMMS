import { Select } from './fields.jsx';
import { useProjectOptions } from '../../hooks/useProjects.js';

export default function ProjectSelect({ value, onChange, allowAll, ...rest }) {
  const { data } = useProjectOptions();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      <option value="">{allowAll ? 'All projects' : 'Select project'}</option>
      {(data || []).map((p) => <option key={p._id} value={p._id}>{p.group?.name || 'Group'} - {p.title}</option>)}
    </Select>
  );
}
