import { useId, useRef, useState } from 'react';
import { Search, UploadCloud, FileText, X } from 'lucide-react';
import { cx, fmtBytes } from '../../utils/format.js';

/** Label + control + error/help text, wired together for screen readers. */
export function Field({ label, error, help, required, className, children }) {
  const id = useId();
  const child = children && typeof children === 'object' && 'props' in children
    ? { ...children, props: { ...children.props, id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error || help ? `${id}-d` : undefined } }
    : children;
  return (
    <div className={cx('field', className)}>
      {label && <label htmlFor={id}>{label}{required && <span className="req" aria-hidden="true">*</span>}</label>}
      {child}
      {error ? <span className="error-text" id={`${id}-d`}>{error}</span> : help ? <span className="help" id={`${id}-d`}>{help}</span> : null}
    </div>
  );
}

export const Input = ({ invalid, className, ...p }) => <input className={cx('input', invalid && 'invalid', className)} {...p} />;
export const TextArea = ({ invalid, className, ...p }) => <textarea className={cx('textarea', invalid && 'invalid', className)} {...p} />;
export const Select = ({ invalid, className, children, ...p }) => <select className={cx('select', invalid && 'invalid', className)} {...p}>{children}</select>;
export const Check = ({ label, ...p }) => <label className="check"><input type="checkbox" {...p} /><span>{label}</span></label>;

export function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="search">
      <Search size={17} aria-hidden="true" />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </div>
  );
}

/**
 * File picker with drag & drop and client-side checks (size/type).
 * The server repeats every check - this only gives faster feedback.
 */
export function FileInput({ label, accept = ['pdf', 'docx'], multiple, maxMB = 10, files, onChange, help, error }) {
  const inputRef = useRef(null);
  const [drag, setDrag] = useState(false);
  const [problem, setProblem] = useState('');
  const list = files || [];

  const take = (picked) => {
    const arr = [...picked];
    for (const f of arr) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (!accept.includes(ext)) return setProblem(`".${ext}" files are not allowed. Allowed: ${accept.join(', ')}`);
      if (f.size > maxMB * 1024 * 1024) return setProblem(`${f.name} is larger than ${maxMB} MB`);
      if (f.size === 0) return setProblem(`${f.name} is empty`);
    }
    setProblem('');
    onChange(multiple ? [...list, ...arr] : arr.slice(0, 1));
  };
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));

  return (
    <div className="field">
      {label && <span className="label">{label}</span>}
      <div
        className={cx('dropzone', drag && 'drag')}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
      >
        <UploadCloud size={28} aria-hidden="true" />
        <div><strong>Choose {multiple ? 'files' : 'a file'}</strong> or drop here</div>
        <div className="help">{accept.map((a) => a.toUpperCase()).join(', ')} - up to {maxMB} MB</div>
        <input ref={inputRef} type="file" hidden multiple={multiple} accept={accept.map((a) => `.${a}`).join(',')} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      </div>
      {list.map((f, i) => (
        <div className="file-chip" key={`${f.name}-${i}`}>
          <FileText size={18} aria-hidden="true" />
          <span className="name">{f.name}</span>
          <span className="help">{fmtBytes(f.size)}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(i)} aria-label={`Remove ${f.name}`}><X size={14} /></button>
        </div>
      ))}
      {(problem || error) ? <span className="error-text">{problem || error}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}
