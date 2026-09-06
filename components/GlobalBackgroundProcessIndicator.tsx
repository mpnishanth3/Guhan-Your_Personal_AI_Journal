'use client';

import React from 'react';
import { useBackgroundProcess } from '@/context/BackgroundProcessContext';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertCircle, Loader2, X, Shield, Calendar } from 'lucide-react';

export function GlobalBackgroundProcessIndicator() {
  const {
    isProcessing,
    currentStepText,
    uploadProgress,
    error,
    lastSuccessMessage,
    activeEntryDate,
    dismissNotification,
    isImporting,
    importProgress,
  } = useBackgroundProcess();

  const isVisible = isProcessing || isImporting || Boolean(lastSuccessMessage) || Boolean(error);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50 max-w-sm w-full pointer-events-auto"
        >
          {/* Main Card Container */}
          <div
            className={`p-4 rounded-2xl backdrop-blur-xl border shadow-2xl transition-all duration-300 ${error
                ? 'bg-rose-950/85 border-rose-500/30 text-rose-200'
                : lastSuccessMessage
                  ? 'bg-emerald-950/85 border-emerald-500/30 text-emerald-200'
                  : isImporting
                    ? 'bg-[#080b11]/95 border-teal-500/30 text-slate-200 shadow-[0_0_30px_rgba(20,184,166,0.15)]'
                    : 'bg-[#0a0a0c]/90 border-white/10 text-slate-200'
              }`}
          >
            {/* Header / Status Bar */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                {error ? (
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                ) : lastSuccessMessage ? (
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                ) : isImporting ? (
                  <div className="w-8 h-8 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400 shrink-0 relative">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-400"></span>
                    </span>
                  </div>
                ) : (
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 relative">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                    </span>
                  </div>
                )}

                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold">
                      {error
                        ? 'Vault Exception'
                        : lastSuccessMessage
                          ? 'Vault Secured'
                          : isImporting
                            ? 'Archive Ingestion'
                            : 'Background Sealing'}
                    </span>
                    {activeEntryDate && !isImporting && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-slate-400">
                        {activeEntryDate}
                      </span>
                    )}
                  </div>

                  {/* Dynamic Status / Message */}
                  <AnimatePresence mode="wait">
                    {error ? (
                      <motion.p
                        key="error"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-xs font-sans text-rose-300 leading-snug line-clamp-2 mt-0.5"
                      >
                        {error}
                      </motion.p>
                    ) : lastSuccessMessage ? (
                      <motion.p
                        key="success"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="text-xs font-sans text-emerald-300 font-medium leading-snug mt-0.5"
                      >
                        {lastSuccessMessage}
                      </motion.p>
                    ) : isImporting ? (
                      <motion.p
                        key={`importing-${importProgress?.current}`}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.2 }}
                        className="text-xs font-mono text-teal-300 leading-snug mt-0.5 truncate font-medium"
                      >
                        Syncing archives: {importProgress?.current || 0} of {importProgress?.total || 0} secured.
                      </motion.p>
                    ) : (
                      <motion.p
                        key={currentStepText}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.2 }}
                        className="text-xs font-mono text-indigo-300 leading-snug mt-0.5 truncate"
                      >
                        {currentStepText}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Close Button for Error / Success */}
              {(error || lastSuccessMessage) && (
                <button
                  type="button"
                  onClick={dismissNotification}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors shrink-0"
                  title="Dismiss notification"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Ingestion Progress Bar */}
            {isImporting && importProgress && (
              <div className="mt-3 pt-2.5 border-t border-white/5 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span className="text-teal-400">Protected-Sanctuary-Ingestion</span>
                  <span className="text-teal-300">
                    {Math.min(100, Math.round(((importProgress.current) / (importProgress.total || 1)) * 100))}%
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-teal-400 via-indigo-400 to-purple-400 h-full transition-all duration-300 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round(((importProgress.current) / (importProgress.total || 1)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Optional Media Upload Progress Bar */}
            {isProcessing && uploadProgress !== null && (
              <div className="mt-3 pt-2.5 border-t border-white/5 flex flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Encrypting media upload</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-200"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
