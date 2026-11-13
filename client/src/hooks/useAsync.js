import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from '../services/api.js';

/** Runs an async function, tracks loading/error, ignores out-of-date answers. */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: null, loading: immediate, error: null });
  const ticket = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args) => {
    const id = ++ticket.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current(...args);
      if (id === ticket.current) setState({ data, loading: false, error: null });
      return data;
    } catch (e) {
      if (id === ticket.current) setState((s) => ({ ...s, loading: false, error: errMsg(e) }));
      return undefined;
    }
  }, []);

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
