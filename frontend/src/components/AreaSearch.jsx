import { useState, useRef, useEffect } from 'react';
import { Search, MapPin, AlertCircle, X } from 'lucide-react';
import { geocodingService } from '../services/geocodingService';
import './AreaSearch.css'; // We will create this simple CSS file or use inline styles. Let's use simple inline/utility classes if possible, but an AreaSearch.css is better.

export function AreaSearch({ onLocationSelect }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('idle'); // idle | loading | success | empty | error
  const [results, setResults] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Close dropdown when clicking outside
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const performSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setStatus('idle');
      setResults([]);
      setIsOpen(false);
      return;
    }

    setStatus('loading');
    setIsOpen(true);
    setErrorMessage('');

    try {
      const data = await geocodingService.search(trimmed);
      setResults(data);
      setStatus(data.length > 0 ? 'success' : 'empty');
    } catch (error) {
      if (error.name === 'AbortError' || error.message === 'AbortError') {
        // Cancelled, do nothing
        return;
      }
      setStatus('error');
      setErrorMessage(error.message || 'Failed to search location.');
      setResults([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performSearch();
    }
  };

  const handleSelect = (result) => {
    setQuery(result.name);
    setIsOpen(false);
    if (onLocationSelect) {
      onLocationSelect(result);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setStatus('idle');
    setIsOpen(false);
    inputRef.current?.focus();
    if (onLocationSelect) {
      onLocationSelect(null);
    }
  };

  return (
    <div className="area-search-container" ref={containerRef}>
      <div className="search-input-wrapper">
        <Search className="search-icon" size={18} />
        <input
          ref={inputRef}
          type="text"
          className="form-control"
          style={{ paddingLeft: '2.5rem', paddingRight: query ? '2.5rem' : '1rem', width: '100%', minWidth: '250px' }}
          placeholder="Search area or map location (e.g. Gangtok)..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Search for an area"
        />
        {query && (
          <button 
            type="button" 
            className="search-clear-btn" 
            onClick={clearSearch}
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
        <button 
          className="btn btn-primary search-submit-btn" 
          onClick={performSearch}
          disabled={status === 'loading'}
          aria-label="Submit search"
        >
          Search
        </button>
      </div>

      {isOpen && status !== 'idle' && (
        <div className="search-dropdown-menu">
          {status === 'loading' && (
            <div className="search-status-item text-muted">
              <span className="spinner"></span> Searching...
            </div>
          )}

          {status === 'empty' && (
            <div className="search-status-item text-muted">
              No places found for "{query}".
            </div>
          )}

          {status === 'error' && (
            <div className="search-status-item text-danger">
              <AlertCircle size={16} style={{ marginRight: '0.5rem', verticalAlign: 'text-bottom' }} />
              {errorMessage}
            </div>
          )}

          {status === 'success' && (
            <ul className="search-results-list" role="listbox">
              {results.map((result, index) => (
                <li 
                  key={result.id || result.place_id || `loc-${result.lat}-${result.lon}-${index}`}
                  className="search-result-item"
                  role="option"
                  aria-selected="false"
                  onClick={() => handleSelect(result)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSelect(result);
                  }}
                  tabIndex={0}
                >
                  <MapPin size={16} className="text-muted" style={{ marginRight: '0.75rem', flexShrink: 0 }} />
                  <span className="result-name">{result.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
