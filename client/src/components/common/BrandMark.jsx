import { GraduationCap } from 'lucide-react';

/** The one APMMS logo, used on every screen (same mark as public/favicon.svg). */
export default function BrandMark({ size = 19, style }) {
  return <span className="brand-mark" style={style}><GraduationCap size={size} aria-hidden="true" /></span>;
}
