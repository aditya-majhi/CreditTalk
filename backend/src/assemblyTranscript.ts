import { z } from "zod";
import { AssemblyAI } from "assemblyai";

export const transcriptTurnSchema = z.object({
  id: z.string(),
  interviewId: z.string(),
  speaker: z.enum(["borrower", "agent"]),
  text: z.string(),
  timestamp: z.number(),
});

export type TranscriptTurn = z.infer<typeof transcriptTurnSchema>;

export async function createTranscriptStreamSession(language = "English") {
  const speechModel = language === "Hindi" ? "whisper-rt" : "u3-rt-pro";
  if (!process.env.ASSEMBLYAI_API_KEY) {
    return {
      enabled: false,
      mode: "demo",
      url: "wss://streaming.assemblyai.com/v3/ws",
      sessionId: `demo-transcript-${Date.now()}`,
      speechModel,
      format: "pcm16",
    };
  }

  try {
    const client = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
    const token = await client.streaming.createTemporaryToken({
      expires_in_seconds: 300,
      max_session_duration_seconds: 3600,
    });

    return {
      enabled: true,
      mode: "live",
      url: "wss://streaming.assemblyai.com/v3/ws",
      sessionId: `transcript-${Date.now()}`,
      token,
      speechModel,
      format: "pcm16",
    };
  } catch (error) {
    console.warn(
      "AssemblyAI transcript token generation failed; using demo mode.",
      error
    );
    return {
      enabled: false,
      mode: "demo",
      url: "wss://streaming.assemblyai.com/v3/ws",
      sessionId: `demo-transcript-${Date.now()}`,
      speechModel,
      format: "pcm16",
    };
  }
}

