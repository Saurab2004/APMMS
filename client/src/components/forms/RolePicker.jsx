import { GraduationCap, Presentation, ShieldCheck, BadgeCheck, Crown } from 'lucide-react';
import { cx } from '../../utils/format.js';

export const ROLE_OPTIONS = [
  { key: 'student', label: 'Student', icon: GraduationCap, hint: 'Submit and track your project' },
  { key: 'supervisor', label: 'Supervisor', icon: Presentation, hint: 'Guide and review groups' },
  { key: 'coordinator', label: 'Coordinator', icon: ShieldCheck, hint: 'Head of department / admin' },
];
export const ADMIN_OPTION = { key: 'platform', label: 'Platform admin', icon: Crown, hint: 'Website owner - manages all institutions' };
export const EVALUATOR_OPTION = { key: 'evaluator', label: 'External evaluator', icon: BadgeCheck, hint: 'Invited by the coordinator' };

/** Big, clear role cards used on both the login and the register page. */
export default function RolePicker({ value, onChange, options = ROLE_OPTIONS, disabled = {} }) {
  return (
    <div className="role-cards" role="radiogroup" aria-label="Choose your role">
      {options.map((r) => {
        const Icon = r.icon;
        const off = !!disabled[r.key];
        return (
          <button key={r.key} type="button" role="radio" aria-checked={value === r.key} disabled={off} title={off ? disabled[r.key] : undefined}
            className={cx('role-card', value === r.key && 'selected')} onClick={() => onChange(r.key)}>
            <Icon size={22} aria-hidden="true" />
            <strong>{r.label}</strong>
            <small>{off ? disabled[r.key] : r.hint}</small>
          </button>
        );
      })}
    </div>
  );
}
