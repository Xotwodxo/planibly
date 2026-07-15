import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Dialog } from '../../components/ui/Dialog';
import { plannerRepository } from '../../data/plannerRepository';
import type { SearchFilters, SearchResult, SearchResultType } from '../../data/plannerTypes';

const SEARCH_TYPES: { value: SearchResultType; label: string }[] = [
  { value: 'area', label: 'Areas' },
  { value: 'list', label: 'Lists/Projects' },
  { value: 'task', label: 'Tasks' },
  { value: 'step', label: 'Steps' },
  { value: 'tag', label: 'Tags' },
];

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    types: SEARCH_TYPES.map((type) => type.value),
    includeCompleted: false,
    includeArchived: false,
  });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void plannerRepository
      .search(query, filters)
      .then((next) => {
        if (current) {
          setResults(next);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (current) {
          setError(caughtError instanceof Error ? caughtError.message : 'Search could not run.');
        }
      });
    return () => {
      current = false;
    };
  }, [filters, query]);

  function toggleType(type: SearchResultType) {
    setFilters((current) => ({
      ...current,
      types: current.types.includes(type)
        ? current.types.filter((candidate) => candidate !== type)
        : [...current.types, type],
    }));
  }

  return (
    <Dialog
      title="Search Planibly"
      description="Search stays on this device. Use exact words or part of a name."
      onClose={onClose}
    >
      <label className="field">
        <span>Search</span>
        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Tasks, steps, tags, lists…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <fieldset className="search-filters">
        <legend>Result types</legend>
        <div>
          {SEARCH_TYPES.map((type) => (
            <label key={type.value}>
              <input
                type="checkbox"
                checked={filters.types.includes(type.value)}
                onChange={() => toggleType(type.value)}
              />
              {type.label}
            </label>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={filters.includeCompleted}
            onChange={(event) =>
              setFilters((current) => ({ ...current, includeCompleted: event.target.checked }))
            }
          />
          Include completed content
        </label>
        <label>
          <input
            type="checkbox"
            checked={filters.includeArchived}
            onChange={(event) =>
              setFilters((current) => ({ ...current, includeArchived: event.target.checked }))
            }
          />
          Include archived projects
        </label>
      </fieldset>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="search-results" aria-live="polite">
        {query.trim() && results.length === 0 ? (
          <p className="task-detail-empty">No matching active content.</p>
        ) : null}
        {results.length > 0 ? (
          <ul>
            {results.map((result) => (
              <li key={`${result.type}-${result.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    void navigate(result.url);
                    onClose();
                  }}
                >
                  <span className="search-result__type">{result.type}</span>
                  <strong>{result.title}</strong>
                  <span>{result.location}</span>
                  {result.archived ? <span>Archived</span> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
