import { useState, useEffect, useCallback } from 'react'
import {
  listSessions,
  getSessionHistory,
  type Session,
  type SessionMessage,
} from '../api'
import './SessionsPanel.css'

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTokens(tokens?: number): string {
  if (!tokens) return '-';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

function getMessageText(msg: SessionMessage): string {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const textPart = msg.content.find(p => p.type === 'text');
    return textPart?.text || '[complex content]';
  }
  if (msg.raw) return msg.raw;
  return '[no content]';
}

interface SessionsPanelProps {
  className?: string;
}

export default function SessionsPanel({ className = '' }: SessionsPanelProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [history, setHistory] = useState<SessionMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<number | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      setError(null);
      const data = await listSessions(activeFilter || undefined);
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions');
    } finally {
      setLoading(false);
    }
  }, [activeFilter]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleSelectSession = async (sessionKey: string) => {
    if (selectedSession === sessionKey) {
      setSelectedSession(null);
      setHistory([]);
      return;
    }

    setSelectedSession(sessionKey);
    setHistoryLoading(true);
    setHistory([]);

    try {
      const data = await getSessionHistory(sessionKey, 30);
      setHistory(data.messages || []);
    } catch (err) {
      console.error('Failed to load history:', err);
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const filterOptions = [
    { label: 'All', value: null },
    { label: '1h', value: 60 },
    { label: '24h', value: 1440 },
    { label: '7d', value: 10080 },
  ];

  return (
    <div className={`sessions-panel ${className}`}>
      <div className="sessions-header">
        <h3>Sessions</h3>
        <div className="sessions-filters">
          {filterOptions.map(opt => (
            <button
              key={opt.label}
              className={`filter-btn ${activeFilter === opt.value ? 'active' : ''}`}
              onClick={() => {
                setActiveFilter(opt.value);
                setLoading(true);
              }}
            >
              {opt.label}
            </button>
          ))}
          <button className="refresh-btn" onClick={() => { setLoading(true); fetchSessions(); }}>
            ↻
          </button>
        </div>
      </div>

      {error && <div className="sessions-error">{error}</div>}

      {loading ? (
        <div className="sessions-loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div className="sessions-empty">No sessions found</div>
      ) : (
        <div className="sessions-list">
          {sessions.map(session => (
            <div key={session.key} className="session-item-wrapper">
              <div
                className={`session-item ${selectedSession === session.key ? 'selected' : ''}`}
                onClick={() => handleSelectSession(session.key)}
              >
                <div className="session-main">
                  <span className="session-kind">{session.kind}</span>
                  <span className="session-key">{session.key}</span>
                </div>
                <div className="session-meta">
                  <span className="session-time">{formatTimeAgo(session.ageMs)}</span>
                  <span className="session-tokens">{formatTokens(session.totalTokens)} tokens</span>
                  {session.model && <span className="session-model">{session.model}</span>}
                </div>
              </div>
              
              {selectedSession === session.key && (
                <div className="session-history">
                  {historyLoading ? (
                    <div className="history-loading">Loading history...</div>
                  ) : history.length === 0 ? (
                    <div className="history-empty">No messages found</div>
                  ) : (
                    <div className="history-messages">
                      {history.slice(-20).map((msg, idx) => (
                        <div key={idx} className={`history-message ${msg.role || 'unknown'}`}>
                          <span className="message-role">{msg.role || '?'}</span>
                          <span className="message-content">
                            {getMessageText(msg).slice(0, 200)}
                            {getMessageText(msg).length > 200 && '...'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="sessions-footer">
        {sessions.length} session{sessions.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
