# CreditTalk

CreditTalk is a voice-first loan interview assistant designed for lender-side borrower conversations. It is intentionally focused on a natural, conversational interview flow, not on automated lending decisions.

## Why this architecture

- Voice Agent API handles the live conversational interview, turn-taking, interruptions, and spoken responses.
- Universal-3.5 Pro Realtime handles independent transcript capture and audit-grade analysis.
- The two AssemblyAI integrations remain separate by design so that conversation logic and transcript/analysis logic do not overlap.

## Final folder structure

```text
credittalk/
|-- frontend/
|   |-- src/
|   |-- index.html
|   |-- package.json
|   |-- package-lock.json
|   |-- tsconfig.json
|   |-- tsconfig.node.json
|   `-- vite.config.mts
|-- backend/
|   |-- src/
|   |-- schema.sql
|   |-- package.json
|   |-- package-lock.json
|   `-- tsconfig.json
|-- .gitignore
`-- README.md
```
## Dependencies

### Frontend

```json
{
  "react": "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^6.28.0",
  "zustand": "^5.0.1",
  "lucide-react": "^0.468.0",
  "tailwindcss": "^4.1.0",
  "@tailwindcss/vite": "^4.1.0",
  "@vitejs/plugin-react": "^4.3.3",
  "vite": "^5.4.10",
  "typescript": "^5.6.3"
}
```

### Backend

```json
{
  "express": "^4.21.1",
  "ws": "^8.17.0",
  "zod": "^3.23.8",
  "@supabase/supabase-js": "^2.47.10",
  "dotenv": "^16.4.5",
  "cors": "^2.8.5"
}
```

## Database SQL / schema

See [backend/schema.sql](backend/schema.sql) for the full SQL. The minimal schema is:

```sql
create table if not exists applications (
  id uuid primary key default gen_random_uuid(),
  applicant_name text not null,
  loan_type text not null,
  requested_amount bigint not null,
  loan_purpose text,
  created_at timestamptz not null default now()
);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  status text not null default 'pending',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  analysis_json jsonb,
  credit_bureau_status text not null default 'not_connected',
  consent_reference text,
  created_at timestamptz not null default now()
);

create table if not exists transcript_turns (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references interviews(id) on delete cascade,
  speaker text not null check (speaker in ('borrower', 'agent')),
  text text not null,
  timestamp_ms bigint not null,
  created_at timestamptz not null default now()
);
```

## Main TypeScript interfaces

```ts
export type LoanType =
  | "personal"
  | "home"
  | "education"
  | "vehicle"
  | "business"
  | "other";

export interface TranscriptTurn {
  id: string;
  interviewId: string;
  speaker: "borrower" | "agent";
  text: string;
  timestamp: number;
}

export interface BorrowerFact {
  key: string;
  value: unknown;
  category: string;
  sourceTurnId: string;
}

export interface InterviewAnalysis {
  facts: BorrowerFact[];
  notes: string[];
  inconsistencies: Array<{
    title: string;
    earlier: string;
    later: string;
    status: "needs_clarification";
  }>;
  summary: string;
  clarifications: string[];
}

export interface Application {
  id: string;
  applicantName: string;
  loanType: LoanType;
  requestedAmount: number;
  loanPurpose?: string;
  createdAt: string;
}
```

## Component structure

- Dashboard page: list of borrower applications, create flow, start interview, view report.
- Interview page: voice panel + borrower facts + live transcript + live notes.
- Report page: final summary, transcript, notes, facts, consent and bureau status.
- VoiceAgent component: natural speech UI state and live status indicator.
- Transcript component: finalized transcript list and partial transcript handling.
- InterviewAnalysis component: notes, facts, inconsistencies.

## How the AssemblyAI integrations run together

```text
Borrower voice
  -> React frontend microphone
  -> AssemblyAI Voice Agent API (conversation, Q&A, TTS, interruption handling)
  -> Natural spoken follow-up questions

Borrower voice also captured in parallel by the frontend
  -> AssemblyAI Realtime STT (universal-3-5-pro)
  -> Live transcript displayed in UI
  -> Finalized transcript turns sent to backend analysis
  -> Facts, notes, inconsistencies, and summary generated from finalized data only
```

The core rule is: conversation happens in the Voice Agent API; transcript and analysis happen in the Universal-3.5 Pro Realtime pipeline.

## Exact local run commands

Open two terminals from the repository root and run each app independently:

```bash
cd frontend
npm ci
npm run dev
```

```bash
cd backend
npm ci
npm run dev
```

For production, set the Vercel project root to `frontend` with build command `npm run build`. Configure `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in Vercel. Set the Render service root to `backend`, build command `npm ci && npm run build`, and start command `npm start`. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on Render; never put the service role key in Vercel or another browser-facing environment.

The frontend includes `vercel.json` with a rewrite to `/index.html` for React Router routes. Deploy this file with Vercel Root Directory set to `frontend` and Output Directory `dist`. It enables direct links and refreshes on `/borrow`, `/interview`, `/report`, and `/create-account`. API requests still use the separate Render URL configured in `VITE_API_BASE_URL`. Redeploy the frontend after adding or changing this configuration.

Then open:

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Implementation status

The MVP includes application-linked interview creation, demo-mode fallback, Supabase repository boundaries, consent tracking, transcript analysis, final reporting, request limits, and browser microphone clients for the AssemblyAI Voice Agent and Universal-3.5 Pro Realtime STT WebSockets.

Without provider credentials, the application uses demo behavior. For local development, put `ASSEMBLYAI_API_KEY`, `FRONTEND_URL`, and the required Supabase settings in `backend/.env`. For durable application, interview, and transcript storage, provide `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, then apply [backend/schema.sql](backend/schema.sql). The frontend uses Supabase Auth with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for lender email/password sign-in.

The credit bureau adapter is consent-gated and remains disconnected until all `CREDIT_BUREAU_*` values are configured. CreditTalk presents bureau information for lender review and does not make automated lending decisions.

## Borrower links and lender access

The lender dashboard creates a random, private borrower interview link. The link grants access only to that interview; it does not grant access to applications or lender reports. The borrower link becomes read-only after the interview is completed. The backend stores only a SHA-256 hash of the link token. Apply the updated `backend/schema.sql` to an existing Supabase database before creating links.

Lender access uses Supabase Auth email/password; there is no shared lender access key. The sign-in screen includes account creation. Enable email/password sign-ups in Supabase Auth settings. Every confirmed account is automatically added to `public.lender_users` the first time it signs in, so it can use the lender dashboard immediately. To revoke access, set `is_active` to `false` for that user; the inactive status remains enforced. Apply `backend/schema.sql` first so the table exists. Local development without Supabase configuration intentionally uses demo access.

Set `VITE_API_BASE_URL` in the frontend build environment if the backend is not at `http://localhost:3000/api`. Set `FRONTEND_URL` in the backend environment to the public frontend origin so generated borrower links point to the deployed site.

Live WebSocket behavior still requires an end-to-end verification against the configured AssemblyAI account because provider permissions, account features, and protocol availability are external runtime dependencies.





### Interview languages

The interview screen now lets the borrower choose English, Spanish, French, German, Italian, Portuguese, or Hindi before starting. The selected language is sent to the AssemblyAI Voice Agent prompt. Hindi uses AssemblyAI Whisper Streaming for the independent transcript because the Voice Agent input language set is limited; the Voice Agent may still need a supported input language for live conversation.


### Conversation-based reports

Reports are rebuilt from saved transcript turns when opened, including existing completed interviews. Application loan type and requested amount are explicitly labelled as application context. Financial cards use only unambiguous borrower amounts; missing and conflicting values stay unset. Annual figures are normalized only when the period is explicit. Relevant discussion statements remain available as highlights. The report does not display the raw transcript or a credit bureau section, and its summary makes no bureau claims.

Report extraction now uses Gemini structured JSON output. The earlier rule-based extractor remains in the repository for reference but is no longer called by report endpoints. Gemini receives the saved conversation and application context; interview financial fields must come from borrower answers. Numeric and text fields include source quotes that the backend checks against borrower turns. Schema and quote checks do not guarantee semantic accuracy, so lenders should review reports.

### Gemini setup

Add `GEMINI_API_KEY` to the backend `.env` locally and to Render environment variables in production. `GEMINI_MODEL` defaults to `gemini-3.8-flash` and can be set to another Gemini model supporting structured JSON output. Keep the key out of Vercel frontend variables. Restart/redeploy the backend after configuration. The integration uses Google's REST API and requires no new npm packages or database migration.

- Interview analysis/completion sends the transcript and application context to Gemini. The response is validated and mapped to the existing report JSON, then saved in `analysis_json`.
- Report reads use the stored JSON without invoking AI. Use **Regenerate with AI** on an existing report to update it from its saved transcript.
- Application creation offers **Fill with AI**: paste notes, extract a draft, review/edit the fields, then save. Missing fields are left empty (loan type displays Other for review); extraction itself does not create an application.
- Provider failures, missing configuration, timeouts and invalid responses produce explicit errors. There is no silent rule-based fallback. The transcript is saved before report generation; a failed completion leaves the interview open for retry. Existing report regeneration failures preserve the previous report.
- Gemini is instructed to understand multilingual answers, normalize spoken amounts and use question context. Unknown or conflicting details remain null. Missing historical transcript data cannot be reconstructed. Calls send personal application/conversation data to Google and may incur provider charges.

Reference: [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).
