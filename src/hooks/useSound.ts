import { useCallback } from 'react';

export function useSound() {
  const playBeep = useCallback((times = 1) => {
    const fireOnce = () => {
      try {
        const a = new Audio('/beep.mp3');
        a.volume = 1.0;
        a.play().catch(() => {
          try {
            const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
            if (AudioContextClass) {
              const ctx = new AudioContextClass();
              const osc = ctx.createOscillator();
              const g = ctx.createGain();
              osc.connect(g);
              g.connect(ctx.destination);
              osc.type = 'sine';
              osc.frequency.setValueAtTime(880, ctx.currentTime);
              g.gain.setValueAtTime(0.6, ctx.currentTime);
              g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.8);
            }
          } catch (e) {
            console.error('AudioContext fallback failed:', e);
          }
        });
      } catch (e) {
        console.error('Audio playback failed:', e);
      }
    };

    for (let i = 0; i < times; i++) {
      setTimeout(fireOnce, i * 700);
    }
  }, []);

  return { playBeep };
}
