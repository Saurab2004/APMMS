import { Loading, ErrorState } from './ui.jsx';

/** For list pages that fetch with usePaged: shows loading / error / empty, otherwise the children. */
export default function DataState({ loading, error, rows, onRetry, empty, children }) {
  if (loading && !rows) return <Loading />;
  if (error && !rows) return <ErrorState message={error} onRetry={onRetry} />;
  if (rows && !rows.length) return empty || null;
  return <div style={loading ? { opacity: 0.6 } : undefined}>{children}</div>;
}
