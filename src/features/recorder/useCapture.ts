import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsrEngineId } from '@shared/types';
import { Recorder, type CaptureResult, type LevelSnapshot } from '@/lib/audio/recorder';
import { LiveCaptions, liveCaptionsSupported, transcribe, type AsrProgress } from '@/lib/asr';
import { putAudio, type LocalMemo } from '@/lib/db/local';
import { useApp, timezone } from '@/store/app';
import { haptic, useSettings } from '@/store/settings';
import { dayKey } from '@/lib/time';

export type CaptureState = 'idle' | 'requesting' | 'recording' | 'paused' | 'processing';

const EMPTY_LEVEL: LevelSnapshot = {
  rms: 0,
  peak: 0,
  snrDb: 0,
  speaking: false,
  silenceMs: 0,
  clipped: 0,
  seconds: 0,
};

/**
 * The whole capture loop in one hook: microphone, live captions, speech
 * recognition, and the write to local storage. The rest of the UI only ever
 * sees `state`, `level` and `liveText`.
 */
export function useCapture() {
  const settings = useSettings();
  const saveMemo = useApp((s) => s.saveMemo);
  const patchMemo = useApp((s) => s.patchMemo);
  const refineMemo = useApp((s) => s.refineMemo);
  const sync = useApp((s) => s.sync);
  const toast = useApp((s) => s.toast);
  const audioArchive = useApp((s) => s.session?.audioArchive ?? false);

  const [state, setState] = useState<CaptureState>('idle');
  const [level, setLevel] = useState<LevelSnapshot>(EMPTY_LEVEL);
  const [elapsed, setElapsed] = useState(0);
  const [liveText, setLiveText] = useState('');
  const [interim, setInterim] = useState('');
  const [progress, setProgress] = useState<AsrProgress | null>(null);

  const recorderRef = useRef<Recorder | null>(null);
  const captionsRef = useRef<LiveCaptions | null>(null);
  const tickRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  // The dock's visualiser reads straight from the analyser, not through React.
  const readFrequencies = useCallback(
    (target: Uint8Array) => recorderRef.current?.readFrequencies(target) ?? false,
    [],
  );

  const clearTick = () => {
    if (tickRef.current !== null) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearTick();
      captionsRef.current?.stop();
      recorderRef.current?.cancel();
    },
    [],
  );

  const finalize = useCallback(
    async (result: CaptureResult, live: string) => {
      const id = crypto.randomUUID();
      const now = Date.now();
      const createdAt = now - result.durationMs;
      const day = dayKey(createdAt, timezone());

      // Write immediately with whatever the live captions caught, so a memo is
      // never lost while the transcript is still being produced.
      const seed: LocalMemo = {
        id,
        createdAt,
        updatedAt: now,
        day,
        text: live,
        rawText: live,
        title: null,
        tags: [],
        durationMs: result.durationMs,
        lang: settings.language,
        engine: (live ? 'web-speech' : 'cloud-whisper') as AsrEngineId,
        audioKey: null,
        status: 'pending',
        stackedInto: null,
        dirty: true,
        transcribing: true,
        error: null,
      };
      await saveMemo(seed);

      if (settings.keepAudioLocal) {
        await putAudio(id, result.wav).catch(() => undefined);
      }

      try {
        const asr = await transcribe(
          {
            audio: result.audio,
            wav: result.wav,
            durationMs: result.durationMs,
            language: settings.language,
            storeAudio: settings.storeAudioRemote && audioArchive,
          },
          settings.engine,
          setProgress,
        );

        await patchMemo(id, {
          text: asr.text || live,
          rawText: asr.text || live,
          lang: asr.lang || settings.language,
          engine: asr.engine,
          audioKey: asr.audioKey ?? null,
          transcribing: false,
          error: null,
        });

        if (settings.autoRefine && (asr.text || live)) await refineMemo(id);
        void sync(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : '文字起こしに失敗しました';
        await patchMemo(id, { transcribing: false, error: message });
        toast(live ? `${message}（聞き取った分は残しました）` : message, 'error');
      } finally {
        setProgress(null);
      }
    },
    [audioArchive, patchMemo, refineMemo, saveMemo, settings, sync, toast],
  );

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || stoppingRef.current) return;
    stoppingRef.current = true;

    clearTick();
    const live = captionsRef.current?.stop() ?? '';
    captionsRef.current = null;
    setInterim('');
    setState('processing');
    haptic([8, 40, 8]);

    try {
      const result = await recorder.stop();
      recorderRef.current = null;
      if (result.silent || result.durationMs < 400) {
        toast('音が入っていませんでした', 'info');
      } else {
        await finalize(result, live.trim());
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : '録音を保存できませんでした', 'error');
    } finally {
      stoppingRef.current = false;
      recorderRef.current = null;
      setState('idle');
      setLevel(EMPTY_LEVEL);
      setElapsed(0);
      setLiveText('');
    }
  }, [finalize, toast]);

  const start = useCallback(async () => {
    if (state !== 'idle') return;
    setState('requesting');
    setLiveText('');
    setInterim('');

    const recorder = new Recorder({
      autoStopSilenceMs: settings.autoStopSilenceMs,
      browserProcessing: settings.browserProcessing,
      onLevel: setLevel,
      onAutoStop: () => void stop(),
    });

    try {
      await recorder.start();
    } catch (error) {
      setState('idle');
      const message =
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'マイクの使用が許可されませんでした'
          : error instanceof Error
            ? error.message
            : 'マイクを起動できませんでした';
      toast(message, 'error');
      return;
    }

    recorderRef.current = recorder;
    setState('recording');
    haptic(14);

    if (settings.liveCaptions && liveCaptionsSupported()) {
      const captions = new LiveCaptions(settings.language, {
        onFinal: setLiveText,
        onInterim: setInterim,
      });
      captions.start();
      captionsRef.current = captions;
    }

    const tick = () => {
      setElapsed(recorder.elapsedMs);
      tickRef.current = requestAnimationFrame(tick);
    };
    tickRef.current = requestAnimationFrame(tick);
  }, [settings, state, stop, toast]);

  const cancel = useCallback(() => {
    clearTick();
    captionsRef.current?.stop();
    captionsRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setState('idle');
    setLevel(EMPTY_LEVEL);
    setElapsed(0);
    setLiveText('');
    setInterim('');
    haptic([6, 30, 6, 30]);
  }, []);

  const togglePause = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setState('paused');
    } else if (recorder.state === 'paused') {
      await recorder.resume();
      setState('recording');
    }
  }, []);

  return {
    state,
    level,
    elapsed,
    liveText,
    interim,
    progress,
    supported: Recorder.supported,
    start,
    stop,
    cancel,
    togglePause,
    readFrequencies,
  };
}
