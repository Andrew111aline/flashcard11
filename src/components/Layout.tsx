import React, { useState, useEffect } from 'react';
import { Home, Layers, BarChart2, Settings, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useTranslation } from '../lib/db';

export function Layout({ children }: { children: React.ReactNode }) {
  const [hash, setHash] = useState(window.location.hash || '#home');
  const t = useTranslation();

  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash || '#home');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navItems = [
    { id: '#home', label: t('nav_home'), icon: Home },
    { id: '#decks', label: t('nav_decks'), icon: Layers },
    { id: '#stats', label: t('nav_stats'), icon: BarChart2 },
    { id: '#settings', label: t('nav_settings'), icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col hidden md:flex">
        <div className="p-6">
          <h1 className="text-xl font-bold text-teal-700 flex items-center gap-2">
            <Layers className="w-6 h-6" />
            FSRS Cards
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = hash.startsWith(item.id);
            return (
              <a
                key={item.id}
                href={item.id}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  isActive 
                    ? "bg-teal-50 text-teal-700" 
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="p-4 border-t border-gray-200">
          <a
            href="#edit"
            className="flex items-center justify-center gap-2 w-full bg-teal-600 text-white px-4 py-2 rounded-md font-medium hover:bg-teal-700 transition-colors"
          >
            <Plus className="w-5 h-5" />
            {t('deck_add_card')}
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 flex justify-around p-2 z-50">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = hash.startsWith(item.id);
          return (
            <a
              key={item.id}
              href={item.id}
              className={cn(
                "flex flex-col items-center p-2 rounded-md text-xs font-medium transition-colors",
                isActive ? "text-teal-700" : "text-gray-500"
              )}
            >
              <Icon className="w-6 h-6 mb-1" />
              {item.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}
