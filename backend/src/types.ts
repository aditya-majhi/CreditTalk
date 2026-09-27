export type LoanType =
  | "personal"
  | "home"
  | "education"
  | "vehicle"
  | "business"
  | "other";

export type TranscriptSpeaker = "borrower" | "agent";

export interface TranscriptTurn {
  id: string;
  interviewId: string;
  speaker: TranscriptSpeaker;
  text: string;
  timestamp: number;
}

export interface BorrowerFact {
  key: string;
  value: unknown;
  category: string;
  sourceTurnId: string;
}

export interface StructuredInterviewSummary {
  applicant: string;
  loan: {
    type: string;
    requestedAmount: number;
    purpose: string;
  };
  income: {
    monthly: number | null;
    employment: string | null;
  };
  declaredObligations: {
    monthlyEmi: number | null;
  };
  conversationFinancials?: {
    monthlyExpenses: number | null;
    savings: number | null;
    requestedAmount: number | null;
  };
  clarifications: string[];
  creditBureau: {
    status: "connected" | "not_connected";
  };
}

export interface InterviewAnalysis {
  extraction?: { provider: "gemini"; model: string; generatedAt: string };
  facts: BorrowerFact[];
  notes: string[];
  inconsistencies: Array<{
    title: string;
    earlier: string;
    later: string;
    status: "needs_clarification";
  }>;
  summary: string;
  structuredSummary: StructuredInterviewSummary;
  clarifications: string[];
  creditBureauStatus: "connected" | "not_connected";
}

export interface ApplicationRecord {
  id: string;
  applicantName: string;
  loanType: LoanType;
  requestedAmount: number;
  loanPurpose?: string;
  createdAt: string;
}

export interface InterviewRecord {
  id: string;
  applicationId: string;
  status: "pending" | "in_progress" | "completed";
  startedAt: string;
  completedAt?: string;
  analysisJson?: InterviewAnalysis | null;
  creditBureauStatus: "connected" | "not_connected";
  consentReference?: string;
  transcriptTurns?: TranscriptTurn[];
}

export interface CreditBureauProvider {
  isConfigured(): boolean;
  getCreditReport(input: {
    applicantId: string;
    consentReference: string;
  }): Promise<CreditReport>;
}

export interface CreditReport {
  status: "connected" | "not_connected";
  accountsFound?: Array<{ name: string; status: string; balance?: number }>;
  differences?: string[];
  provider?: string;
}

export interface ApiErrorResponse {
  error: string;
}
