'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

interface UseSpeechRecognitionOptions {
  onTranscriptAppend?: (text: string) => void;
  onErrorToast?: (message: string) => void;
  lang?: string;
}

export function useSpeechRecognition({
  onTranscriptAppend,
  onErrorToast,
  lang = 'en-US',
}: UseSpeechRecognitionOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Cross-browser detection & secure context environment check
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!window.isSecureContext) {
        console.warn(
          '[SpeechRecognition] Web Speech API requires a secure context (HTTPS or localhost). Dictation may be blocked by the browser.'
        );
      }
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;
      setIsSupported(Boolean(SpeechRecognition));
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors if already stopped or aborting
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const startListening = useCallback(
    (customAppendCallback?: (text: string) => void) => {
      if (typeof window === 'undefined') return;

      // Environment check for secure context
      if (!window.isSecureContext) {
        console.warn(
          '[SpeechRecognition] Dictation blocked: Web Speech API requires a secure context (HTTPS or localhost).'
        );
        onErrorToast?.('Voice dictation requires a secure connection (HTTPS or localhost).');
        setIsListening(false);
        return;
      }

      // Cross-browser speech recognition constructor (Chrome, Safari, Edge, Firefox)
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        onErrorToast?.('Voice dictation is not supported in this browser.');
        setIsListening(false);
        return;
      }

      try {
        // Clean up previous instance if running
        if (recognitionRef.current) {
          try {
            recognitionRef.current.abort();
          } catch { }
          recognitionRef.current = null;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = false;
        recognition.lang = lang || (typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US');

        recognition.onstart = () => {
          setIsListening(true);
        };

        recognition.onresult = (event: any) => {
          let transcript = '';

          // Capture transcript across all newly finalized results
          if (event.results && event.results.length > 0) {
            for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
              const res = event.results[i];
              if (res && res[0] && res[0].transcript) {
                transcript += res[0].transcript;
              }
            }
          }

          // Direct fallback to event.results[0][0].transcript if chunk loop was empty
          if (!transcript && event.results?.[0]?.[0]?.transcript) {
            transcript = event.results[0][0].transcript;
          }

          const trimmed = transcript.trim();
          if (trimmed) {
            const callback = customAppendCallback || onTranscriptAppend;
            callback?.(trimmed);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn('[SpeechRecognition] onerror event:', event.error, event);
          setIsListening(false);
          recognitionRef.current = null;

          // Catch and handle specific error codes with descriptive user feedback
          if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            onErrorToast?.('Microphone permission denied. Please check your browser settings.');
          } else if (event.error === 'no-speech') {
            onErrorToast?.('No speech detected. Mic turned off.');
          } else if (event.error === 'network') {
            onErrorToast?.('Network error occurred during dictation.');
          } else if (event.error === 'audio-capture') {
            onErrorToast?.('No microphone detected. Please verify your audio hardware.');
          } else if (event.error === 'aborted') {
            // Intentionally aborted by user interaction; do not show error toast
          } else {
            onErrorToast?.(`Voice dictation error: ${event.error || 'unexpected error'}`);
          }
        };

        recognition.onend = () => {
          // Reliably reset UI state (stop pulsing mic animation)
          setIsListening(false);
          recognitionRef.current = null;
        };

        recognitionRef.current = recognition;
        recognition.start();
      } catch (err: any) {
        console.error('Failed to initialize or start speech recognition:', err);
        setIsListening(false);
        recognitionRef.current = null;
        onErrorToast?.('Voice dictation is not supported in this browser.');
      }
    },
    [lang, onTranscriptAppend, onErrorToast]
  );

  const toggleListening = useCallback(
    (customAppendCallback?: (text: string) => void) => {
      if (isListening) {
        stopListening();
      } else {
        startListening(customAppendCallback);
      }
    },
    [isListening, startListening, stopListening]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch { }
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    startListening,
    stopListening,
    toggleListening,
  };
}
