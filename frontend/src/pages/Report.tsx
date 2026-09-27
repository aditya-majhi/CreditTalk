import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, FileText, Loader2, Printer } from "lucide-react";
import { useAppStore } from "../store";
import { api } from "../lib/api";
import { formatCurrency } from "../lib/audio";
import type { InterviewAnalysis } from "../types";

const amount = (value: number | null | undefined) => value == null ? "Not established" : formatCurrency(value);

export function Report() {
  const activeInterviewId = useAppStore(state => state.activeInterviewId);
  const [params] = useSearchParams();
  const interviewId = params.get("interviewId") ?? activeInterviewId;
  const [report, setReport] = useState<InterviewAnalysis | null>(null);
  const [completedAt, setCompletedAt] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");

  const regenerate = async () => {
    if (!interviewId || generating) return;
    setGenerating(true);
    setGenerationError("");
    try { setReport(await api.regenerateReport(interviewId)); }
    catch (error) { setGenerationError((error as { response?: { data?: { error?: string } } }).response?.data?.error ?? "Report generation failed. Please retry."); }
    finally { setGenerating(false); }
  };

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    setError("");
    if (!interviewId) { setIsLoading(false); return; }
    setIsLoading(true);
    void api.getInterview(interviewId).then(interview => {
      if (cancelled) return;
      setCompletedAt(interview.completedAt);
      setReport(interview.status === "completed" ? interview.analysisJson ?? null : null);
    }).catch(() => {
      if (!cancelled) setError("We couldn't load this report. Please try again.");
    }).finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [interviewId, attempt]);

  const back = <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950 print:hidden"><ArrowLeft size={16} /> Back to applications</Link>;
  if (isLoading || error || !report) return <main className="mx-auto max-w-3xl px-6 py-12">
    {back}
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-12 text-center shadow-xs">
      {isLoading ? <div role="status" className="flex items-center justify-center gap-3 text-slate-600"><Loader2 className="animate-spin" size={20} /> Preparing your interview report...</div> : <>
        <FileText className="mx-auto mb-4 text-slate-400" size={32} />
        <h1 className="text-xl font-semibold">{error ? "Report unavailable" : "No completed report yet"}</h1>
        <p className="mt-3 text-sm text-slate-600">{error || "Open a completed interview using View Report on the applications dashboard."}</p>
        {error && <button onClick={() => setAttempt(value => value + 1)} className="mt-5 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">Try again</button>}
      </>}
    </div>
  </main>;

  const summary = report.structuredSummary;
  const financials = summary.conversationFinancials;
  const metrics = [
    ["Monthly income", summary.income.monthly],
    ["Monthly loan payments", summary.declaredObligations.monthlyEmi],
    ["Monthly expenses", financials?.monthlyExpenses],
    ["Savings", financials?.savings],
  ] as const;
  const missing = metrics.filter(([, value]) => value == null).map(([label]) => label);
  return <main className="mx-auto max-w-6xl px-6 py-8 print:max-w-none print:p-0">
    <div className="mb-4 flex items-center justify-end gap-3 print:hidden">
      {generationError && <p role="alert" className="text-sm text-red-700">{generationError}</p>}
      <button disabled={generating} onClick={() => void regenerate()} className="cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50">{generating ? "Generating report..." : "Regenerate with AI"}</button>
    </div>
    <div className="flex items-center justify-between">{back}<button onClick={() => window.print()} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 print:hidden"><Printer size={16} /> Print report</button></div>
    <header className="mt-7 rounded-2xl bg-slate-950 px-7 py-8 text-white print:bg-white print:text-slate-950">
      <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300 print:text-emerald-800">Interview report</p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">{summary.applicant}</h1><p className="mt-2 text-sm text-slate-300 print:text-slate-600">Prepared from the saved interview conversation.</p></div>
        <span className="rounded-full border border-white/20 px-3 py-1.5 text-xs">{report.clarifications.length ? "Clarification needed" : "For lender review"}</span>
      </div>
      {completedAt && <p className="mt-5 text-xs text-slate-400">Completed {new Date(completedAt).toLocaleString()}</p>}
    </header>
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
      <div className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold">Conversation summary</h2>
          <p className="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{report.summary}</p>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold">Financial details discussed</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Borrower-reported amounts in INR. Explicit annual amounts are shown as monthly equivalents. Unclear or conflicting figures are left unset.</p>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2">{metrics.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><dt className="text-xs font-medium text-slate-500">{label}</dt><dd className={`mt-2 text-lg font-semibold ${value == null ? "text-slate-400" : "text-slate-950"}`}>{amount(value)}</dd></div>)}</dl>
          <dl className="mt-5 space-y-4 border-t border-slate-100 pt-5">
            <div><dt className="text-xs font-medium text-slate-500">Employment discussed</dt><dd className="mt-1 text-sm leading-6 text-slate-700">{summary.income.employment ?? "Not established in the interview"}</dd></div>
            <div><dt className="text-xs font-medium text-slate-500">Loan amount discussed</dt><dd className="mt-1 text-sm text-slate-700">{amount(financials?.requestedAmount)}</dd></div>
          </dl>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-lg font-semibold">Discussion highlights</h2>
          <p className="mt-1 text-xs text-slate-500">Relevant details in the borrower's own words.</p>
          {report.notes.length ? <ul className="mt-4 space-y-3">{report.notes.map((note, index) => <li key={index} className="border-l-2 border-emerald-500 pl-4 text-sm leading-6 text-slate-700">{note}</li>)}</ul> : <p className="mt-4 text-sm text-slate-500">No additional details could be established from the saved conversation.</p>}
        </section>
      </div>
      <aside className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <h2 className="text-sm font-semibold">Application context</h2>
          <p className="mt-2 text-xs leading-5 text-slate-500">Entered when the application was created.</p>
          <dl className="mt-4 space-y-4 text-sm"><div><dt className="text-slate-500">Loan type</dt><dd className="mt-1 capitalize">{summary.loan.type}</dd></div><div><dt className="text-slate-500">Requested amount</dt><dd className="mt-1 font-semibold">{formatCurrency(summary.loan.requestedAmount)}</dd></div></dl>
        </section>
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold text-amber-950">Follow-up points</h2>
          {report.clarifications.length > 0 && <ul className="mt-3 space-y-3 text-sm leading-6 text-amber-900">{report.clarifications.map((text, index) => <li key={index}>{text}</li>)}</ul>}
          {missing.length > 0 && <p className="mt-3 text-sm leading-6 text-amber-900">Not established: {missing.join(", ").toLowerCase()}.</p>}
          {!missing.length && !report.clarifications.length && <p className="mt-3 text-sm text-amber-900">No conflicting financial amounts were detected in the captured figures.</p>}
        </section>
        <p className="px-1 text-xs leading-5 text-slate-500">Interview details are borrower statements for lender review. An interview report does not approve or decline an application.</p>
      </aside>
    </div>
  </main>;
}
