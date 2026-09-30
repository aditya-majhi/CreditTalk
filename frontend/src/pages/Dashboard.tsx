import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BriefcaseBusiness,
  CirclePlus,
  FileText,
  PlayCircle,
  Loader2,
} from "lucide-react";
import { api } from "../lib/api";
import { formatCurrency, formatLoanType } from "../lib/audio";
import type { Application } from "../types";
import { useAppStore } from "../store";

export function Dashboard() {
  const navigate = useNavigate();
  const {
    applications,
    setApplications,
    setSelectedApplicationId,
    setActiveInterviewId,
    setAnalysis,
    setTranscript,
  } = useAppStore();
  const [showForm, setShowForm] = useState(false);
  const [applicationNotes, setApplicationNotes] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [borrowerLink, setBorrowerLink] = useState("");
  const [loadError, setLoadError] = useState("");
  const [generatingReports, setGeneratingReports] = useState<Set<string>>(
    new Set()
  );
  const reportRequests = useRef(new Set<string>());
  const mounted = useRef(false);
  const [reportErrors, setReportErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [form, setForm] = useState<{
    applicantName: string;
    loanType:
      | "personal"
      | "home"
      | "education"
      | "vehicle"
      | "business"
      | "other";
    requestedAmount: number;
    loanPurpose: string;
  }>({
    applicantName: "",
    loanType: "other",
    requestedAmount: 0,
    loanPurpose: "",
  });

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void api
      .getApplications()
      .then(loaded => {
        if (!cancelled) setApplications(loaded);
      })
      .catch(() => {
        if (!cancelled)
          setLoadError(
            "Applications could not be loaded. Please refresh to retry."
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, []);

  const handleCreate = async () => {
    setSaving(true);
    setFormMessage("");
    try {
      const payload = {
        applicantName: form.applicantName,
        loanType: form.loanType,
        requestedAmount: Number(form.requestedAmount),
        loanPurpose: form.loanPurpose,
      };

      const created = await api.createApplication(payload);
      if (!mounted.current) return;
      setApplications([...applications, created]);
      setSelectedApplicationId(created.id);
      setShowForm(false);
    } catch (error) {
      setFormMessage(
        (error as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Application could not be saved. Please retry."
      );
    } finally {
      setSaving(false);
    }
  };

  const handleExtract = async () => {
    setExtracting(true);
    setFormMessage("");
    try {
      const draft = await api.extractApplication(applicationNotes);
      setForm({
        applicantName: draft.applicantName ?? "",
        loanType: draft.loanType ?? "other",
        requestedAmount: draft.requestedAmount ?? 0,
        loanPurpose: draft.loanPurpose ?? "",
      });
      const missing = Object.entries(draft)
        .filter(([, value]) => value === null)
        .map(
          ([key]) =>
            ({
              applicantName: "applicant name",
              loanType: "loan type",
              requestedAmount: "requested amount",
              loanPurpose: "purpose",
            })[key]
        );
      setFormMessage(
        `Draft ready. Review all fields before saving.${missing.length ? ` Please supply: ${missing.join(", ")}.` : ""}`
      );
    } catch (error) {
      setFormMessage(
        (error as { response?: { data?: { error?: string } } }).response?.data
          ?.error ?? "Application extraction failed. Please retry."
      );
    } finally {
      setExtracting(false);
    }
  };

  const handleOpenInterview = async (application: Application) => {
    if (application.interviewStatus === "completed") return;
    setSelectedApplicationId(application.id);
    const interview = await api.createInterview(application.id);
    if (!mounted.current) return;
    setActiveInterviewId(interview.id);
    setBorrowerLink(interview.borrowerLink);
    setApplications(
      useAppStore.getState().applications.map(item =>
        item.id === application.id
          ? {
              ...item,
              interviewStatus: "in_progress",
              reportInterviewId: null,
            }
          : item
      )
    );
  };

  const handleViewReport = (application: Application) => {
    if (!application.reportInterviewId) return;
    setSelectedApplicationId(application.id);
    setActiveInterviewId(application.reportInterviewId);
    setAnalysis(null);
    setTranscript([]);
    navigate(
      `/report?interviewId=${encodeURIComponent(application.reportInterviewId)}`
    );
  };

  const handleGenerateReport = async (application: Application) => {
    const interviewId = application.completedInterviewId;
    if (!interviewId || reportRequests.current.has(application.id)) return;
    reportRequests.current.add(application.id);
    setGeneratingReports(new Set(reportRequests.current));
    setReportErrors(current => ({ ...current, [application.id]: "" }));
    try {
      await api.regenerateReport(interviewId);
      if (!mounted.current) return;
      setApplications(
        useAppStore
          .getState()
          .applications.map(item =>
            item.id === application.id
              ? { ...item, reportInterviewId: interviewId }
              : item
          )
      );
    } catch (error) {
      setReportErrors(current => ({
        ...current,
        [application.id]:
          (error as { response?: { data?: { error?: string } } }).response?.data
            ?.error ??
          "Report generation failed. Your interview is saved. Please retry.",
      }));
    } finally {
      reportRequests.current.delete(application.id);
      setGeneratingReports(new Set(reportRequests.current));
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      {loadError && (
        <p
          role="alert"
          className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          {loadError}
        </p>
      )}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">
            Lender dashboard
          </p>
          <h1 className="mt-2 text-4xl font-bold text-slate-900">CreditTalk</h1>
        </div>
        <button
          onClick={() => setShowForm(prev => !prev)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 font-medium text-white shadow-xs cursor-pointer"
        >
          <CirclePlus className="h-4 w-4" />
          Create Application
        </button>
      </div>

      {showForm && (
        <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="mb-5 rounded-xl bg-slate-50 p-4">
            <label
              htmlFor="application-notes"
              className="text-sm font-semibold"
            >
              Draft from application notes
            </label>
            <p className="mt-1 text-xs text-slate-500">
              Paste the applicant details and loan request. Review the extracted
              fields before saving.
            </p>
            <textarea
              id="application-notes"
              value={applicationNotes}
              maxLength={15000}
              disabled={extracting || saving}
              onChange={event => setApplicationNotes(event.target.value)}
              rows={3}
              className="mt-3 w-full rounded-lg border border-slate-200 p-3 text-sm"
              placeholder="Applicant name, loan amount, type and purpose..."
            />
            <button
              type="button"
              disabled={
                extracting || saving || applicationNotes.trim().length < 10
              }
              onClick={() => void handleExtract()}
              className="mt-2 cursor-pointer rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {extracting ? "Extracting details..." : "Fill with AI"}
            </button>
          </div>
          {formMessage && (
            <p
              role="status"
              className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-slate-700"
            >
              {formMessage}
            </p>
          )}
          <fieldset disabled={extracting || saving}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Applicant name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.applicantName}
                  onChange={e =>
                    setForm({ ...form, applicantName: e.target.value })
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Loan type
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.loanType}
                  onChange={e =>
                    setForm({
                      ...form,
                      loanType: e.target.value as
                        | "personal"
                        | "home"
                        | "education"
                        | "vehicle"
                        | "business"
                        | "other",
                    })
                  }
                >
                  <option value="personal">Personal Loan</option>
                  <option value="home">Home / Mortgage Loan</option>
                  <option value="education">Education Loan</option>
                  <option value="vehicle">Vehicle Loan</option>
                  <option value="business">Business Loan</option>
                  <option value="other">Other Loan</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Requested amount
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  type="number"
                  value={form.requestedAmount}
                  onChange={e =>
                    setForm({
                      ...form,
                      requestedAmount: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-sm text-slate-700">
                Purpose
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  value={form.loanPurpose}
                  onChange={e =>
                    setForm({ ...form, loanPurpose: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="mr-3 rounded-xl border border-slate-300 px-4 py-2 font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={
                  saving ||
                  extracting ||
                  form.applicantName.trim().length < 2 ||
                  form.requestedAmount <= 0
                }
                className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 font-medium text-white"
              >
                {saving ? "Saving..." : "Save application"}
              </button>
            </div>
          </fieldset>
        </div>
      )}

      {borrowerLink && (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-semibold text-emerald-950">
            Borrower interview link
          </h2>
          <p className="mt-1 text-sm text-emerald-900">
            Share this private link with the borrower. It opens only their
            interview.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={borrowerLink}
              className="min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 py-2 text-sm"
              aria-label="Borrower interview link"
            />
            <button
              onClick={() => void navigator.clipboard.writeText(borrowerLink)}
              className="cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white"
            >
              Copy link
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-2xl font-semibold text-slate-900">
            Loan Applications
          </h2>
        </div>

        <div className="divide-y divide-slate-200" aria-busy={isLoading}>
          {isLoading ? (
            <div
              role="status"
              className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-sm text-slate-600"
            >
              <Loader2
                aria-hidden="true"
                className="h-7 w-7 animate-spin text-emerald-600 motion-reduce:animate-none"
              />
              <span>Loading applications...</span>
            </div>
          ) : loadError ? (
            <p className="p-6 text-sm text-slate-500">
              Unable to display applications. Please refresh to retry.
            </p>
          ) : applications.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">
              No applications yet.
            </div>
          ) : (
            applications.map(application => (
              <div
                key={application.id}
                className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-slate-100 p-2 text-slate-700">
                    <BriefcaseBusiness className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold text-slate-900">
                      {application.applicantName}
                    </h3>
                    <p className="mt-1 text-sm text-slate-600">
                      {formatLoanType(application.loanType)}{" "}
                    </p>
                    <p className="mt-1 text-lg font-medium text-slate-800">
                      {formatCurrency(application.requestedAmount)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={application.interviewStatus === "completed"}
                    onClick={() => void handleOpenInterview(application)}
                    className={`inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 ${application.interviewStatus === "completed" ? "cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    {application.interviewStatus === "completed" ? (
                      <FileText className="h-4 w-4" />
                    ) : (
                      <PlayCircle className="h-4 w-4" />
                    )}
                    {application.interviewStatus === "completed"
                      ? "Interview finished"
                      : "Create borrower link"}
                  </button>
                  {application.reportInterviewId ? (
                    <button
                      onClick={() => handleViewReport(application)}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FileText className="h-4 w-4" />
                      View Report
                    </button>
                  ) : application.completedInterviewId ? (
                    <button
                      disabled={generatingReports.has(application.id)}
                      onClick={() => void handleGenerateReport(application)}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
                    >
                      {generatingReports.has(application.id) && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}
                      {generatingReports.has(application.id)
                        ? "Generating report..."
                        : reportErrors[application.id]
                          ? "Retry Generate Report"
                          : "Generate Report"}
                    </button>
                  ) : null}
                </div>
                {reportErrors[application.id] && (
                  <p
                    role="alert"
                    className="max-w-md rounded-lg bg-red-50 p-3 text-sm text-red-700"
                  >
                    {reportErrors[application.id]}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
