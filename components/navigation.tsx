import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { auth, signOut } from '@/lib/firebase';
import { LogOut, PenLine, LayoutDashboard } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useBackgroundProcess } from '@/context/BackgroundProcessContext';

export function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { isProcessing, currentStepText, isImporting, importProgress } = useBackgroundProcess();

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      router.push('/');
    } catch (error) {
      console.error('Sign Out Error:', error);
    }
  };

  return (
    <nav suppressHydrationWarning className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10 bg-[#050505]/60 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-2 sm:gap-3">
        <img src="/logo.png" alt="Guhan Logo" className="w-8 h-8 sm:w-9 sm:h-9 object-contain rounded-xl shadow-md border border-white/10" />
        <Link href="/" className="text-lg sm:text-xl font-medium tracking-tight text-slate-200 flex items-center">
          Guhan <span className="hidden sm:inline-block text-xs text-indigo-300 font-normal ml-2 px-2.5 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">Powered by Gemini</span>
        </Link>
        {(isProcessing || isImporting) && (
          <div className={`hidden md:flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono animate-in fade-in zoom-in-95 duration-200 ${
            isImporting
              ? 'bg-teal-500/10 border-teal-500/30 text-teal-300'
              : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
          }`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isImporting ? 'bg-teal-400' : 'bg-indigo-400'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isImporting ? 'bg-teal-500' : 'bg-indigo-500'}`}></span>
            </span>
            <span className="truncate max-w-[260px]">
              {isImporting
                ? `Syncing archives: ${importProgress?.current || 0} of ${importProgress?.total || 0} secured.`
                : currentStepText}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 sm:gap-4">
        <Link 
          href="/journal"
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-colors ${pathname === '/journal' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          title="Journal"
        >
          <PenLine className="w-4 h-4 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">Journal</span>
        </Link>
        <Link 
          href="/dashboard"
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-colors ${pathname === '/dashboard' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
          title="Dashboard"
        >
          <LayoutDashboard className="w-4 h-4 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">Dashboard</span>
        </Link>
        <div className="w-px h-6 bg-white/10 mx-1 sm:mx-2 hidden sm:block"></div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          title="Sign Out"
        >
          <LogOut className="w-4 h-4 sm:w-4 sm:h-4" />
          <span className="hidden sm:inline">Sign Out</span>
        </button>
      </div>
    </nav>
  );
}
