import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/hooks/useLanguage';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageToggle } from '@/components/LanguageToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { TrendingUp, Settings, PlusCircle, LayoutDashboard, History } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const location = useLocation();

  const navItems = [
    { href: '/', label: t('nav.dashboard'), icon: LayoutDashboard },
    { href: '/update', label: t('nav.portfolioUpdate'), icon: PlusCircle },
    { href: '/settings', label: t('nav.settings'), icon: Settings },
    { href: '/logs', label: t('nav.logs'), icon: History },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            <span className="font-bold text-lg">{t('nav.appName')}</span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => (
              <Link key={item.href} to={item.href}>
                <Button
                  variant={location.pathname === item.href ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn(
                    'gap-2',
                    location.pathname === item.href && 'bg-secondary'
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Button>
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="md:hidden flex items-center justify-around border-t border-border py-1 overflow-x-auto">
          {navItems.map((item) => (
            <Link key={item.href} to={item.href} className="flex-shrink-0">
              <Button
                variant={location.pathname === item.href ? 'secondary' : 'ghost'}
                size="sm"
                className="flex-col h-auto py-3 px-2 min-h-[60px]"
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs mt-1">{item.label}</span>
              </Button>
            </Link>
          ))}
        </nav>
      </header>
      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
