import { useState } from 'react';
import { useAsync, useDebounced } from './useAsync.js';
import { getPaged } from '../services/api.js';

/** Server-side paging + search + sort + filters for list pages. */
export function usePaged(url, { initialFilters = {}, limit = 15, initialSort } = {}) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [sort, setSort] = useState(initialSort || null);
  const dq = useDebounced(q);

  const params = { page, limit, q: dq || undefined, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v !== undefined && v !== null)) };
  if (sort) { params.sort = sort.key; params.dir = sort.dir; }
  const state = useAsync(() => getPaged(url, params), [url, page, dq, JSON.stringify(filters), JSON.stringify(sort)]);

  return {
    rows: state.data?.items, meta: state.data?.meta, loading: state.loading, error: state.error, reload: state.reload,
    page, setPage, q, setQ: (v) => { setQ(v); setPage(1); },
    filters, setFilter: (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); },
    sort, setSort: (s) => { setSort(s); setPage(1); },
  };
}
