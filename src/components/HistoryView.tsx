import React, { useState, useEffect, useCallback } from 'react';
import { Search, Calendar, Clock as ClockIcon, MapPin, ChevronUp, ChevronDown, CheckCircle2, XCircle, Info, RefreshCcw, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { StopEvent, SearchResult } from '../types';
import { slService } from '../services/slService';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getLineColor, getTransportIcon } from '../utils/mapUtils';

function cn(...inputs: any[]) {
  return twMerge(clsx(inputs));
}

const formatSwedishDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const formatted = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  } catch (e) {
    return dateStr;
  }
};

const formatGtfsTime = (timeStr: string | null) => {
  if (!timeStr) return '--:--';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0]);
  const m = parts[1] || '00';
  if (h >= 24) h -= 24;
  return `${h.toString().padStart(2, '0')}:${m}`;
};

const formatActualTime = (timeStr: string | null) => {
  if (!timeStr) return '--:--:--';
  const parts = timeStr.split(':');
  let h = parseInt(parts[0]);
  const m = parts[1] || '00';
  const s = parts[2] || '00';
  if (h >= 24) h -= 24;
  return `${h.toString().padStart(2, '0')}:${m}:${s}`;
};

const getDiff = (scheduled: string, actual: string | null) => {
  if (!actual || !scheduled) return null;
  const toSec = (t: string) => {
    const parts = t.split(':').map(Number);
    const h = parts[0] >= 24 ? parts[0] - 24 : parts[0];
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 3600 + m * 60 + s;
  };
  let diffSecs = toSec(actual) - toSec(scheduled);
  if (diffSecs < -43200) diffSecs += 86400; 
  if (diffSecs > 43200) diffSecs -= 86400;  

  const absDiff = Math.abs(diffSecs);
  if (diffSecs === 0) return { text: 'I tid', color: 'text-emerald-500' };
  
  const sign = diffSecs > 0 ? '+' : '-';
  if (absDiff < 60) {
    return { text: `${sign}${absDiff}s`, color: diffSecs > 0 ? 'text-red-500' : 'text-blue-500' };
  }
  const mins = Math.floor(absDiff / 60);
  const secs = absDiff % 60;
  return { text: `${sign}${mins}m ${secs}s`, color: diffSecs > 0 ? 'text-red-500' : 'text-blue-500' };
};

const getDuration = (arrival: string | null, departure: string | null) => {
  if (!arrival || !departure) return null;
  const toSec = (t: string) => {
    const parts = t.split(':').map(Number);
    const h = parts[0] >= 24 ? parts[0] - 24 : parts[0];
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 3600 + m * 60 + s;
  };
  let diffSecs = toSec(departure) - toSec(arrival);
  if (diffSecs < -43200) diffSecs += 86400; 
  if (diffSecs < 0) return { text: '0s' }; 
  
  if (diffSecs < 60) {
    return { text: `${diffSecs}s` };
  }
  const mins = Math.floor(diffSecs / 60);
  const secs = diffSecs % 60;
  return { text: `${mins}m ${secs}s` };
};

export default function HistoryView() {
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return format(d, 'yyyy-MM-dd');
  });
  const [time, setTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 1);
    return format(d, 'HH:mm');
  });
  const [historyDays, setHistoryDays] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<SearchResult | null>(null);
  const [selectedStop, setSelectedStop] = useState<SearchResult | null>(null);
  const [lineStops, setLineStops] = useState<SearchResult[]>([]);
  const [events, setEvents] = useState<StopEvent[]>([]);
  const eventsRef = React.useRef<StopEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    const fetchRange = async () => {
      try {
        const res = await fetch('/api/data-range');
        if (res.ok) {
          const data = await res.json();
          setHistoryDays(data.days);
        }
      } catch (err) {}
    };
    fetchRange();
  }, []);

  useEffect(() => {
    if (selectedLine) {
      setSelectedStop(null);
      slService.getLineStops(selectedLine.id).then((stops: any) => {
        const stopGroups = new Map<string, string[]>();
        stops.forEach((s: any) => {
          const group = stopGroups.get(s.name) || [];
          group.push(s.id);
          stopGroups.set(s.name, group);
        });
        const uniqueStops: SearchResult[] = Array.from(stopGroups.entries()).map(([name, ids]) => ({
          type: 'stop',
          id: ids.join(','),
          title: name,
          subtitle: 'Hållplats'
        }));
        setLineStops(uniqueStops);
      });
    } else {
      setLineStops([]);
      setSelectedStop(null);
    }
  }, [selectedLine]);

  const fetchHistory = useCallback(async (direction: 'next' | 'prev' = 'next', offset = 0) => {
    if (!selectedLine || !selectedStop) return;

    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        date,
        lineId: selectedLine.id,
        stopId: selectedStop.id,
        time,
        offset: '0',
        limit: '5',
        direction
      });

      const currentEvents = eventsRef.current;
      if (offset > 0 && currentEvents.length > 0) {
        if (direction === 'next') {
          const last = currentEvents[currentEvents.length - 1];
          params.set('refDate', last.date);
          params.set('refSdm', last.scheduledDepartureMinutes.toString());
          const sameAsLast = currentEvents.filter(e => e.date === last.date && e.scheduledDepartureMinutes === last.scheduledDepartureMinutes).length;
          params.set('offset', sameAsLast.toString());
        } else {
          const first = currentEvents[0];
          params.set('refDate', first.date);
          params.set('refSdm', first.scheduledDepartureMinutes.toString());
          const sameAsFirst = currentEvents.filter(e => e.date === first.date && e.scheduledDepartureMinutes === first.scheduledDepartureMinutes).length;
          params.set('offset', sameAsFirst.toString());
        }
      }

      const res = await fetch(`/api/history?${params}`);
      if (!res.ok) throw new Error('Failed to fetch data');
      const data = await res.json();

      if (direction === 'next') {
        if (offset === 0) setEvents(data);
        else {
          setEvents(prev => {
            const existingIds = new Set(prev.map(e => e.id));
            return [...prev, ...data.filter((e: any) => !existingIds.has(e.id))];
          });
        }
      } else {
        setEvents(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          return [...data.filter((e: any) => !existingIds.has(e.id)), ...prev];
        });
      }
    } catch (err) {
      setError('Kunde inte hämta data från databasen. Kontrollera din anslutning.');
    } finally {
      setIsLoading(false);
    }
  }, [date, time, selectedLine, selectedStop]);

  useEffect(() => {
    if (selectedLine && selectedStop) fetchHistory('next', 0);
    else setEvents([]);
  }, [selectedLine, selectedStop, date, time, fetchHistory]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchHistory('next', 0);
  };

  return (
    <div className="absolute inset-0 bg-[#F0F2F5] overflow-y-auto w-full z-[100] top-0 pt-24 text-slate-900 font-sans pb-20">
      <main className="max-w-6xl mx-auto px-4">
        {/* Search Panel */}
        <section className="bg-white rounded-3xl shadow-sm border border-slate-200 p-6 mb-8 mt-2">
          <form onSubmit={handleSearch} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Datum</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all appearance-none text-sm font-semibold text-slate-700"
                />
              </div>
            </div>
            <div className="space-y-1.5 flex-1 min-w-0">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Från tid</label>
              <div className="relative">
                <ClockIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all appearance-none text-sm font-semibold text-slate-700"
                />
              </div>
            </div>
            <SearchInput
              label="Linje"
              icon={<Search className="w-4 h-4" />}
              placeholder="Ex: 4, 172..."
              type="line"
              value={selectedLine}
              onSelect={setSelectedLine}
            />
            <SearchInput
              label="Hållplats"
              icon={<MapPin className="w-4 h-4" />}
              placeholder={selectedLine ? "Välj hållplats..." : "Välj linje först"}
              type="stop"
              value={selectedStop}
              onSelect={setSelectedStop}
              disabled={!selectedLine}
              predefinedResults={lineStops}
            />
          </form>
        </section>

        {/* Info Message */}
        {events.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-2xl flex items-start gap-4 mb-8 text-blue-900 shadow-sm">
            <Info className="w-5 h-5 shrink-0 text-blue-500 mt-0.5" />
            <div className="text-sm">
              <strong className="text-blue-900 font-bold block mb-0.5">Om saknad information</strong>
              <p className="text-blue-800">Utebliven information för en avgång betyder inte nödvändigtvis att den var inställd. Det beror oftast på tekniska problem, till exempel att bussen inte kunnat loggas in eller spåras korrekt under sin tur.</p>
            </div>
          </div>
        )}

        {/* Results */}
        {selectedLine && selectedStop && (
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between px-2 mb-4 gap-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Sökdatum: <span className="text-blue-600 font-extrabold">{formatSwedishDate(date)}</span>
              </h2>
            </div>
            {events.length > 0 && (
              <span className="text-xs text-slate-400 font-medium italic">
                Visar avgångar i anslutning till {time} och framåt/bakåt.
              </span>
            )}
          </div>
        )}

        <section className="space-y-4">
          <AnimatePresence mode="popLayout">
            {events.length > 0 && (() => {
              const [h, m] = time.split(':').map(Number);
              const searchMin = h * 60 + m;
              const loadedPrev = events.filter(e => e.scheduledDepartureMinutes < searchMin).length;
              return (
                <motion.button key="load-prev" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} onClick={() => fetchHistory('prev', loadedPrev)} className="w-full py-4 flex items-center justify-center gap-2 text-blue-600 font-bold hover:bg-blue-50 rounded-2xl transition-colors border-2 border-dashed border-blue-100 mb-2" disabled={isLoading}>
                  <ChevronUp className="w-5 h-5" /> Visa tidigare avgångar
                </motion.button>
              );
            })()}

            {(() => {
              let lastDate = "";
              return events.map((event, idx) => {
                const showDateHeader = event.date !== lastDate;
                if (showDateHeader) {
                  lastDate = event.date;
                }
                return (
                  <React.Fragment key={event.id ? event.id : 'event-' + event.tripId + '-' + idx}>
                    {showDateHeader && (
                      <div className="pt-6 pb-2 first:pt-0 flex items-center gap-3">
                        <span className="text-xs font-black text-slate-500 bg-slate-200/50 px-3 py-1.5 rounded-xl flex items-center gap-1.5 border border-slate-300/30">
                          <Calendar className="w-3.5 h-3.5" />
                          {formatSwedishDate(event.date)}
                        </span>
                        <div className="h-[1px] bg-slate-200 flex-1"></div>
                      </div>
                    )}
                    <EventCard event={event} lineName={selectedLine?.title ? selectedLine.title : 'Linje ' + event.line} />
                  </React.Fragment>
                );
              });
            })()}

            {events.length > 0 && (() => {
              const [h, m] = time.split(':').map(Number);
              const searchMin = h * 60 + m;
              const loadedNext = events.filter(e => e.scheduledDepartureMinutes >= searchMin).length;
              return (
                <motion.button key="load-next" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={() => fetchHistory('next', loadedNext)} className="w-full py-4 flex items-center justify-center gap-2 text-blue-600 font-bold hover:bg-blue-50 rounded-2xl transition-colors border-2 border-dashed border-blue-100 mt-2" disabled={isLoading}>
                  <ChevronDown className="w-5 h-5" /> Visa senare avgångar
                </motion.button>
              );
            })()}

            {events.length === 0 && !isLoading && selectedLine && selectedStop && (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-20 bg-white rounded-3xl border border-slate-200 shadow-sm">
                <RefreshCcw className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-slate-700">Inga avgångar hittades</h3>
                <p className="text-slate-500 mt-2 px-4 max-w-xl mx-auto">
                  Det finns ingen sparad historik för <span className="font-semibold text-slate-700">{selectedLine.title}</span> vid <span className="font-semibold text-slate-700">{selectedStop.title}</span> den <span className="font-bold text-blue-600">{formatSwedishDate(date)}</span> från kl. <span className="font-semibold text-slate-700">{time}</span> under den valda tidsperioden.
                </p>
              </motion.div>
            )}

            {isLoading && events.length === 0 && (
              <div key="loading" className="space-y-4">
                {[1, 2, 3].map(i => <div key={i} className="bg-white h-32 rounded-3xl animate-pulse border border-slate-200" />)}
              </div>
            )}
            
            {error && (
              <div key="error" className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3">
                <XCircle className="w-5 h-5" />
                <span className="font-bold">{error}</span>
              </div>
            )}
          </AnimatePresence>
        </section>

        {/* Footer Statistics */}
        <footer className="mt-12 flex items-center justify-between text-xs text-slate-500 font-bold uppercase tracking-widest border-t border-slate-200 pt-6">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5"><Activity className="w-4 h-4 text-slate-400" /> Visar {events.length} träffar</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Info className="w-4 h-4 text-slate-400" /> Sparad Historik: {historyDays !== null ? `${historyDays} ${historyDays === 1 ? 'dag' : 'dagar'}` : 'hämtar...'}
          </div>
        </footer>
      </main>
    </div>
  );
}

const EventCard: React.FC<{ event: StopEvent, lineName: string }> = ({ event, lineName }) => {
  const Icon = getTransportIcon(lineName);
  const colorHex = getLineColor(lineName, event.agency);
  const lineNumber = lineName.replace('Linje ', '').trim();
  const diff = getDiff(event.scheduledDeparture, event.actualDeparture);
  const stopDuration = getDuration(event.actualArrival, event.actualDeparture);
  const isDelayed = diff && diff.text.startsWith('+');

  const isStopped = (() => {
    if (event.stopped) return true;
    if (!event.actualArrival || !event.actualDeparture) return false;
    const toSec = (t: string) => {
      const parts = t.split(':').map(Number);
      return (parts[0] >= 24 ? parts[0] - 24 : parts[0]) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
    };
    let duration = toSec(event.actualDeparture) - toSec(event.actualArrival);
    if (duration < -43200) duration += 86400;
    return duration >= 25;
  })();
  
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-5 rounded-3xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1.5 h-full" style={{ backgroundColor: colorHex }} />
      <div className="flex flex-col md:flex-row gap-4 items-center pl-2">
        <div className="flex items-center gap-4 w-full md:w-1/3">
          <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center text-white shrink-0 shadow-lg" style={{ backgroundColor: colorHex }}>
            <Icon className="w-5 h-5 mb-0.5" />
            <span className={cn("font-black leading-none", lineNumber.length > 3 ? "text-[10px]" : "text-sm")}>{lineNumber}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Destination</div>
            <h3 className="font-bold text-slate-800 text-lg leading-tight truncate pr-2" title={event.destinationName}>
              {event.destinationName || 'Destination okänd'}
            </h3>
          </div>
        </div>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 w-full md:w-[80%] overflow-x-auto">
          <TimeInfo label="Tidtabell" time={formatGtfsTime(event.scheduledDeparture)} />
          <TimeInfo label="Ankomst" time={formatActualTime(event.actualArrival)} highlight />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Uppehåll</span>
            <span className="text-base font-mono font-bold truncate text-slate-500">{stopDuration ? stopDuration.text : '--'}</span>
          </div>
          <TimeInfo label="Avgång" time={formatActualTime(event.actualDeparture)} highlight status={isDelayed ? 'warning' : (diff && diff.text === 'I tid' ? 'success' : 'normal')} />
          <div className="flex flex-col">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avvikelse</span>
            <span className={cn("text-base font-mono font-bold truncate", diff?.color || "text-slate-400")}>{diff ? diff.text : '--'}</span>
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</span>
            <div className={cn("flex items-center gap-1.5 font-bold text-[10px] px-2 py-1 rounded-full w-fit shrink-0", isStopped ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600")}>
              {isStopped ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
              <span className="truncate">{isStopped ? 'Stannade' : 'Passerade'}</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function TimeInfo({ label, time, highlight, status }: { label: string, time: string, highlight?: boolean, status?: 'success' | 'warning' | 'normal' }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</span>
      <span className={cn("text-base font-mono font-bold tracking-tight", highlight ? "text-slate-800" : "text-slate-400", status === 'warning' && "text-red-500", status === 'success' && "text-emerald-500")}>
        {time}
      </span>
    </div>
  );
}

function SearchInput({ label, icon, placeholder, value, onSelect, type, disabled, predefinedResults }: any) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  const formatTitle = (title: string) => type === 'line' ? title.replace(/^Linje\s+/i, '').trim() : title;

  useEffect(() => {
    if (disabled) return;
    if (predefinedResults !== undefined) {
      if (query.length === 0) setResults(predefinedResults);
      else setResults(predefinedResults.filter((r: any) => r.title.toLowerCase().includes(query.toLowerCase())));
      return;
    }
    if (query.length < 1) { setResults([]); return; }
    
    const handler = setTimeout(async () => {
      try {
        let data = await slService.search(query);
        if (type === 'line') {
          data = data.filter((d: any) => d.type === 'line').sort((a: any, b: any) => {
            const aNum = parseInt(a.title.replace('Linje ', ''));
            const bNum = parseInt(b.title.replace('Linje ', ''));
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return a.title.localeCompare(b.title);
          });
        } else {
          data = data.filter((d: any) => d.type === 'stop');
        }
        setResults(data);
      } catch (e) {}
    }, 150);
    return () => clearTimeout(handler);
  }, [query, type, predefinedResults, disabled]);

  return (
    <div className={cn("space-y-1.5 relative", disabled && "opacity-50")}>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">{label}</label>
      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">{icon}</div>
        <input
          type="text"
          value={value ? formatTitle(value.title) : query}
          onChange={(e) => { if (value) onSelect(null); setQuery(e.target.value); setIsOpen(true); }}
          onFocus={() => setIsOpen(true)}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isOpen && results.length > 0 && !value && !disabled) {
              e.preventDefault();
              onSelect(results[0]);
              setIsOpen(false);
              setQuery('');
            }
          }}
          className="w-full bg-slate-50 border border-slate-200 py-3 pl-10 pr-4 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all placeholder:text-slate-300 disabled:cursor-not-allowed text-sm font-semibold"
        />
        {value && !disabled && (
          <button type="button" tabIndex={-1} onClick={() => { onSelect(null); setQuery(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {isOpen && results.length > 0 && !value && !disabled && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-0 right-0 mt-2 bg-white rounded-2xl shadow-xl border border-slate-200 z-[200] max-h-60 overflow-y-auto">
            {results.map((res: any, ridx: number) => (
              <button key={type + '-res-' + (res.id || ridx)} type="button" onClick={() => { onSelect(res); setIsOpen(false); setQuery(''); }} className="w-full px-4 py-3 text-left hover:bg-slate-50 flex items-center justify-between border-b border-slate-50 last:border-0 transition-colors">
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800">{formatTitle(res.title)}</span>
                  <span className="text-xs text-slate-400 font-medium">{res.subtitle}</span>
                </div>
                <div className="bg-blue-50 p-1.5 rounded-lg"><ChevronDown className="w-3.5 h-3.5 text-blue-500 rotate-[-90deg]" /></div>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      {isOpen && !value && !disabled && <div className="fixed inset-0 z-[190]" onClick={() => setIsOpen(false)} />}
    </div>
  );
}