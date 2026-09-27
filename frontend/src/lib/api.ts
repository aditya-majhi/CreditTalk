import type {
  Application,
  InterviewAnalysis,
  LoanType,
  TranscriptTurn,
} from "../types";
import axios, { type AxiosRequestConfig } from "axios";
import { supabase } from "./supabase";

const configuredApiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api";
const API_BASE_URL = configuredApiUrl.replace(/\/+$/, "").endsWith("/api")
  ? configuredApiUrl.replace(/\/+$/, "")
  : `${configuredApiUrl.replace(/\/+$/, "")}/api`;

interface ApiOptions {
  method?: AxiosRequestConfig["method"];
  data?: unknown;
  token?: string;
}

async function request<T>(path: string, options?: ApiOptions): Promise<T> {
  let token = options?.token;
  if (token === undefined) {
    const result = await supabase?.auth.getSession();
    token = result?.data.session?.access_token;
  }
  const res = await axios.request<T>({
    url: `${API_BASE_URL}${path}`,
    method: options?.method ?? "GET",
    data: options?.data,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  return res.data;
}

export const api = {
  health: () => request<{ ok: boolean; status: string }>("/health"),
  authMe: () => request<{ authenticated: boolean; developmentMode?: boolean }>("/auth/me"),
  getBorrowerSession: (token: string) =>
    request<{
      id: string;
      applicationId: string;
      status: string;
      transcriptTurns: TranscriptTurn[];
      applicantName: string;
      loanType: string;
      completedAt?: string;
    }>("/borrower/session", { token }),
  getApplications: () => request<Application[]>("/applications"),
  extractApplication: (notes: string) => request<{
    applicantName: string | null; loanType: LoanType | null;
    requestedAmount: number | null; loanPurpose: string | null;
  }>("/applications/extract", { method: "POST", data: { notes } }),
  regenerateReport: (interviewId: string) => request<InterviewAnalysis>(`/interviews/${interviewId}/report`, { method: "POST" }),
  getApplicationInterviews: (applicationId: string) =>
    request<Array<{
      id: string;
      applicationId: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      analysisJson?: InterviewAnalysis | null;
      transcriptTurns: TranscriptTurn[];
    }>>(`/applications/${applicationId}/interviews`),
  getInterview: (interviewId: string, token?: string) =>
    request<{
      id: string;
      applicationId: string;
      status: string;
      startedAt: string;
      completedAt?: string;
      analysisJson?: InterviewAnalysis | null;
      transcriptTurns: TranscriptTurn[];
      applicantName?: string;
      loanType?: string;
    }>(`/interviews/${interviewId}`, { token }),
  createInterview: (applicationId: string) =>
    request<{
      id: string;
      applicationId: string;
      status: string;
      startedAt: string;
      transcriptTurns: TranscriptTurn[];
      borrowerLink: string;
    }>(`/applications/${applicationId}/interviews`, { method: "POST" }),
  createApplication: (payload: {
    applicantName: string;
    loanType: LoanType;
    requestedAmount: number;
    loanPurpose?: string;
  }) =>
    request<Application>("/applications", {
      method: "POST",
      data: payload,
    }),
  analyzeInterview: (interviewId: string, turns: TranscriptTurn[], token?: string) =>
    request<{ analysis: InterviewAnalysis }>(
      `/interviews/${interviewId}/analyze`,
      {
        method: "POST",
        data: turns,
        token,
      }
    ),
  getVoiceSession: (applicationId: string, token?: string, language?: string) =>
    request<{
      enabled: boolean;
      mode: string;
      url: string;
      sessionId: string;
      token?: string;
      agentId?: string;
      prompt: string;
    }>(`/voice-session?applicationId=${encodeURIComponent(applicationId)}&language=${encodeURIComponent(language ?? "English")}`, { token }),
  getTranscriptSession: (token?: string, language?: string) =>
    request<{
      enabled: boolean;
      mode: string;
      url: string;
      sessionId: string;
      token?: string;
      speechModel: string;
      format: string;
    }>(`/transcript-session?language=${encodeURIComponent(language ?? "English")}`, { token }),
  saveConsent: (payload: {
    granted: boolean;
    reference?: string;
    interviewId?: string;
  }, token?: string) =>
    request<{ granted: boolean; reference: string; status: string }>(
      "/consent",
      {
        method: "POST",
        data: payload,
        token,
      }
    ),
  askClarification: (interviewId: string, turns: TranscriptTurn[], token?: string) =>
    request<{
      question: string;
      status: string;
      inconsistencies: Array<{
        title: string;
        earlier: string;
        later: string;
        status: string;
      }>;
    }>(`/interviews/${interviewId}/clarify`, {
      method: "POST",
      data: turns,
      token,
    }),
  finalizeInterview: (interviewId: string, turns: TranscriptTurn[], token?: string) =>
    request<{
      applicant: string;
      loanType: string;
      requestedAmount: number;
      purpose: string;
      summary: string;
      facts: Array<{
        key: string;
        value: unknown;
        category: string;
        sourceTurnId: string;
      }>;
      notes: string[];
      clarifications: string[];
      structuredSummary: InterviewAnalysis["structuredSummary"];
      creditBureauStatus: string;
    }>(`/interviews/${interviewId}/finalize`, {
      method: "POST",
      data: turns,
      token,
    }),
};

