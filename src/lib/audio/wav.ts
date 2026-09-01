/** 16-bit PCM WAV container. Universally accepted by speech APIs, tiny to build. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, bytes, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Decodes any browser-supported audio file back to mono Float32 for re-processing. */
export async function decodeToMono(blob: Blob): Promise<{ audio: Float32Array; rate: number }> {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  const chans = decoded.numberOfChannels;
  const out = new Float32Array(decoded.length);
  for (let c = 0; c < chans; c++) {
    const data = decoded.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] = out[i]! + data[i]! / chans;
  }
  return { audio: out, rate: decoded.sampleRate };
}
