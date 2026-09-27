import { create } from "zustand";
import type { Application, InterviewAnalysis, TranscriptTurn } from "./types";

interface AppState {
  applications: Application[];
  selectedApplicationId: string | null;
  activeInterviewId: string | null;
  transcript: TranscriptTurn[];
  analysis: InterviewAnalysis | null;
  setApplications: (applications: Application[]) => void;
  setSelectedApplicationId: (id: string | null) => void;
  setActiveInterviewId: (id: string | null) => void;
  addTranscriptTurn: (turn: TranscriptTurn) => void;
  setTranscript: (turns: TranscriptTurn[]) => void;
  setAnalysis: (analysis: InterviewAnalysis | null) => void;
  resetInterview: () => void;
}

export const useAppStore = create<AppState>(set => ({
  applications: [],
  selectedApplicationId: null,
  activeInterviewId: null,
  transcript: [],
  analysis: null,
  setApplications: applications => set({ applications }),
  setSelectedApplicationId: id => set({ selectedApplicationId: id }),
  setActiveInterviewId: id => set({ activeInterviewId: id }),
  addTranscriptTurn: turn =>
    set(state => ({ transcript: [...state.transcript, turn] })),
  setTranscript: transcript => set({ transcript }),
  setAnalysis: analysis => set({ analysis }),
  resetInterview: () => set({ transcript: [], analysis: null }),
}));
