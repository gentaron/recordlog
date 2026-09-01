/**
 * Live captions while you talk.
 *
 * The Web Speech API is not the transcript of record — its accuracy varies by
 * browser and it silently drops long utterances. It is, however, the only way
 * to show words the instant they are spoken, which is what makes a voice memo
 * feel trustworthy. Whisper still produces the text that gets saved.
 */

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(i: number): SpeechAlternative;
  [i: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  item(i: number): SpeechResult;
  [i: number]: SpeechResult;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const liveCaptionsSupported = (): boolean => ctor() !== null;

export interface LiveCaptionHandlers {
  /** Text confirmed by the recognizer, appended as it arrives. */
  onFinal?: (text: string) => void;
  /** The in-flight guess; replaced on every update. */
  onInterim?: (text: string) => void;
  onError?: (code: string) => void;
}

export class LiveCaptions {
  private rec: SpeechRecognitionLike | null = null;
  private wanted = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private finalText = '';

  constructor(
    private readonly lang: string,
    private readonly handlers: LiveCaptionHandlers = {},
  ) {}

  get transcript(): string {
    return this.finalText.trim();
  }

  start(): void {
    const C = ctor();
    if (!C) return;
    this.wanted = true;
    this.finalText = '';
    this.spin(C);
  }

  private spin(C: SpeechRecognitionCtor): void {
    const rec = new C();
    rec.lang = this.lang === 'auto' ? navigator.language || 'ja-JP' : this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) {
          this.finalText += text;
          this.handlers.onFinal?.(this.finalText.trim());
        } else {
          interim += text;
        }
      }
      if (interim) this.handlers.onInterim?.(interim);
    };

    rec.onerror = (e) => {
      const code = e.error ?? 'unknown';
      // `no-speech` and `aborted` are normal in a long pause; keep going.
      if (code !== 'no-speech' && code !== 'aborted') this.handlers.onError?.(code);
    };

    // Chrome ends the session every ~60 s. Restart until we are told to stop.
    rec.onend = () => {
      if (!this.wanted) return;
      this.restartTimer = setTimeout(() => {
        try {
          this.spin(C);
        } catch {
          /* the tab may be backgrounded; give up quietly */
        }
      }, 180);
    };

    this.rec = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }

  stop(): string {
    this.wanted = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    try {
      this.rec?.stop();
    } catch {
      /* ignore */
    }
    this.rec = null;
    return this.transcript;
  }
}
