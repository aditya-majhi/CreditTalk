import { Mic, Volume2 } from "lucide-react";

interface VoiceAgentProps {
  status?: "idle" | "listening" | "speaking";
  prompt?: string;
}

export function VoiceAgent({
  status = "idle",
  prompt = "What are you hoping to use the loan for?",
}: VoiceAgentProps) {
  const statusText = {
    idle: "Ready",
    listening: "Listening",
    speaking: "Speaking",
  }[status];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Volume2 className="h-5 w-5 text-emerald-600" />
          <span className="font-medium">CreditTalk</span>
        </div>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          {statusText}
        </span>
      </div>

      <div className="mb-4 flex items-center justify-center rounded-2xl bg-slate-100 p-6">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-full ${status === "listening" ? "bg-emerald-500" : "bg-slate-200"} transition-all`}
        >
          <Mic
            className={`h-9 w-9 ${status === "listening" ? "text-white" : "text-slate-500"}`}
          />
        </div>
      </div>

      <p className="text-sm text-slate-600">CreditTalk</p>
      <p className="mt-2 text-lg font-medium text-slate-800">{prompt}</p>
    </div>
  );
}
