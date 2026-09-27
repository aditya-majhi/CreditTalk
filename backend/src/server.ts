import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import {
  createApplication,
  createInterview,
  type DemoInterview,
  getApplication,
  getInterview,
  getInterviewByBorrowerTokenHash,
  listApplications,
  listInterviewsForApplication,
  persistInterview,
  supabase,
  updateDemoInterview,
} from "./db.js";
import { ExtractionError, extractApplicationDraft, generateInterviewAnalysis } from "./gemini.js";
import { createVoiceAgentSession } from "./assemblyVoice.js";
import { createTranscriptStreamSession } from "./assemblyTranscript.js";
import { DemoCreditBureauProvider } from "./creditBureau.js";
import type { TranscriptTurn } from "./types.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3000);
const requestCounts = new Map<string, { count: number; resetAt: number }>();

// Express 4 does not forward rejected async route handlers automatically.
function asyncRoute(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173" }));
app.use(express.json({ limit: "256kb" }));
app.use((req, res, next) => {
  const now = Date.now();
  const clientKey = req.ip ?? req.socket.remoteAddress ?? "unknown";
  const current = requestCounts.get(clientKey);
  if (!current || current.resetAt <= now) {
    requestCounts.set(clientKey, { count: 1, resetAt: now + 60_000 });
    return next();
  }
  current.count += 1;
  if (current.count > 120)
    return res.status(429).json({ error: "Too many requests" });
  return next();
});

if (process.env.NODE_ENV === "production" && !supabase) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in production.");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function requireLender(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === "/health" || req.path === "/borrower/session") return next();

  const authorization = req.header("authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;

  // Keep local demo mode usable without a Supabase project. Production always requires Supabase.
  if (!supabase && process.env.NODE_ENV !== "production") return next();

  if (candidate && supabase && candidate.split(".").length === 3) {
    try {
      const { data: authData, error: authError } = await supabase.auth.getUser(candidate);
      if (!authError && authData.user) {
        // For now every confirmed Supabase account becomes a lender on first use.
        // Preserve an existing inactive row so a future revocation remains effective.
        const { data: lender, error: lookupError } = await supabase
          .from("lender_users")
          .select("user_id, is_active")
          .eq("user_id", authData.user.id)
          .maybeSingle();
        if (lookupError) {
          console.error("Lender authorization lookup failed", lookupError);
          return res.status(503).json({ error: "Could not verify lender access" });
        }
        if (!lender) {
          const { error: provisionError } = await supabase
            .from("lender_users")
            .insert({ user_id: authData.user.id, is_active: true });
          if (provisionError) {
            console.error("Lender account provisioning failed", provisionError);
            return res.status(503).json({ error: "Could not provision lender access" });
          }
        } else if (!lender.is_active) {
          return res.status(403).json({ error: "This lender account is inactive" });
        }
        res.locals.lenderUser = { id: authData.user.id, email: authData.user.email };
        return next();
      }
    } catch (error) {
      console.error("Lender token verification failed", error);
      return res.status(503).json({ error: "Could not verify lender sign-in" });
    }
  }

  // Borrower interview links are separate opaque tokens; keep their restricted route access.
  if (candidate) {
    try {
      const interview = await getInterviewByBorrowerTokenHash(tokenHash(candidate));
      const interviewRoute = req.path.match(/^\/interviews\/([^/]+)(?:\/(analyze|clarify|finalize|credit-report))?$/);
      const allowedInterviewRoute = interviewRoute && interviewRoute[1] === interview?.id && (
        (req.method === "GET" && !interviewRoute[2]) ||
        (req.method === "POST" && ["analyze", "clarify", "finalize"].includes(interviewRoute[2] ?? ""))
      );
      const allowedVoiceRoute = interview?.status !== "completed" && req.method === "GET" && req.path === "/voice-session" && req.query.applicationId === interview?.applicationId;
      const allowedTranscriptRoute = interview?.status !== "completed" && req.method === "GET" && req.path === "/transcript-session";
      const allowedConsentRoute = req.method === "POST" && req.path === "/consent" && req.body?.interviewId === interview?.id;
      const borrowerMutation = req.method !== "GET";
      if (interview && borrowerMutation && interview.status === "completed") {
        return res.status(409).json({ error: "This interview is already complete" });
      }
      if (interview && (allowedInterviewRoute || allowedVoiceRoute || allowedTranscriptRoute || allowedConsentRoute)) {
        res.locals.borrowerInterviewId = interview.id;
        res.locals.borrowerAuthorized = true;
        return next();
      }
    } catch (error) {
      console.error("Borrower link validation failed", error);
      return res.status(500).json({ error: "Could not validate borrower link" });
    }
  }

  return res.status(401).json({ error: "Lender sign-in required" });
}

app.get("/api/borrower/session", asyncRoute(async (req, res) => {
  const authorization = req.header("authorization") ?? "";
  const candidate = authorization.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!candidate) return res.status(401).json({ error: "Borrower link is invalid" });
  try {
    const interview = await getInterviewByBorrowerTokenHash(tokenHash(candidate));
    if (!interview) return res.status(404).json({ error: "Borrower link is invalid or expired" });
    const application = await getApplication(interview.applicationId);
    if (!application) return res.status(404).json({ error: "Application not found" });
    return res.json({
      id: interview.id,
      applicationId: application.id,
      status: interview.status,
      transcriptTurns: interview.transcriptTurns,
      applicantName: application.applicantName,
      loanType: application.loanType,
      completedAt: interview.completedAt,
    });
  } catch (error) {
    console.error("Borrower session could not be loaded", error);
    return res.status(500).json({ error: "Borrower session unavailable" });
  }
}));

app.use("/api", requireLender);

app.get("/api/auth/me", (req, res) => {
  if (!supabase && process.env.NODE_ENV !== "production") {
    return res.json({ authenticated: true, developmentMode: true });
  }
  return res.json({ authenticated: true, user: res.locals.lenderUser });
});

const createApplicationSchema = z.object({
  applicantName: z.string().min(2),
  loanType: z.enum([
    "personal",
    "home",
    "education",
    "vehicle",
    "business",
    "other",
  ]),
  requestedAmount: z.number().positive(),
  loanPurpose: z.string().optional(),
});

const transcriptTurnSchema = z.object({
  id: z.string().min(1).max(120),
  interviewId: z.string().min(1).max(120),
  speaker: z.enum(["borrower", "agent"]),
  text: z.string().max(5000),
  timestamp: z.number().nonnegative(),
});

function turnsMatchInterview(interviewId: string, turns: TranscriptTurn[]) {
  const ids = new Set<string>();
  return turns.every(turn => {
    if (turn.interviewId !== interviewId || ids.has(turn.id)) return false;
    ids.add(turn.id);
    return true;
  });
}

const consentSchema = z.object({
  granted: z.boolean(),
  reference: z.string().optional(),
  interviewId: z.string().optional(),
});

async function getInterviewContext(interviewId: string) {
  const interview = await getInterview(interviewId);
  if (!interview) return { interview: undefined, application: undefined };
  const application = await getApplication(interview.applicationId);
  return { interview, application };
}

function applyInterviewUpdates(
  current: DemoInterview,
  updates: Partial<DemoInterview>
): DemoInterview {
  const next = {
    ...current,
    ...updates,
    transcriptTurns: updates.transcriptTurns
      ? [...updates.transcriptTurns]
      : [...current.transcriptTurns],
  };
  return supabase ? next : updateDemoInterview(current.id, updates);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "CreditTalk backend is running" });
});

app.get("/api/applications", asyncRoute(async (_req, res) => {
  try {
    res.json(await listApplications());
  } catch (error) {
    console.error("Failed to list applications", error);
    res.status(500).json({ error: "Applications unavailable" });
  }
}));

app.post("/api/applications", asyncRoute(async (req, res) => {
  const parsed = createApplicationSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid applicant data" });
  }

  try {
    return res.status(201).json(await createApplication(parsed.data));
  } catch (error) {
    console.error("Failed to create application", error);
    return res.status(500).json({ error: "Application could not be created" });
  }
}));

app.post("/api/applications/extract", asyncRoute(async (req, res) => {
  const parsed = z.object({ notes: z.string().trim().min(10).max(15000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Provide application notes between 10 and 15,000 characters." });
  return res.json(await extractApplicationDraft(parsed.data.notes));
}));

app.get("/api/applications/:id", asyncRoute(async (req, res) => {
  const application = await getApplication(String(req.params.id));
  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }
  return res.json(application);
}));

app.post("/api/applications/:id/interviews", asyncRoute(async (req, res) => {
  const application = await getApplication(String(req.params.id));

  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }

  const borrowerToken = randomBytes(32).toString("base64url");
  const interview = await createInterview(application.id, tokenHash(borrowerToken));
  const { borrowerTokenHash: _borrowerTokenHash, ...publicInterview } = interview;
  const frontendUrl = (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(/\/$/, "");
  return res.status(201).json({
    ...publicInterview,
    borrowerLink: `${frontendUrl}/borrow#${borrowerToken}`,
  });
}));

app.get("/api/applications/:id/interviews", asyncRoute(async (req, res) => {
  try {
    const application = await getApplication(String(req.params.id));
    if (!application) return res.status(404).json({ error: "Application not found" });
    const interviews = await listInterviewsForApplication(application.id);
    return res.json(interviews.map(interview => ({
      ...interview,
      analysisJson: interview.analysisJson,
    })));
  } catch (error) {
    console.error("Failed to list application interviews", error);
    return res.status(500).json({ error: "Interview reports unavailable" });
  }
}));

app.get("/api/interviews/:id", asyncRoute(async (req, res) => {
  const { interview } = await getInterviewContext(String(req.params.id));

  if (!interview) {
    return res.status(404).json({ error: "Interview not found" });
  }

  if (res.locals.borrowerAuthorized) {
    const { application } = await getInterviewContext(String(req.params.id));
    return res.json({
      id: interview.id,
      applicationId: interview.applicationId,
      status: interview.status,
      startedAt: interview.startedAt,
      completedAt: interview.completedAt,
      transcriptTurns: interview.transcriptTurns,
      applicantName: application?.applicantName,
      loanType: application?.loanType,
    });
  }
  return res.json(interview);
}));

app.post("/api/interviews/:id/report", asyncRoute(async (req, res) => {
  const { interview, application } = await getInterviewContext(String(req.params.id));
  if (!interview || !application) return res.status(404).json({ error: "Interview not found" });
  if (interview.status !== "completed") return res.status(409).json({ error: "Complete the interview before generating its report." });
  const analysis = await generateInterviewAnalysis(application, interview.transcriptTurns);
  await persistInterview({ ...interview, analysisJson: analysis });
  if (!supabase) updateDemoInterview(interview.id, { analysisJson: analysis });
  return res.json(analysis);
}));

app.post("/api/interviews/:id/analyze", asyncRoute(async (req, res) => {
  const parsed = z.array(transcriptTurnSchema).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Transcript payload invalid" });
  }

  const turns = parsed.data;
  if (!turnsMatchInterview(String(req.params.id), turns)) {
    return res.status(400).json({ error: "Transcript turns do not match this interview" });
  }
  const { interview: currentInterview, application } =
    await getInterviewContext(String(req.params.id));

  if (!application || !currentInterview) {
    return res.status(404).json({ error: "Application not found" });
  }
  if (currentInterview.status === "completed") return res.status(409).json({ error: "This interview is already complete" });
  await persistInterview({ ...currentInterview, transcriptTurns: turns });
  if (!supabase) updateDemoInterview(currentInterview.id, { transcriptTurns: turns });
  const analysis = await generateInterviewAnalysis(application, turns);

  const updatedInterview = applyInterviewUpdates(currentInterview, {
    status: "in_progress",
    transcriptTurns: turns,
    analysisJson: analysis,
  });

  await persistInterview(updatedInterview);

  return res.json({ analysis, interview: updatedInterview });
}));

app.get("/api/config", (_req, res) => {
  res.json({
    creditBureauConfigured: Boolean(
      process.env.CREDIT_BUREAU_PROVIDER &&
      process.env.CREDIT_BUREAU_API_URL &&
      process.env.CREDIT_BUREAU_API_KEY
    ),
    assemblyAIConfigured: Boolean(process.env.ASSEMBLYAI_API_KEY),
    supabaseConfigured: Boolean(supabase),
  });
});

app.get("/api/voice-session", asyncRoute(async (req, res) => {
  const applicationId =
    typeof req.query.applicationId === "string"
      ? req.query.applicationId
      : "app-raj-sharma";
  const application = await getApplication(applicationId);
  if (!application) {
    return res.status(404).json({ error: "Application not found" });
  }
  const language = typeof req.query.language === "string" ? req.query.language : "English";
  const session = await createVoiceAgentSession({
    applicantName: application.applicantName,
    loanType: application.loanType,
    language,
  });

  res.json(session);
}));

app.get("/api/transcript-session", asyncRoute(async (req, res) => {
  const language = typeof req.query.language === "string" ? req.query.language : "English";
  const session = await createTranscriptStreamSession(language);
  res.json(session);
}));

app.post("/api/consent", asyncRoute(async (req, res) => {
  const parsed = consentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Consent payload invalid" });
  }

  const reference = parsed.data.granted
    ? `consent-${randomBytes(16).toString("hex")}`
    : "revoked";
  if (parsed.data.interviewId) {
    const interview = await getInterview(parsed.data.interviewId);
    if (!interview)
      return res.status(404).json({ error: "Interview not found" });
    const updatedInterview = applyInterviewUpdates(interview, {
      consentReference: parsed.data.granted ? reference : undefined,
    });
    await persistInterview(updatedInterview);
  }

  return res.json({
    granted: parsed.data.granted,
    reference,
    status: parsed.data.granted ? "approved" : "not_granted",
  });
}));

app.post("/api/interviews/:id/credit-report", asyncRoute(async (req, res) => {
  const parsed = z
    .object({ consentReference: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Consent reference is required" });
  }

  const { application } = await getInterviewContext(String(req.params.id));
  const interview = await getInterview(String(req.params.id));
  if (!application || !interview)
    return res.status(404).json({ error: "Application not found" });
  if (interview.consentReference !== parsed.data.consentReference) {
    return res
      .status(403)
      .json({ error: "Valid borrower consent is required" });
  }

  try {
    const provider = new DemoCreditBureauProvider();
    const report = await provider.getCreditReport({
      applicantId: application.id,
      consentReference: parsed.data.consentReference,
    });
    return res.json(report);
  } catch (error) {
    console.error("Credit bureau request failed", error);
    return res.status(502).json({ error: "Credit bureau unavailable" });
  }
}));

app.post("/api/interviews/:id/clarify", asyncRoute(async (req, res) => {
  const parsed = z.array(transcriptTurnSchema).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Transcript payload invalid" });
  }

  if (!turnsMatchInterview(String(req.params.id), parsed.data)) {
    return res.status(400).json({ error: "Transcript turns do not match this interview" });
  }

  const interview = await getInterview(String(req.params.id));
  if (!interview) return res.status(404).json({ error: "Interview not found" });
  const clarifications = interview.analysisJson?.clarifications ?? [];
  const inconsistencies = interview.analysisJson?.inconsistencies ?? [];
  const question = clarifications[0] ?? "Review the captured answers before completing the interview.";

  return res.json({
    question,
    inconsistencies,
    status:
      clarifications.length > 0 ? "needs_clarification" : "ready_to_complete",
  });
}));

app.post("/api/interviews/:id/finalize", asyncRoute(async (req, res) => {
  const parsed = z.array(transcriptTurnSchema).safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ error: "Transcript payload invalid" });
  }

  const turns = parsed.data;
  if (!turnsMatchInterview(String(String(req.params.id)), turns)) {
    return res.status(400).json({ error: "Transcript turns do not match this interview" });
  }
  const { interview, application } = await getInterviewContext(String(String(req.params.id)));

  if (!application || !interview) {
    return res.status(404).json({ error: "Application not found" });
  }
  if (interview.status === "completed") {
    return res.status(409).json({ error: "This interview is already complete" });
  }
  if (res.locals.borrowerAuthorized && !interview.consentReference) {
    return res.status(403).json({ error: "Borrower consent is required before completing the interview" });
  }
  // Preserve the conversation before calling an external model. Failure leaves
  // the interview open so completion can be retried without losing the answers.
  await persistInterview({ ...interview, transcriptTurns: turns });
  if (!supabase) updateDemoInterview(interview.id, { transcriptTurns: turns });
  const analysis = await generateInterviewAnalysis(application, turns);
  const finalReport = {
    applicant: application.applicantName,
    loanType: application.loanType,
    requestedAmount: application.requestedAmount,
    purpose: analysis.structuredSummary.loan.purpose,
    ...analysis,
  };
  const completedInterview = { ...interview,
    status: "completed",
    completedAt: new Date().toISOString(),
    transcriptTurns: turns,
    analysisJson: analysis,
  };

  await persistInterview({ ...completedInterview, status: "completed" });
  if (!supabase) updateDemoInterview(interview.id, { ...completedInterview, status: "completed" });

  if (res.locals.borrowerAuthorized) return res.json({ completed: true });
  return res.json(finalReport);
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof ExtractionError) {
    if (!res.headersSent) res.status(502).json({
      error: error.message,
      provider: "gemini",
      providerStatus: error.providerStatus,
      providerCode: error.providerCode,
    });
    return;
  }
  console.error("Unhandled API error", error);
  if (!res.headersSent) res.status(503).json({ error: "The interview could not be saved. Check the backend database schema and try again." });
});

app.listen(port, () => {
  console.log(`CreditTalk backend listening on http://localhost:${port}`);
});

