import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import type {
  ApplicationRecord,
  InterviewRecord,
  LoanType,
  TranscriptTurn,
} from "./types.js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "Supabase credentials not configured. Running in demo mode without database persistence."
  );
}

export const supabase =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export type DemoInterview = InterviewRecord & {
  transcriptTurns: TranscriptTurn[];
  borrowerTokenHash?: string;
};

const demoInterviewSeed: DemoInterview = {
  id: "demo",
  applicationId: "app-raj-sharma",
  status: "pending",
  startedAt: new Date().toISOString(),
  creditBureauStatus: "not_connected",
  transcriptTurns: [
    {
      id: "turn-1",
      interviewId: "demo",
      speaker: "agent",
      text: "What are you hoping to use the loan for?",
      timestamp: 0,
    },
    {
      id: "turn-2",
      interviewId: "demo",
      speaker: "borrower",
      text: "We are renovating our home and need a personal loan for the project.",
      timestamp: 1000,
    },
    {
      id: "turn-3",
      interviewId: "demo",
      speaker: "agent",
      text: "What is your regular monthly income?",
      timestamp: 2000,
    },
    {
      id: "turn-4",
      interviewId: "demo",
      speaker: "borrower",
      text: "My salary is about ₹72,000 per month and sometimes I get bonuses.",
      timestamp: 3000,
    },
  ],
};

export const demoInterviews = new Map<string, DemoInterview>([
  [demoInterviewSeed.id, demoInterviewSeed],
]);

export function getDemoInterview(
  interviewId = "demo",
  applicationId = "app-raj-sharma"
): DemoInterview {
  const existing = demoInterviews.get(interviewId);

  if (existing) {
    return {
      ...existing,
      transcriptTurns: [...existing.transcriptTurns],
    };
  }

  const created: DemoInterview = {
    ...demoInterviewSeed,
    id: interviewId,
    applicationId,
    startedAt: new Date().toISOString(),
    transcriptTurns: demoInterviewSeed.transcriptTurns.map(turn => ({
      ...turn,
      id: `${interviewId}-${turn.id}`,
      interviewId,
    })),
  };

  demoInterviews.set(interviewId, created);

  return {
    ...created,
    transcriptTurns: [...created.transcriptTurns],
  };
}

export function updateDemoInterview(
  interviewId: string,
  updates: Partial<DemoInterview>
): DemoInterview {
  const current = getDemoInterview(interviewId);
  const next: DemoInterview = {
    ...current,
    ...updates,
    transcriptTurns: updates.transcriptTurns
      ? [...updates.transcriptTurns]
      : [...current.transcriptTurns],
  };

  demoInterviews.set(interviewId, next);

  return {
    ...next,
    transcriptTurns: [...next.transcriptTurns],
  };
}

export async function createInterview(
  applicationId: string,
  borrowerTokenHash: string
): Promise<DemoInterview> {
  if (!supabase) {
    const interview: DemoInterview = {
      id: `interview-${randomBytes(12).toString("hex")}`,
      applicationId,
      status: "in_progress",
      startedAt: new Date().toISOString(),
      creditBureauStatus: "not_connected",
      borrowerTokenHash,
      transcriptTurns: [],
    };
    demoInterviews.set(interview.id, interview);
    return { ...interview, transcriptTurns: [] };
  }

  const { data, error } = await supabase
    .from("interviews")
    .insert({
      application_id: applicationId,
      status: "in_progress",
      borrower_token_hash: borrowerTokenHash,
    })
    .select(
      "id, application_id, status, started_at, completed_at, analysis_json, credit_bureau_status, consent_reference"
    )
    .single();

  if (error) throw error;
  return {
    id: data.id,
    applicationId: data.application_id,
    status: data.status,
    startedAt: data.started_at,
    completedAt: data.completed_at ?? undefined,
    analysisJson: data.analysis_json ?? null,
    creditBureauStatus: data.credit_bureau_status,
    consentReference: data.consent_reference ?? undefined,
    transcriptTurns: [],
  };
}

export async function getInterview(
  interviewId: string
): Promise<DemoInterview | undefined> {
  if (!supabase)
    return demoInterviews.has(interviewId)
      ? getDemoInterview(interviewId)
      : undefined;

  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select(
      "id, application_id, status, started_at, completed_at, analysis_json, credit_bureau_status, consent_reference"
    )
    .eq("id", interviewId)
    .maybeSingle();

  if (interviewError) throw interviewError;
  if (!interview) return undefined;

  const { data: turns, error: turnsError } = await supabase
    .from("transcript_turns")
    .select("id, interview_id, speaker, text, timestamp_ms")
    .eq("interview_id", interviewId)
    .order("timestamp_ms", { ascending: true });

  if (turnsError) throw turnsError;
  return {
    id: interview.id,
    applicationId: interview.application_id,
    status: interview.status,
    startedAt: interview.started_at,
    completedAt: interview.completed_at ?? undefined,
    analysisJson: interview.analysis_json ?? null,
    creditBureauStatus: interview.credit_bureau_status,
    consentReference: interview.consent_reference ?? undefined,
    transcriptTurns: (turns ?? []).map(turn => ({
      id: turn.id,
      interviewId: turn.interview_id,
      speaker: turn.speaker,
      text: turn.text,
      timestamp: Number(turn.timestamp_ms),
    })),
  };
}

export async function getInterviewByBorrowerTokenHash(
  tokenHash: string
): Promise<DemoInterview | undefined> {
  if (!supabase) {
    const interview = [...demoInterviews.values()].find(
      item => item.borrowerTokenHash === tokenHash
    );
    return interview ? getDemoInterview(interview.id) : undefined;
  }

  const { data, error } = await supabase
    .from("interviews")
    .select(
      "id, application_id, status, started_at, completed_at, analysis_json, credit_bureau_status, consent_reference"
    )
    .eq("borrower_token_hash", tokenHash)
    .maybeSingle();

  if (error) throw error;
  if (!data) return undefined;
  return getInterview(data.id);
}

export async function listInterviewsForApplication(
  applicationId: string
): Promise<DemoInterview[]> {
  if (!supabase) {
    return [...demoInterviews.values()]
      .filter(interview => interview.applicationId === applicationId)
      .map(interview => getDemoInterview(interview.id));
  }
  const { data, error } = await supabase
    .from("interviews")
    .select("id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const interviews = await Promise.all(
    (data ?? []).map(row => getInterview(row.id))
  );
  return interviews.filter((interview): interview is DemoInterview =>
    Boolean(interview)
  );
}

export async function persistInterview(
  interview: DemoInterview
): Promise<void> {
  if (!supabase) return;

  // Save transcript rows first. This prevents a failed transcript write from
  // leaving the interview marked completed and causing a misleading 409 on retry.
  if (interview.transcriptTurns.length > 0) {
    const { error: turnsError } = await supabase
      .from("transcript_turns")
      .upsert(
        interview.transcriptTurns.map(turn => ({
          // Browser/demo turn IDs are readable strings (for example turn-123).
          // The Supabase schema uses UUID primary keys, so derive a stable UUID
          // from the interview and turn IDs before persisting.
          id: transcriptTurnUuid(interview.id, turn.id),
          interview_id: interview.id,
          speaker: turn.speaker,
          text: turn.text,
          timestamp_ms: turn.timestamp,
        }))
      );

    if (turnsError) throw turnsError;
  }

  const { error: interviewError } = await supabase
    .from("interviews")
    .update({
      status: interview.status,
      completed_at: interview.completedAt ?? null,
      analysis_json: interview.analysisJson ?? null,
      credit_bureau_status: interview.creditBureauStatus,
      consent_reference: interview.consentReference ?? null,
    })
    .eq("id", interview.id);

  if (interviewError) throw interviewError;
}

function transcriptTurnUuid(interviewId: string, turnId: string) {
  // Keep saved UUIDs stable when an interview is loaded and saved again.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      turnId
    )
  )
    return turnId;
  const hex = createHash("sha256")
    .update(`${interviewId}:${turnId}`)
    .digest("hex")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20)}`;
}

export const demoApplications: ApplicationRecord[] = [
  {
    id: "app-raj-sharma",
    applicantName: "Raj Sharma",
    loanType: "personal",
    requestedAmount: 700000,
    loanPurpose: "Home renovation",
    createdAt: new Date().toISOString(),
  },
];

function mapApplication(row: {
  id: string;
  applicant_name: string;
  loan_type: LoanType;
  requested_amount: number;
  loan_purpose: string | null;
  created_at: string;
}): ApplicationRecord {
  return {
    id: row.id,
    applicantName: row.applicant_name,
    loanType: row.loan_type,
    requestedAmount: Number(row.requested_amount),
    loanPurpose: row.loan_purpose ?? undefined,
    createdAt: row.created_at,
  };
}

type InterviewSummaryRow = {
  id: string;
  status: InterviewRecord["status"];
  started_at: string;
  report_summary: string | null;
};
type ApplicationListItem = ApplicationRecord & {
  interviewStatus: InterviewRecord["status"] | null;
  reportInterviewId: string | null;
  completedInterviewId: string | null;
};

function summarizeInterviews(
  interviews: InterviewSummaryRow[]
): Pick<
  ApplicationListItem,
  "interviewStatus" | "reportInterviewId" | "completedInterviewId"
> {
  const newestFirst = [...interviews].sort(
    (a, b) =>
      Date.parse(b.started_at) - Date.parse(a.started_at) ||
      b.id.localeCompare(a.id)
  );
  // Preserve the dashboard rule: any completed interview marks the application
  // finished, even if a newer unfinished session exists.
  const completed = newestFirst.find(
    interview => interview.status === "completed"
  );
  return {
    interviewStatus: completed ? "completed" : (newestFirst[0]?.status ?? null),
    completedInterviewId: completed?.id ?? null,
    reportInterviewId: completed?.report_summary ? completed.id : null,
  };
}

const demoOwners = new Map<string, string>([
  ["app-raj-sharma", "local-demo-lender"],
]);

export async function lenderOwnsApplication(
  applicationId: string,
  lenderId: string
): Promise<boolean> {
  if (!lenderId) return false;
  if (!supabase) return demoOwners.get(applicationId) === lenderId;
  const { data, error } = await supabase
    .from("applications")
    .select("id")
    .eq("id", applicationId)
    .eq("lender_id", lenderId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function lenderOwnsInterview(
  interviewId: string,
  lenderId: string
): Promise<boolean> {
  if (!lenderId) return false;
  if (!supabase) {
    const interview = demoInterviews.get(interviewId);
    return Boolean(
      interview &&
      (await lenderOwnsApplication(interview.applicationId, lenderId))
    );
  }
  const { data, error } = await supabase
    .from("interviews")
    .select("id, applications!inner(lender_id)")
    .eq("id", interviewId)
    .eq("applications.lender_id", lenderId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function listApplications(
  lenderId: string
): Promise<ApplicationListItem[]> {
  if (!lenderId) throw new Error("Lender identity is required");
  if (!supabase) {
    const grouped = new Map<string, InterviewSummaryRow[]>();
    for (const interview of demoInterviews.values()) {
      const rows = grouped.get(interview.applicationId) ?? [];
      rows.push({
        id: interview.id,
        status: interview.status,
        started_at: interview.startedAt,
        report_summary: interview.analysisJson?.summary ?? null,
      });
      grouped.set(interview.applicationId, rows);
    }
    return demoApplications
      .filter(application => demoOwners.get(application.id) === lenderId)
      .map(application => ({
        ...application,
        ...summarizeInterviews(grouped.get(application.id) ?? []),
      }));
  }

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, applicant_name, loan_type, requested_amount, loan_purpose, created_at, interviews(id, status, started_at, report_summary:analysis_json->>summary)"
    )
    .eq("lender_id", lenderId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(row => ({
    ...mapApplication(row),
    ...summarizeInterviews(row.interviews as InterviewSummaryRow[]),
  }));
}

export async function getApplication(
  applicationId: string
): Promise<ApplicationRecord | undefined> {
  if (!supabase) {
    return demoApplications.find(item => item.id === applicationId);
  }

  const { data, error } = await supabase
    .from("applications")
    .select(
      "id, applicant_name, loan_type, requested_amount, loan_purpose, created_at"
    )
    .eq("id", applicationId)
    .maybeSingle();

  if (error) throw error;
  return data ? mapApplication(data) : undefined;
}

export async function createApplication(
  input: {
    applicantName: string;
    loanType: LoanType;
    requestedAmount: number;
    loanPurpose?: string;
  },
  lenderId: string
): Promise<ApplicationRecord> {
  if (!lenderId) throw new Error("Lender identity is required");
  if (!supabase) {
    const application: ApplicationRecord = {
      id: `app-${Date.now()}`,
      applicantName: input.applicantName,
      loanType: input.loanType,
      requestedAmount: input.requestedAmount,
      loanPurpose: input.loanPurpose ?? "Not specified",
      createdAt: new Date().toISOString(),
    };

    demoApplications.push(application);
    demoOwners.set(application.id, lenderId);
    return application;
  }

  const { data, error } = await supabase
    .from("applications")
    .insert({
      lender_id: lenderId,
      applicant_name: input.applicantName,
      loan_type: input.loanType,
      requested_amount: input.requestedAmount,
      loan_purpose: input.loanPurpose ?? null,
    })
    .select(
      "id, applicant_name, loan_type, requested_amount, loan_purpose, created_at"
    )
    .single();

  if (error) throw error;
  return mapApplication(data);
}
