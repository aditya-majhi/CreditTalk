import type { TranscriptTurn } from "../types";

interface TranscriptSession {
  url: string;
  token?: string;
  speechModel: string;
}

interface RealtimeTranscriptCallbacks {
  onPartial: (text: string) => void;
  onFinal: (turn: TranscriptTurn) => void;
  onError: (message: string) => void;
}

export class RealtimeTranscriptClient {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private interviewId: string;
  private callbacks: RealtimeTranscriptCallbacks;
  private usesSharedStream = false;
  private finalizedTurns = new Set<number>();
  private stopped = false;
  private cancelStart: (() => void) | null = null;

  constructor(interviewId: string, callbacks: RealtimeTranscriptCallbacks) {
    this.interviewId = interviewId;
    this.callbacks = callbacks;
  }

  async start(session: TranscriptSession, sharedStream?: MediaStream) {
    if (!session.token) {
      throw new Error("A live transcript token is required");
    }

    this.finalizedTurns.clear();
    this.stopped = false;
    this.usesSharedStream = Boolean(sharedStream);
    this.stream =
      sharedStream ??
      (await navigator.mediaDevices.getUserMedia({ audio: true }));
    const url = new URL(session.url);
    url.searchParams.set("sample_rate", "16000");
    url.searchParams.set("speech_model", session.speechModel);
    if (session.speechModel === "whisper-rt") {
      url.searchParams.set("language_detection", "true");
      url.searchParams.set("format_turns", "true");
    }
    url.searchParams.set("encoding", "pcm_s16le");
    url.searchParams.set("token", session.token);

    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = event => this.handleMessage(String(event.data));
    this.socket.onerror = () =>
      this.callbacks.onError("Realtime transcript connection failed.");
    this.socket.onclose = () => this.callbacks.onPartial("");

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => fail("Transcript connection timed out. Please try again."), 15000);
      const fail = (message: string) => {
        window.clearTimeout(timeout);
        this.cancelStart = null;
        reject(new Error(message));
      };
      this.cancelStart = () => fail("Transcript session was stopped.");
      if (!this.socket)
        return reject(new Error("Transcript socket unavailable"));
      this.socket.onopen = () => {
        window.clearTimeout(timeout);
        this.cancelStart = null;
        resolve();
      };
      this.socket.onclose = () => {
        fail("Transcript connection closed. Please try again.");
        this.callbacks.onPartial("");
      };
      this.socket.onerror = () => {
        fail("Realtime transcript connection failed.");
        if (!this.stopped) this.callbacks.onError("Realtime transcript connection failed.");
      };
    });

    if (this.stopped || !this.stream) throw new Error("Transcript session was stopped.");
    this.audioContext = new AudioContext();
    await this.audioContext.resume();
    if (this.stopped || !this.audioContext || !this.stream) throw new Error("Transcript session was stopped.");
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = event => {
      if (this.socket?.readyState !== WebSocket.OPEN) return;
      const samples = event.inputBuffer.getChannelData(0);
      this.socket.send(
        this.toPcm16(samples, this.audioContext?.sampleRate ?? 48000)
      );
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    this.stopped = true;
    this.cancelStart?.();
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.audioContext?.close().catch(() => {});
    if (this.stream && !this.usesSharedStream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "Terminate" }));
    }
    this.socket?.close();
    this.processor = null;
    this.source = null;
    this.audioContext = null;
    this.stream = null;
    this.socket = null;
  }

  private handleMessage(raw: string) {
    if (this.stopped) return;
    try {
      const message = JSON.parse(raw) as {
        transcript?: string;
        text?: string;
        turn_is_formatted?: boolean;
        end_of_turn?: boolean;
        turn_order?: number;
        type?: string;
      };
      const text = message.transcript ?? message.text ?? "";
      if (!text) return;
      if (message.end_of_turn === true) {
        // Partial Turn messages must not become separate financial statements.
        if (message.turn_order !== undefined) {
          if (this.finalizedTurns.has(message.turn_order)) return;
          this.finalizedTurns.add(message.turn_order);
        }
        this.callbacks.onFinal({
          id: crypto.randomUUID(),
          interviewId: this.interviewId,
          speaker: "borrower",
          text,
          timestamp: Date.now(),
        });
        this.callbacks.onPartial("");
      } else {
        this.callbacks.onPartial(text);
      }
    } catch {
      this.callbacks.onError(
        "Received an invalid realtime transcript message."
      );
    }
  }

  private toPcm16(samples: Float32Array, sourceRate: number) {
    const ratio = sourceRate / 16000;
    const outputLength = Math.round(samples.length / ratio);
    const buffer = new ArrayBuffer(outputLength * 2);
    const view = new DataView(buffer);
    for (let index = 0; index < outputLength; index += 1) {
      const sample = Math.max(
        -1,
        Math.min(1, samples[Math.floor(index * ratio)])
      );
      view.setInt16(
        index * 2,
        sample < 0 ? sample * 0x8000 : sample * 0x7fff,
        true
      );
    }
    return buffer;
  }
}
