import { useState, useCallback } from 'react';

/** Tiny form helper: values, change handlers, and server-side field errors. */
export function useForm(initial = {}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});

  const set = useCallback((name, value) => {
    setValues((v) => ({ ...v, [name]: value }));
    setErrors((e) => (e[name] ? { ...e, [name]: undefined } : e));
  }, []);

  const bind = (name) => ({
    name,
    value: values[name] ?? '',
    onChange: (e) => set(name, e.target.type === 'checkbox' ? e.target.checked : e.target.value),
  });

  const applyError = (err) => {
    if (err?.details && typeof err.details === 'object' && !Array.isArray(err.details)) setErrors(err.details);
  };

  return { values, setValues, errors, setErrors, set, bind, applyError, reset: () => { setValues(initial); setErrors({}); } };
}
