import type { TranscriptTurn } from "../types";

interface TranscriptProps {
  turns: TranscriptTurn[];
  partialBorrowerText?: string;
}

export function Transcript({ turns, partialBorrowerText }: TranscriptProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <h3 className="mb-4 text-lg font-semibold text-slate-800">
        Live transcript
      </h3>
      <div className="space-y-4">
        {turns.length === 0 && !partialBorrowerText ? (
          <p className="text-sm text-slate-500">
            Waiting for conversation transcript...
          </p>
        ) : (
          turns.map(turn => (
            <div key={turn.id} className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {turn.speaker === "borrower" ? "Borrower" : "CreditTalk"}
              </div>
              <p className="text-sm leading-6 text-slate-700">{turn.text}</p>
            </div>
          ))
        )}
        {partialBorrowerText && (
          <div className="rounded-xl border border-dashed border-emerald-200 bg-emerald-50 p-3">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              Borrower · Speaking
            </div>
            <p className="text-sm leading-6 text-slate-700">{partialBorrowerText}</p>
          </div>
        )}
      </div>
    </div>
  );
}
