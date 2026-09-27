import type { InterviewAnalysis } from "../types";

interface InterviewAnalysisProps {
  analysis: InterviewAnalysis | null;
}

export function InterviewAnalysisPanel({ analysis }: InterviewAnalysisProps) {
  if (!analysis) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="mb-3 text-lg font-semibold text-slate-800">
          Live notes
        </h3>
        <p className="text-sm text-slate-500">
          Interview notes will appear as the conversation progresses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div>
        <h3 className="text-lg font-semibold text-slate-800">Borrower facts</h3>
        <ul className="mt-3 space-y-2 text-sm text-slate-700">
          {analysis.facts.map((fact, index) => (
            <li
              key={`${fact.key}-${index}`}
              className="rounded-lg bg-slate-50 p-2"
            >
              <span className="font-medium">{fact.key}:</span>{" "}
              {String(fact.value)}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-slate-800">Notes</h3>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          {analysis.notes.map((note, index) => (
            <li key={`${note}-${index}`}>{note}</li>
          ))}
        </ul>
      </div>

      {analysis.inconsistencies.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-800">
            Clarifications
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            {analysis.inconsistencies.map((item, index) => (
              <li
                key={`${item.title}-${index}`}
                className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900"
              >
                <span className="font-medium">{item.title}</span>
                <div>Earlier: {item.earlier}</div>
                <div>Later: {item.later}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
