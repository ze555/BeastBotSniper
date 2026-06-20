import React, { useState } from 'react';
import { Swords, Activity } from 'lucide-react';
import { PredatorDashboard } from './components/PredatorDashboard';

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-lg text-sm font-semibold transition-all ${
        active
          ? 'bg-blue-600 text-white shadow-md'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5 flex-shrink-0' })}
      <span className="hidden md:block truncate text-right w-full">{label}</span>
    </button>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('predator_reports');

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans leading-relaxed selection:bg-blue-500/30" dir="rtl">
      {/* Sidebar Navigation */}
      <aside className="w-16 md:w-64 flex-shrink-0 bg-slate-900 border-l border-slate-800 flex flex-col items-center md:items-stretch overflow-y-auto custom-scrollbar transition-all duration-300 z-20">
        <div className="p-4 md:p-6 mb-2 border-b border-slate-800 w-full flex justify-center md:justify-start items-center gap-3">
          <div className="relative">
            <Swords className="w-8 h-8 text-blue-500 drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight hidden md:block text-slate-100">سنايبر <span className="text-blue-400">APEX</span></h1>
        </div>
        <nav className="flex flex-col gap-2 px-2 md:px-4">
          <NavItem icon={<Activity className="text-blue-400" />} label="تقارير محرك APEX PREDATOR" active={activeTab === 'predator_reports'} onClick={() => setActiveTab('predator_reports')} />
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/10 via-slate-950 to-slate-950 pointer-events-none" />
        <div className="flex-1 overflow-y-auto p-4 md:p-8 relative custom-scrollbar">
          {activeTab === 'predator_reports' && (
             <PredatorDashboard />
          )}
        </div>
      </main>
    </div>
  );
}
