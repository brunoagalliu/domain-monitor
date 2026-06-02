import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { getToken, clearToken, api } from './lib/api';

import LoginPage        from './pages/LoginPage';
import DashboardPage    from './pages/DashboardPage';
import CategoriesPage   from './pages/CategoriesPage';
import LogsPage         from './pages/LogsPage';
import FunnelsPage      from './pages/FunnelsPage';
import FunnelDetailPage from './pages/FunnelDetailPage';
import DomainsPage      from './pages/DomainsPage';
import LandersPage      from './pages/LandersPage';
import HistoryPage      from './pages/HistoryPage';

function RequireAuth({ children }) {
  return getToken() ? children : <Navigate to="/login" replace />;
}

function BrowserStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const load = () => api.get('/browser-status').then(setStatus).catch(() => {});
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  if (!status) return null;

  const dotColor = status.browserReady ? 'bg-green-400' : 'bg-gray-300';

  return (
    <div className="mt-4 px-3 py-2 rounded-md bg-gray-50 border border-gray-100">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />
        <span className="text-xs text-gray-600 font-medium">
          {status.browserReady ? 'Browser scanner ready' : 'Browser scanner offline'}
        </span>
      </div>
      {status.scanRunning && (
        <p className="text-xs text-blue-500 mt-0.5 pl-4">Scan running…</p>
      )}
      {status.lastError && (
        <p className="text-xs text-red-500 mt-0.5 pl-4 truncate" title={status.lastError}>
          {status.lastError}
        </p>
      )}
      <p className="text-xs text-gray-400 mt-0.5 pl-4">
        {status.priority} priority · {status.suspended} suspended
      </p>
    </div>
  );
}

const ICON = {
  dashboard: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  categories: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
    </svg>
  ),
  logs: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  ),
  funnels: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  domains: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
    </svg>
  ),
  landers: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  history: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

function Sidebar() {
  const linkClass = ({ isActive }) =>
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
      isActive ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
    }`;

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-200 min-h-screen px-4 py-6 flex flex-col">
      <div className="mb-8">
        <span className="text-lg font-bold text-indigo-600">Domain</span>
        <span className="text-lg font-light text-gray-500"> Monitor</span>
      </div>
      <nav className="space-y-4 flex-1">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-1">Monitor</p>
          <div className="space-y-0.5">
            <NavLink to="/dashboard"  className={linkClass}>{ICON.dashboard}  Dashboard</NavLink>
            <NavLink to="/categories" className={linkClass}>{ICON.categories} Categories</NavLink>
            <NavLink to="/logs"       className={linkClass}>{ICON.logs}       Logs</NavLink>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-3 mb-1">Rotator</p>
          <div className="space-y-0.5">
            <NavLink to="/funnels"  className={linkClass}>{ICON.funnels}  Funnels</NavLink>
            <NavLink to="/domains"  className={linkClass}>{ICON.domains}  Domains</NavLink>
            <NavLink to="/landers"  className={linkClass}>{ICON.landers}  Landers</NavLink>
            <NavLink to="/history"  className={linkClass}>{ICON.history}  History</NavLink>
          </div>
        </div>
      </nav>
      <BrowserStatus />
      <button
        onClick={() => { clearToken(); window.location.href = '/login'; }}
        className="flex items-center gap-2 px-3 py-2 mt-3 rounded-md text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Sign out
      </button>
    </aside>
  );
}

function AppLayout() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 min-h-screen bg-gray-50">
        <Routes>
          <Route path="/"           element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard"  element={<DashboardPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/logs"       element={<LogsPage />} />
          <Route path="/funnels"    element={<FunnelsPage />} />
          <Route path="/funnels/:id" element={<FunnelDetailPage />} />
          <Route path="/domains"    element={<DomainsPage />} />
          <Route path="/landers"    element={<LandersPage />} />
          <Route path="/history"    element={<HistoryPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/*" element={<RequireAuth><AppLayout /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  );
}
