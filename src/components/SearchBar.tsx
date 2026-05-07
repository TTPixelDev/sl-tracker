import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2, MapPin } from 'lucide-react';
import { slService } from '../services/slService';
import { SearchResult, SLLineRoute } from '../types';
import { getTransportIcon } from '../utils/mapUtils';

interface SearchBarProps {
  onSelect: (res: SearchResult) => void;
  onClear: () => void;
  activeRoute: SLLineRoute | null;
  selectedRoutes: SLLineRoute[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  currentAgency: 'SL' | 'WAAB';
  stopPassages: Map<string, { time: string, stopped: boolean, duration?: string }>;
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSelect,
  searchQuery,
  onSearchChange,
  currentAgency,
  selectedRoutes,
}) => {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (searchQuery && searchQuery.trim().length > 0) {
        setLoading(true);
        try {
          const res = await slService.search(searchQuery, currentAgency);
          
          let finalResults: SearchResult[] = [];

          if (selectedRoutes.length > 0) {
              const matchingLines = res.filter((r: any) => r.type === 'line');
              const queryLower = searchQuery.toLowerCase();
              const matchedStops = new Map<string, SearchResult>();
              
              selectedRoutes.forEach(route => {
                  route.stops.forEach(stop => {
                      if (stop.name.toLowerCase().includes(queryLower)) {
                          if (!matchedStops.has(stop.id)) {
                              matchedStops.set(stop.id, {
                                  type: 'stop',
                                  id: stop.id,
                                  title: stop.name,
                                  subtitle: currentAgency === 'WAAB' ? 'Brygga' : 'Hållplats',
                                  agency: stop.agency || 'SL'
                              });
                          }
                      }
                  });
              });
              finalResults = [...matchingLines, ...Array.from(matchedStops.values())];
          } else {
              finalResults = res;
          }

          setResults(finalResults);
          setShowResults(true);
        } catch (e) {
          console.error("Search failed", e);
        } finally {
          setLoading(false);
        }
      } else {
        setResults([]);
        setShowResults(false);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [searchQuery, currentAgency, selectedRoutes]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleResultClick = (res: SearchResult) => {
    onSelect(res);
    setShowResults(false);
    onSearchChange('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      handleResultClick(results[0]);
    }
  };

  return (
    <div ref={searchRef} className="relative w-full">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          ) : (
            <Search className="h-5 w-5 text-slate-400" />
          )}
        </div>
        <input
          type="text"
          className="block w-full pl-10 pr-10 py-3 border border-white/10 rounded-2xl leading-5 bg-slate-900/95 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 sm:text-sm backdrop-blur-xl shadow-2xl transition-all"
          placeholder={currentAgency === 'WAAB' ? "Sök linje eller brygga..." : "Sök linje eller hållplats..."}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
              if (searchQuery.trim().length > 0) setShowResults(true);
          }}
        />
        {searchQuery && (
          <button
            onClick={() => {
                onSearchChange('');
                setResults([]);
            }}
            className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute mt-2 w-full bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl max-h-[60vh] overflow-y-auto z-[2000] animate-in fade-in slide-in-from-top-2 duration-200">
          {results.map((res, index) => {
              const TransportIcon = getTransportIcon(res.title, res.agency);
              return (
              <button
                key={res.type + '-' + res.id + '-' + index}
                onClick={() => handleResultClick(res)}
                className="w-full text-left px-4 py-3 hover:bg-white/10 transition-colors flex items-center gap-3 border-b border-white/5 last:border-0 group"
              >
                <div className="shrink-0">
                  {res.type === 'stop' ? (
                    <MapPin className="w-5 h-5 text-emerald-500" />
                  ) : (
                    <TransportIcon className="w-5 h-5 text-slate-300" />
                  )}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-bold text-white group-hover:text-blue-200 transition-colors truncate">
                      {res.title}
                  </span>
                  {res.subtitle && (
                      <span className="text-xs text-slate-400 truncate">
                          {res.subtitle}
                      </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  );
};

export default SearchBar;