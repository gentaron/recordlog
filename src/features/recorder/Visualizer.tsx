import { useEffect, useRef } from 'react';

interface VisualizerProps {
  active: boolean;
  /** Fills `target` with the current spectrum; returns false when there is none. */
  read: (target: Uint8Array) => boolean;
  size?: number;
}

/**
 * A radial spectrum around the record button.
 *
 * Drawn straight from the AnalyserNode on every frame — no React state in the
 * loop, so the meter stays smooth even while a transcript is being written.
 */
export function Visualizer({ active, read, size = 168 }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<number | null>(null);
  const smoothRef = useRef<Float32Array | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const BINS = 64;
    const spectrum = new Uint8Array(512);
    const smooth = smoothRef.current ?? new Float32Array(BINS);
    smoothRef.current = smooth;

    let phase = 0;

    const render = () => {
      frameRef.current = requestAnimationFrame(render);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const inner = size * 0.27;
      const span = size * 0.2;

      const live = active && read(spectrum);
      phase += live ? 0.006 : 0.002;

      for (let i = 0; i < BINS; i++) {
        // Log-ish bin mapping: speech energy lives in the bottom of the range,
        // so a linear map would leave three quarters of the ring dead.
        const from = Math.floor((i / BINS) ** 1.7 * 200);
        const to = Math.max(from + 1, Math.floor(((i + 1) / BINS) ** 1.7 * 200));
        let sum = 0;
        for (let b = from; b < to; b++) sum += spectrum[b] ?? 0;
        const value = live ? sum / (to - from) / 255 : 0;

        // Idle: a slow breathing ring, so the control never looks broken.
        const idle = 0.06 + 0.03 * Math.sin(phase * 6 + i * 0.35);
        const target = live ? Math.max(value, 0.03) : idle;
        smooth[i] = (smooth[i] ?? 0) * 0.72 + target * 0.28;

        const a = (i / BINS) * Math.PI * 2 - Math.PI / 2 + phase;
        const len = span * Math.min(1, (smooth[i] ?? 0) * 1.35);
        const x1 = cx + Math.cos(a) * inner;
        const y1 = cy + Math.sin(a) * inner;
        const x2 = cx + Math.cos(a) * (inner + len);
        const y2 = cy + Math.sin(a) * (inner + len);

        const t = Math.min(1, (smooth[i] ?? 0) * 1.6);
        ctx.strokeStyle = live
          ? `rgba(${Math.round(88 + t * 167)}, ${Math.round(214 - t * 90)}, 255, ${0.35 + t * 0.6})`
          : 'rgba(139, 139, 167, 0.28)';
        ctx.lineWidth = size * 0.018;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };

    render();
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [active, read, size]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="pointer-events-none absolute inset-0"
    />
  );
}
