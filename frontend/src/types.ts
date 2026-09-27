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

export interface Inconsistency {
  title: string;
  earlier: string;
  later: string;
  status: "needs_clarification";
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
  facts: BorrowerFact[];
  notes: string[];
  inconsistencies: Inconsistency[];
  summary: string;
  structuredSummary: StructuredInterviewSummary;
  clarifications: string[];
  creditBureauStatus: "connected" | "not_connected";
}

export interface Application {
  id: string;
  applicantName: string;
  loanType: LoanType;
  requestedAmount: number;
  loanPurpose?: string;
  createdAt: string;
  // Included by the applications list endpoint; a newly created application
  // has no interview yet.
  interviewStatus?: "pending" | "in_progress" | "completed" | null;
  reportInterviewId?: string | null;
}

export interface InterviewSession {
  id: string;
  applicationId: string;
  status: "pending" | "in_progress" | "completed";
  startedAt: string;
  completedAt?: string;
  analysisJson?: InterviewAnalysis | null;
  creditBureauStatus: "connected" | "not_connected";
}
