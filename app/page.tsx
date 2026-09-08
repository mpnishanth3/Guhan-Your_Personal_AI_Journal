'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { auth, googleProvider, signInWithPopup, signOut } from '@/lib/firebase';
import { User, onAuthStateChanged } from 'firebase/auth';

export default function Home() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        router.push('/journal');
      } else {
        setUser(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  if (!mounted || loading) {
    return (
      <div suppressHydrationWarning className="flex items-center justify-center min-h-screen bg-transparent text-slate-400 font-sans">
        <p className="text-sm font-mono tracking-widest uppercase animate-pulse">Initializing securely...</p>
      </div>
    );
  }

  return (
    <div suppressHydrationWarning className="flex flex-col items-center justify-center min-h-screen bg-transparent text-[#e2e8f0] p-4 font-sans">
      <div className="max-w-md w-full bg-[#0a0a0c]/85 backdrop-blur-md rounded-3xl shadow-2xl border border-white/10 p-6 sm:p-10 text-center relative overflow-hidden">
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center">
          <img src="/logo.png" alt="Guhan Shield Logo" className="w-20 h-20 sm:w-24 sm:h-24 mb-6 object-contain drop-shadow-[0_0_30px_rgba(99,102,241,0.35)]" />
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight leading-[1.1] mb-2 text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">Guhan</h1>
          <p className="text-xs font-mono text-indigo-300 uppercase tracking-widest mb-4">Powered by Gemini</p>
          <p className="text-base text-slate-400 mb-10 leading-relaxed">Secure, intelligent, and entirely yours.</p>

          {user ? (
            <div className="space-y-8 mt-4">
              <div className="flex flex-col items-center space-y-3">
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-16 h-16 rounded-full border border-white/10 shadow-lg"
                    referrerPolicy="no-referrer"
                  />
                )}
                <div className="flex flex-col items-center">
                  <h2 className="text-xl font-medium text-slate-200">{user.displayName}</h2>
                  <p className="text-sm font-mono text-slate-500 mt-1">{user.email}</p>
                </div>
              </div>
              <button
                onClick={async () => {
                  try {
                    await signOut(auth);
                  } catch (error) {
                    console.error("Sign Out Error:", error);
                  }
                }}
                className="w-full py-3.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 rounded-xl font-medium transition-colors"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <div className="space-y-6 mt-8">
              <div className="group relative w-full">
                <div className="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-xl blur opacity-20 group-hover:opacity-40 transition duration-300"></div>
                <button
                  onClick={async () => {
                    try {
                      await signInWithPopup(auth, googleProvider);
                    } catch (error) {
                      console.error("Authentication Error:", error);
                    }
                  }}
                  className="relative flex items-center justify-center gap-3 w-full py-4 px-4 bg-white text-black rounded-xl font-semibold hover:bg-slate-200 transition-colors shadow-sm"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
              </div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-slate-600 font-medium">
                Auth Provider &mdash; Firebase Identity
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}