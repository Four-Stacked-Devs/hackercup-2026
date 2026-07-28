'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Read-aloud over the Web Speech API, one sentence at a time so the sentence
 * being read can be highlighted.
 *
 * It never traps focus, and it stops on navigation — an unmount cancels speech.
 */
export function useReadAloud(text: string, rate: number) {
  const sentences = useMemo(() => splitSentences(text), [text]);
  const [index, setIndex] = useState<number | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const cancelled = useRef(false);

  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window && sentences.length > 0;

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    cancelled.current = true;
    window.speechSynthesis.cancel();
    setSpeaking(false);
    setIndex(null);
  }, []);

  const speakFrom = useCallback(
    (start: number) => {
      if (!supported) return;
      cancelled.current = false;
      window.speechSynthesis.cancel();
      setSpeaking(true);

      const speakAt = (position: number) => {
        if (cancelled.current || position >= sentences.length) {
          setSpeaking(false);
          setIndex(null);
          return;
        }

        setIndex(position);
        const utterance = new SpeechSynthesisUtterance(sentences[position]);
        utterance.rate = rate;
        utterance.onend = () => speakAt(position + 1);
        utterance.onerror = () => {
          setSpeaking(false);
          setIndex(null);
        };
        window.speechSynthesis.speak(utterance);
      };

      speakAt(start);
    },
    [rate, sentences, supported],
  );

  const toggle = useCallback(() => {
    if (speaking) stop();
    else speakFrom(0);
  }, [speaking, speakFrom, stop]);

  useEffect(() => stop, [stop]);
  // A different section means the previous reading is no longer what is on screen.
  useEffect(() => stop, [text, stop]);

  return { sentences, index, speaking, supported, toggle, stop };
}

/** Splits on sentence ends, keeping the punctuation with the sentence. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
