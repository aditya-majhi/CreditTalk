import { z } from "zod";
import axios from "axios";

export const voiceAgentSessionSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(["demo", "live"]),
  url: z.string(),
  sessionId: z.string(),
  token: z.string().optional(),
  agentId: z.string().optional(),
  prompt: z.string(),
});

export type VoiceAgentSession = z.infer<typeof voiceAgentSessionSchema>;

export async function createVoiceAgentSession(
  input: {
    applicantName?: string;
    loanType?: string;
    language?: string;
  } = {}
): Promise<VoiceAgentSession> {
  const language = input.language ?? "English";
  const basePrompt = `Conduct this interview in ${language}. What are you hoping to use the loan for?`;

  if (!process.env.ASSEMBLYAI_API_KEY) {
    return {
      enabled: false,
      mode: "demo",
      url: "wss://agents.assemblyai.com/v1/ws",
      sessionId: `demo-voice-${Date.now()}`,
      prompt: basePrompt,
    };
  }

  if (!process.env.ASSEMBLYAI_AGENT_ID) {
    return {
      enabled: false,
      mode: "demo",
      url: "wss://agents.assemblyai.com/v1/ws",
      sessionId: `demo-voice-${Date.now()}`,
      prompt: basePrompt,
    };
  }

  try {
    const tokenUrl = new URL("https://agents.assemblyai.com/v1/token");
    tokenUrl.searchParams.set("expires_in_seconds", "300");
    tokenUrl.searchParams.set("max_session_duration_seconds", "3600");
    const response = await axios.get<{ token?: string }>(tokenUrl.toString(), {
      headers: { authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` },
    });
    const payload = response.data;

    return {
      enabled: true,
      mode: "live",
      url: "wss://agents.assemblyai.com/v1/ws",
      sessionId: `voice-${Date.now()}`,
      token: payload.token,
      agentId: process.env.ASSEMBLYAI_AGENT_ID,
      prompt: `Hello ${input.applicantName ?? "borrower"}. This is a ${input.loanType ?? "personal"} loan application. Conduct the interview in ${language}. What are you hoping to use the loan for?`,
    };
  } catch (error) {
    console.warn(
      "AssemblyAI voice agent token generation failed; using demo mode.",
      error
    );
    return {
      enabled: false,
      mode: "demo",
      url: "wss://agents.assemblyai.com/v1/ws",
      sessionId: `demo-voice-${Date.now()}`,
      prompt: basePrompt,
    };
  }
}
