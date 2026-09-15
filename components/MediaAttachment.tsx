'use client';

import { useState, useEffect, useRef } from 'react';
import { db, storage } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { Film, Image as ImageIcon, Maximize2, Download, X, ExternalLink, Play, Loader2, AlertCircle, Upload, Sparkles } from 'lucide-react';
import { getFromMediaVault, saveToMediaVault, compressImageToDataUrl } from '@/lib/media-vault';
import { readFileAsBase64 } from '@/lib/quota';

interface MediaAttachmentProps {
  mediaUrl?: string | null;
  mediaPath?: string | null;
  mediaType?: string | null;
  mediaName?: string | null;
  entryId?: string;
  userId?: string;
  className?: string;
  variant?: 'card' | 'compact' | 'detail';
  onMediaRestored?: (newUrl: string) => void;
}

export function MediaAttachment({
  mediaUrl,
  mediaPath,
  mediaType,
  mediaName,
  entryId,
  userId,
  className = '',
  variant = 'card',
  onMediaRestored,
}: MediaAttachmentProps) {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(mediaUrl || null);
  const [loading, setLoading] = useState<boolean>(!mediaUrl && Boolean(mediaPath));
  const [hasError, setHasError] = useState<boolean>(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState<boolean>(false);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsRestoring(true);
    try {
      let dataUrl = '';
      if (file.type.startsWith('image/')) {
        dataUrl = await compressImageToDataUrl(file);
      } else {
        const base64 = await readFileAsBase64(file);
        dataUrl = `data:${file.type};base64,${base64}`;
      }

      if (mediaPath) {
        await saveToMediaVault(mediaPath, {
          dataUrl,
          mimeType: file.type,
          name: file.name,
          size: file.size,
        });
        const baseFileName = mediaPath.split('/').pop();
        if (baseFileName) {
          await saveToMediaVault(baseFileName, {
            dataUrl,
            mimeType: file.type,
            name: file.name,
            size: file.size,
          });
        }
      }

      if (entryId && userId) {
        const entryRef = doc(db, 'users', userId, 'entries', entryId);
        await updateDoc(entryRef, {
          media_url: dataUrl,
          media_type: file.type,
          media_name: file.name,
          media_size: file.size,
        });
      }

      setResolvedUrl(dataUrl);
      setHasError(false);
      if (onMediaRestored) {
        onMediaRestored(dataUrl);
      }
    } catch (restoreErr) {
      console.error('Failed to restore file to vault:', restoreErr);
    } finally {
      setIsRestoring(false);
    }
  };

  // Auto-resolve storage path if URL is not directly available
  useEffect(() => {
    if (mediaUrl && (mediaUrl.startsWith('http') || mediaUrl.startsWith('data:') || mediaUrl.startsWith('blob:'))) {
      setResolvedUrl(mediaUrl);
      setLoading(false);
      return;
    }

    if (mediaPath) {
      let isMounted = true;
      setLoading(true);
      setHasError(false);

      const resolveMedia = async () => {
        // 1. Check local IndexedDB media vault first (instant 0ms)
        try {
          const vaultRecord = await getFromMediaVault(mediaPath);
          if (vaultRecord?.dataUrl && isMounted) {
            setResolvedUrl(vaultRecord.dataUrl);
            setLoading(false);
            return;
          }

          // Check by file base name
          const fileName = mediaPath.split('/').pop();
          if (fileName && fileName !== mediaPath) {
            const fileRecord = await getFromMediaVault(fileName);
            if (fileRecord?.dataUrl && isMounted) {
              setResolvedUrl(fileRecord.dataUrl);
              setLoading(false);
              return;
            }
          }
        } catch (vaultErr) {
          console.warn('Vault lookup notice:', vaultErr);
        }

        // 2. Fallback to Firebase Storage with a strict 2-second timeout
        if (storage) {
          try {
            const storageRef = ref(storage, mediaPath);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Storage connection timeout')), 2000)
            );
            const url = await Promise.race([getDownloadURL(storageRef), timeoutPromise]);
            if (isMounted && url) {
              setResolvedUrl(url);
              setLoading(false);
              return;
            }
          } catch (storageErr) {
            console.warn('Could not resolve cloud storage path:', mediaPath, storageErr);
          }
        }

        if (isMounted) {
          setHasError(true);
          setLoading(false);
        }
      };

      resolveMedia();

      return () => {
        isMounted = false;
      };
    }
  }, [mediaUrl, mediaPath]);

  // Handle ESC key to close lightbox
  useEffect(() => {
    if (!isLightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLightboxOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLightboxOpen]);

  if (!mediaUrl && !mediaPath) {
    return null;
  }

  const isVideo = mediaType?.startsWith('video/') || (mediaName && /\.(mp4|webm|mov|mkv)$/i.test(mediaName));

  if (hasError) {
    const rawName = mediaName || mediaPath?.split('/').pop() || 'file';
    const cleanName = rawName.replace(/^\d+_/, '');

    return (
      <div className={`p-4 rounded-xl bg-[#121214] border border-amber-500/20 text-xs text-slate-300 flex flex-col gap-3 ${className}`}>
        <div className="flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="font-medium text-slate-200 truncate">
                {cleanName}
              </span>
              <span className="text-[10px] font-mono uppercase text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                Cloud Bucket Unprovisioned
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              When this past entry was recorded, the Firebase Storage bucket was unprovisioned.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-white/5 gap-2 flex-wrap">
          <span className="text-[11px] text-slate-400 font-mono">
            Have <strong className="text-slate-200">{cleanName}</strong> on your device?
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleRestoreFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRestoring}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-all shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isRestoring ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>{isRestoring ? 'Restoring...' : 'Restore / Re-attach File'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`relative group overflow-hidden border border-white/10 bg-black/40 ${className}`}>
        {loading ? (
          <div className="w-full h-36 flex items-center justify-center bg-white/[0.02] text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
            <span className="ml-2 text-xs font-mono">Decrypting media...</span>
          </div>
        ) : resolvedUrl ? (
          isVideo ? (
            <div className="relative">
              <video
                src={resolvedUrl}
                controls
                className={`w-full ${
                  variant === 'compact'
                    ? 'max-h-36 object-cover'
                    : variant === 'detail'
                    ? 'max-h-72 object-cover rounded-lg'
                    : 'max-h-60 object-cover'
                }`}
              />
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                title="Expand video theater"
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white/80 hover:text-white border border-white/10 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all z-10"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div
              onClick={() => setIsLightboxOpen(true)}
              className="relative cursor-pointer overflow-hidden group/img"
            >
              <img
                src={resolvedUrl}
                alt={mediaName || 'Secured Vault Media'}
                className={`w-full transition-transform duration-300 group-hover/img:scale-[1.02] ${
                  variant === 'compact'
                    ? 'max-h-36 object-cover'
                    : variant === 'detail'
                    ? 'max-h-72 object-contain bg-black/40 rounded-lg'
                    : 'max-h-60 object-contain bg-black/30'
                }`}
              />
              {/* Subtle hover overlay */}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2 text-white text-xs font-medium backdrop-blur-[2px]">
                <div className="px-3 py-1.5 rounded-xl bg-black/70 border border-white/20 flex items-center gap-1.5 shadow-lg">
                  <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Click to expand</span>
                </div>
              </div>
            </div>
          )
        ) : null}
      </div>

      {/* Full-Screen Theater Lightbox Modal */}
      {isLightboxOpen && resolvedUrl && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsLightboxOpen(false);
          }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 sm:p-6 bg-black/95 backdrop-blur-md animate-in fade-in duration-200"
        >
          {/* Top Bar Controls */}
          <div className="w-full max-w-5xl flex items-center justify-between pb-3 mb-2 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-white/5 border border-white/10 text-indigo-400">
                {isVideo ? <Film className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
              </div>
              <div>
                <h4 className="text-sm font-medium text-slate-200 truncate max-w-xs sm:max-w-md">
                  {mediaName || (isVideo ? 'Secured Video' : 'Secured Photo')}
                </h4>
                <p className="text-[10px] font-mono text-slate-500 uppercase">
                  {isVideo ? 'Vault Video Player' : 'Vault High-Resolution View'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <a
                href={resolvedUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={mediaName || (isVideo ? 'vault-video.mp4' : 'vault-photo.jpg')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs font-medium transition-all"
                title="Download or open original media"
              >
                <Download className="w-3.5 h-3.5 text-indigo-400" />
                <span className="hidden sm:inline">Download</span>
              </a>

              <button
                type="button"
                onClick={() => setIsLightboxOpen(false)}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white border border-white/10 transition-colors"
                title="Close viewer (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Central Media Container */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex-1 w-full max-w-5xl flex items-center justify-center overflow-hidden my-auto"
          >
            {isVideo ? (
              <video
                src={resolvedUrl}
                controls
                autoPlay
                className="max-h-[80vh] max-w-full rounded-xl border border-white/10 shadow-2xl bg-black"
              />
            ) : (
              <img
                src={resolvedUrl}
                alt={mediaName || 'Full resolution vault media'}
                className="max-h-[80vh] max-w-full object-contain rounded-xl border border-white/10 shadow-2xl bg-black/60 select-none"
              />
            )}
          </div>

          {/* Footer Note */}
          <div className="w-full max-w-5xl pt-3 text-center">
            <span className="text-[11px] font-mono text-slate-500">
              Zero-Trust Secured Storage • Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px]">Esc</kbd> or click outside to dismiss
            </span>
          </div>
        </div>
      )}
    </>
  );
}
