interface VoiceSession {
  url: string;
  token?: string;
  agentId?: string;
  prompt?: string;
}

interface VoiceAgentCallbacks {
  onPrompt: (text: string) => void;
  onBorrowerPartial: (text: string) => void;
  onBorrowerTranscript: (text: string) => void;
  onError: (message: string) => void;
  onEnded?: () => void;
}

export class VoiceAgentClient {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private callbacks: VoiceAgentCallbacks;
  private usesSharedStream = false;
  private playbackContext: AudioContext | null = null;
  private playbackTime = 0;
  private ready = false;
  private intentionalStop = false;
  private pendingEndCallId: string | null = null;
  private cancelStart: (() => void) | null = null;
  private finalizedBorrowerItems = new Set<string>();

  constructor(callbacks: VoiceAgentCallbacks) {
    this.callbacks = callbacks;
  }

  async start(session: VoiceSession, sharedStream?: MediaStream) {
    if (!session.token || !session.agentId) {
      throw new Error("A live voice token and agent ID are required");
    }

    this.usesSharedStream = Boolean(sharedStream);
    this.intentionalStop = false;
    this.finalizedBorrowerItems.clear();
    this.stream =
      sharedStream ??
      (await navigator.mediaDevices.getUserMedia({ audio: true }));
    this.audioContext = new AudioContext();
    this.playbackContext = this.audioContext;
    await this.audioContext.resume();
    if (this.intentionalStop) throw new Error("Voice session was stopped.");
    const url = new URL(session.url);
    url.searchParams.set("token", session.token);
    this.socket = new WebSocket(url);
    this.socket.onmessage = event => this.handleMessage(String(event.data));
    this.socket.onclose = () => {
      if (!this.intentionalStop) this.callbacks.onError("Voice connection closed. Please start the microphone again.");
    };
    this.socket.onerror = () =>
      this.callbacks.onError("Voice Agent connection failed.");

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => fail("Voice connection timed out. Please try again."), 15000);
      const fail = (message: string) => {
        window.clearTimeout(timeout);
        this.cancelStart = null;
        reject(new Error(message));
      };
      this.cancelStart = () => fail("Voice session was stopped.");
      if (!this.socket)
        return reject(new Error("Voice Agent socket unavailable"));
      this.socket.onclose = () => {
        if (this.intentionalStop) return;
        const message = "Voice connection closed. Please start the microphone again.";
        fail(message);
        this.callbacks.onError(message);
      };
      this.socket.onopen = () => {
          this.socket?.send(JSON.stringify({
            type: "session.update",
            session: { agent_id: session.agentId },
          }));
      };
      this.socket.onmessage = event => {
        const raw = String(event.data);
        try {
          const message = JSON.parse(raw) as {
            type?: string; message?: string;
            config?: { system_prompt?: string; tools?: Array<{ name?: string }> };
          };
          if (message.type === "session.error") {
            fail(message.message ?? "Voice Agent configuration failed.");
          }
          if (message.type === "session.ready") {
            this.ready = true;
            this.socket?.send(JSON.stringify({
              type: "session.update",
              session: {
                system_prompt: [
                  message.config?.system_prompt,
                  "You are conducting a loan application interview. After greeting the borrower, ask one question at a time and wait for their answer. A hello or acknowledgment is an invitation to begin the questions, not the end of the interview. Ask about loan purpose, employment or business, income, expenses, existing repayments, and repayment plans. Clarify unclear answers without inventing facts. Only call end_interview when the borrower explicitly wants to stop or confirms they are finished after the questions. Never end merely because of a pause.",
                  session.prompt,
                ].filter(Boolean).join("\n\n"),
                tools: [...(message.config?.tools ?? []).filter(tool => tool.name !== "end_interview"), {
                  type: "function",
                  name: "end_interview",
                  description: "End the loan interview after all required questions are answered and the borrower confirms they are finished. Do not call this merely because the borrower pauses or asks a follow-up question.",
                  parameters: {
                    type: "object",
                    properties: {
                      reason: { type: "string", description: "Brief reason the interview is complete." },
                    },
                    required: ["reason"],
                  },
                }],
              },
            }));
            window.clearTimeout(timeout);
            this.cancelStart = null;
            resolve();
          }
        } catch {
          this.callbacks.onError("Received an invalid Voice Agent message.");
        }
        this.handleMessage(raw);
      };
      this.socket.onerror = () => {
        fail("Voice Agent connection failed.");
        this.callbacks.onError("Voice Agent connection failed.");
      };
    });

    if (this.intentionalStop || !this.audioContext || !this.stream) throw new Error("Voice session was stopped.");
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = event => {
      if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
      const pcm = this.toPcm16(
        event.inputBuffer.getChannelData(0),
        this.audioContext?.sampleRate ?? 48000
      );
      const bytes = new Uint8Array(pcm);
      let binary = "";
      bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
      });
      this.socket.send(
        JSON.stringify({ type: "input.audio", audio: btoa(binary) })
      );
    };
    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  stop() {
    this.intentionalStop = true;
    this.cancelStart?.();
    this.processor?.disconnect();
    this.source?.disconnect();
    void this.audioContext?.close().catch(() => {});
    if (this.stream && !this.usesSharedStream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "session.end" }));
    }
    this.socket?.close();
    this.processor = null;
    this.source = null;
    this.audioContext = null;
    this.stream = null;
    this.socket = null;
    this.ready = false;
    this.playbackContext = null;
    this.playbackTime = 0;
    this.pendingEndCallId = null;
  }

  private handleMessage(raw: string) {
    if (this.intentionalStop) return;
    try {
      const message = JSON.parse(raw) as {
        text?: string;
        transcript?: string;
        message?: string;
        data?: string;
        type?: string;
        name?: string;
        call_id?: string;
        reply_id?: string;
        status?: string;
        item_id?: string;
      };
      const text = message.text ?? message.transcript ?? message.message;
      // Voice Agent user deltas contain the entire current utterance, not
      // incremental words. Only final events become saved borrower turns.
      if (message.type === "transcript.user.delta") {
        if (!message.item_id || !this.finalizedBorrowerItems.has(message.item_id)) {
          this.callbacks.onBorrowerPartial(message.text ?? "");
        }
        return;
      }
      if (message.type === "transcript.user") {
        if (message.item_id && this.finalizedBorrowerItems.has(message.item_id)) return;
        if (message.text?.trim()) {
          if (message.item_id) this.finalizedBorrowerItems.add(message.item_id);
          this.callbacks.onBorrowerTranscript(message.text.trim());
        }
        this.callbacks.onBorrowerPartial("");
        return;
      }
      if (message.type === "session.error") {
        this.callbacks.onError(message.message ?? "Voice Agent reported an error. Please try again.");
        return;
      }
      if (message.type === "reply.audio" && message.data) {
        void this.playAudio(message.data);
      }
      if (message.type === "tool.call" && message.name === "end_interview") {
        this.pendingEndCallId = message.call_id ?? null;
      }
      if (message.type === "reply.done" && this.pendingEndCallId && message.reply_id === `fc-${this.pendingEndCallId}`) {
        const callId = this.pendingEndCallId;
        this.pendingEndCallId = null;
        if (message.status !== "completed") return;
        this.socket?.send(JSON.stringify({
          type: "tool.result",
          call_id: callId,
          result: JSON.stringify({ ended: true }),
          is_error: false,
        }));
        this.callbacks.onEnded?.();
        this.stop();
      }
      if (message.type === "session.ended") {
        this.stop();
        this.callbacks.onEnded?.();
      }
      if (
        text &&
        (message.type === "transcript.agent" ||
          message.type === "agent_message" ||
          message.type === "text" ||
          !message.type)
      ) {
        this.callbacks.onPrompt(text);
      }
    } catch {
      this.callbacks.onError("Received an invalid Voice Agent message.");
    }
  }

  private async playAudio(encodedAudio: string) {
    try {
      const bytes = Uint8Array.from(atob(encodedAudio), character =>
        character.charCodeAt(0)
      );
      if (this.intentionalStop || !this.playbackContext) return;
      const pcm16 = new Int16Array(bytes.buffer);
      const samples = new Float32Array(pcm16.length);
      for (let index = 0; index < pcm16.length; index += 1) {
        samples[index] = pcm16[index] / 32768;
      }
      const audioBuffer = this.playbackContext.createBuffer(
        1,
        samples.length,
        24000
      );
      audioBuffer.getChannelData(0).set(samples);
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      this.playbackTime = Math.max(
        this.playbackTime,
        this.playbackContext.currentTime
      );
      source.start(this.playbackTime);
      this.playbackTime += audioBuffer.duration;
    } catch {
      this.callbacks.onError("Voice Agent audio response could not be played.");
    }
  }

  private toPcm16(samples: Float32Array, sourceRate: number) {
    const ratio = sourceRate / 24000;
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

