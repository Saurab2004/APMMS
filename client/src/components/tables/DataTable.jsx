import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, Loading, ErrorState, EmptyState } from '../common/ui.jsx';
import { cx } from '../../utils/format.js';
import { Button } from '../common/ui.jsx';

export function Pagination({ meta, onPage }) {
  if (!meta || !meta.total) return null;
  const { page, pages, total, limit } = meta;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="pagination">
      <span>{from}-{to} of {total}</span>
      <div className="row" style={{ gap: 6 }}>
        <Button variant="secondary" size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">Prev</Button>
        <span>Page {page} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">Next<ChevronRight size={15} /></Button>
      </div>
    </div>
  );
}

/**
 * Reusable admin table: sortable headers, loading / error / empty states, pagination.
 * columns: [{ key, header, render?(row), sortKey?, className?, align? }]
 */
export default function DataTable({ columns, rows, loading, error, onRetry, meta, onPage, sort, onSort, empty, rowKey = '_id', minWidth }) {
  return (
    <Card>
      {loading && !rows ? <Loading /> : error && !rows ? <ErrorState message={error} onRetry={onRetry} /> : !rows?.length ? (
        empty || <EmptyState title="No results">Try changing the filters.</EmptyState>
      ) : (
        <>
          <div className="table-wrap" style={loading ? { opacity: 0.6 } : undefined}>
            <table className="table" style={minWidth ? { minWidth } : undefined}>
              <thead>
                <tr>
                  {columns.map((c) => {
                    const active = !!c.sortKey && sort?.key === c.sortKey;
                    return (
                      <th
                        key={c.key}
                        className={cx(c.sortKey && 'sortable', c.className)}
                        style={c.align ? { textAlign: c.align } : undefined}
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                        onClick={c.sortKey && onSort ? () => onSort({ key: c.sortKey, dir: active && sort.dir === 'desc' ? 'asc' : 'desc' }) : undefined}
                      >
                        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          {c.header}
                          {active && (sort.dir === 'asc' ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r[rowKey]}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.className} style={c.align ? { textAlign: c.align } : undefined}>{c.render ? c.render(r) : r[c.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination meta={meta} onPage={onPage} />
        </>
      )}
    </Card>
  );
}
