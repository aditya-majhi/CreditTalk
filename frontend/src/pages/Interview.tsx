import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../store";
import { VoiceAgent } from "../components/VoiceAgent";
import { Transcript } from "../components/Transcript";
import { InterviewAnalysisPanel } from "../components/InterviewAnalysis";
import { formatCurrency } from "../lib/audio";
import { api } from "../lib/api";
import { VoiceAgentClient } from "../lib/voiceAgent";
import type { TranscriptTurn } from "../types";

export function Interview({ borrowerToken }: { borrowerToken?: string }) {
  const navigate = useNavigate();
  const {
    selectedApplicationId,
    activeInterviewId,
    applications,
    transcript,
    analysis,
    setAnalysis,
    setTranscript,
    addTranscriptTurn,
    setActiveInterviewId,
    setSelectedApplicationId,
  } = useAppStore();
  const [borrowerName, setBorrowerName] = useState("");
  const [borrowerTurns, setBorrowerTurns] = useState<TranscriptTurn[]>([]);
  const [completed, setCompleted] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const connectionAttempt = useRef(0);
  const starting = useRef(false);
  const [voiceSession, setVoiceSession] = useState<{
    prompt: string;
    enabled: boolean;
    mode: string;
  } | null>(null);
  const [clarificationPrompt, setClarificationPrompt] = useState<string>("");
  const [consentGranted, setConsentGranted] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [partialTranscript, setPartialTranscript] = useState("");
  const [language, setLanguage] = useState("English");
  const voiceClient = useRef<VoiceAgentClient | null>(null);
  const microphoneStream = useRef<MediaStream | null>(null);
  const application =
    applications.find(item => item.id === selectedApplicationId) ??
    applications[0];

  useEffect(() => {
    if (borrowerToken) {
      void api.getBorrowerSession(borrowerToken).then(session => {
        setActiveInterviewId(session.id);
        setSelectedApplicationId(session.applicationId);
        setBorrowerName(session.applicantName);
        setBorrowerTurns(session.transcriptTurns ?? []);
        setCompleted(session.status === "completed");
      }).catch(() => setErrorMessage("This interview link is invalid or has expired."));
      return;
    }
    if (!selectedApplicationId) return;
    void api.getInterview(activeInterviewId ?? "demo").then(response => {
      const finished = response.status === "completed";
      setCompleted(finished);
      setTranscript(response.transcriptTurns);
    });
  }, [activeInterviewId, borrowerToken, selectedApplicationId]);

  const transcriptRows = useMemo(() =>
    (borrowerToken ? borrowerTurns : transcript).filter(turn => turn.interviewId === activeInterviewId),
    [activeInterviewId, borrowerToken, borrowerTurns, transcript]);

  useEffect(() => {
    return () => {
      connectionAttempt.current += 1;
      voiceClient.current?.stop();
      microphoneStream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  const startRealtimeTranscript = async () => {
    if (starting.current || isRunning) return;
    if (completed) {
      setErrorMessage("This interview is finished and cannot be started again.");
      return;
    }
    setErrorMessage("");
    starting.current = true;
    setIsConnecting(true);
    const attempt = ++connectionAttempt.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (attempt !== connectionAttempt.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      microphoneStream.current = stream;
        const voiceSessionResponse = await api.getVoiceSession(
          selectedApplicationId ?? "app-raj-sharma",
          borrowerToken,
          language
        );
        if (attempt !== connectionAttempt.current) return;
        if (!voiceSessionResponse.enabled || !voiceSessionResponse.token) {
          throw new Error("The voice interview service is unavailable. Please try again later.");
        }
        if (voiceSessionResponse.enabled && voiceSessionResponse.token) {
          const voice = new VoiceAgentClient({
            onBorrowerPartial: setPartialTranscript,
            onBorrowerTranscript: text => {
              const turn: TranscriptTurn = {
                id: crypto.randomUUID(), interviewId: activeInterviewId ?? "demo",
                speaker: "borrower", text, timestamp: Date.now(),
              };
              if (borrowerToken) setBorrowerTurns(current => [...current, turn]);
              else addTranscriptTurn(turn);
            },
            onPrompt: prompt => {
              const agentTurn: TranscriptTurn = {
                id: crypto.randomUUID(), interviewId: activeInterviewId ?? "demo",
                speaker: "agent", text: prompt, timestamp: Date.now(),
              };
              if (borrowerToken) setBorrowerTurns(current => [...current, agentTurn]);
              else addTranscriptTurn(agentTurn);
              setVoiceSession(current => ({
                prompt,
                enabled: current?.enabled ?? true,
                mode: "live",
              }));
            },
            onError: message => {
              stopRealtimeTranscript();
              setErrorMessage(message);
            },
            onEnded: () => {
              stopRealtimeTranscript();
              setErrorMessage("The voice interview session has ended. Review the transcript and complete the interview.");
            },
          });
          if (!voiceSessionResponse.agentId) {
            throw new Error("Voice Agent is not configured with an agent ID.");
          }
          voiceClient.current = voice;
          await voice.start(voiceSessionResponse, microphoneStream.current);
        }
      if (attempt !== connectionAttempt.current) return;
      setIsRunning(true);
    } catch (error) {
      if (attempt !== connectionAttempt.current) return;
      stopRealtimeTranscript();
      setErrorMessage(
        error instanceof Error ? error.message : "The interview could not connect. Check microphone permissions and try again."
      );
    } finally {
      starting.current = false;
      setIsConnecting(false);
    }
  };

  const stopRealtimeTranscript = () => {
    connectionAttempt.current += 1;
    voiceClient.current?.stop();
    voiceClient.current = null;
    microphoneStream.current?.getTracks().forEach(track => track.stop());
    microphoneStream.current = null;
    setPartialTranscript("");
    setIsRunning(false);
  };

  const runAnalysis = async () => {
    setIsBusy(true);
    setErrorMessage("");
    try {
      const interviewId = activeInterviewId ?? "demo";
      const response = await api.analyzeInterview(interviewId, transcriptRows, borrowerToken);
      setAnalysis(response.analysis);

      const voiceSessionResponse = await api.getVoiceSession(
        selectedApplicationId ?? "app-raj-sharma",
        borrowerToken
      );
      setVoiceSession({
        prompt: voiceSessionResponse.prompt,
        enabled: voiceSessionResponse.enabled,
        mode: voiceSessionResponse.mode,
      });

      const clarification = await api.askClarification(
        interviewId,
        transcriptRows,
        borrowerToken
      );
      setClarificationPrompt(clarification.question);
    } catch (error) {
      console.error(error);
      setErrorMessage(
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ?? "The interview analysis could not be completed. Try again."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const completeInterview = async () => {
    if (completed) {
      setErrorMessage("This interview is already finished.");
      return;
    }
    if (!consentGranted) {
      setErrorMessage(
        "Grant borrower consent before completing the interview."
      );
      return;
    }
    setIsBusy(true);
    setErrorMessage("");
    // Stop recording and speech playback before finalizing so the agent cannot
    // continue talking while the report is being saved.
    stopRealtimeTranscript();
    try {
      const report = await api.finalizeInterview(
        activeInterviewId ?? "demo",
        transcriptRows,
        borrowerToken
      );
      if (borrowerToken) {
        setBorrowerTurns(transcriptRows);
        setCompleted(true);
        stopRealtimeTranscript();
        return;
      }
      setTranscript(transcriptRows);
      setAnalysis({
        facts: report.facts,
        notes: report.notes,
        summary: report.summary,
        structuredSummary: report.structuredSummary,
        inconsistencies: [],
        clarifications: report.clarifications,
        creditBureauStatus: "not_connected",
      });
      navigate(`/report?interviewId=${encodeURIComponent(activeInterviewId ?? "demo")}`);
    } catch (error) {
      console.error(error);
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setCompleted(true);
        setIsRunning(false);
        setErrorMessage("This interview is already finished.");
      } else {
        const serverMessage = (error as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setErrorMessage(serverMessage ?? "The final report could not be created. Try again.");
      }
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
            Interview workspace / borrower conversation
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">
            {borrowerToken ? borrowerName || "Your interview" : application?.applicantName ?? "Borrower interview"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            {borrowerToken ? "Speak with your lender’s interview assistant." : "Capture the conversation, review lender notes, and resolve questions before finalizing the report."}
          </p>
        </div>
        <div className="inline-flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold uppercase tracking-wide text-emerald-800 md:self-auto">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          {isConnecting ? "Connecting..." : isRunning ? "Session active" : "Session paused"}
        </div>
      </div>

      {completed ? <div className="mx-auto max-w-2xl rounded-2xl border border-emerald-200 bg-white p-8 text-center shadow-xs"><h2 className="text-2xl font-semibold">Interview finished</h2><p className="mt-2 text-slate-600">This interview has already been completed and cannot be started again.</p></div> : <>

      {!borrowerToken && <div className="mb-6 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs md:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Application
          </p>
          <p className="mt-2 font-semibold text-slate-900">
            {application?.id ?? "Demo application"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Loan
          </p>
          <p className="mt-2 font-semibold capitalize text-slate-900">
            {application ? application.loanType : "Personal loan"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            Requested
          </p>
          <p className="mt-2 font-semibold text-slate-900">
            {application
              ? formatCurrency(application.requestedAmount)
              : "₹7,00,000"}
          </p>
        </div>
      </div>}

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <p className="text-sm font-semibold text-slate-900">Interview language</p>
              <p className="mt-1 text-xs text-slate-500">Choose before starting the microphone.</p>
            </div>
            <select
              value={language}
              disabled={isRunning || isConnecting}
              onChange={event => setLanguage(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              aria-label="Interview language"
            >
              <option>English</option>
              <option>Spanish</option>
              <option>French</option>
              <option>German</option>
              <option>Italian</option>
              <option>Portuguese</option>
              <option>Hindi</option>
            </select>
          </div>
          <VoiceAgent
            status={isRunning ? "listening" : "idle"}
            prompt={
              voiceSession?.prompt ?? "What are you hoping to use the loan for?"
            }
          />
          {!borrowerToken && clarificationPrompt && (
            <div className="rounded-xl border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-amber-700">
                Open clarification
              </p>
              {clarificationPrompt}
            </div>
          )}
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium">{borrowerToken ? "Recording and transcript consent" : "Borrower consent"}</span>
            <button
              onClick={async () => {
                try {
                  const response = await api.saveConsent({
                    granted: true,
                    reference: `consent-${Date.now()}`,
                    interviewId: activeInterviewId ?? "demo",
                  }, borrowerToken);
                  setConsentGranted(response.granted);
                } catch (error) {
                  console.error(error);
                  setErrorMessage("Consent could not be saved. Try again.");
                }
              }}
              className={
                consentGranted
                  ? "cursor-pointer font-semibold text-emerald-700"
                  : "cursor-pointer font-semibold text-amber-700 underline"
              }
            >
              {consentGranted ? "Granted" : "I consent"}
            </button>
            </div>
            {borrowerToken && <p className="mt-2 text-slate-500">Your microphone audio will be transcribed and shared with your lender as part of this interview.</p>}
          </div>
          {errorMessage && (
            <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              disabled={isBusy || isConnecting || Boolean(borrowerToken && !consentGranted)}
              onClick={() => {
                if (isRunning) {
                  stopRealtimeTranscript();
                } else {
                  void startRealtimeTranscript().catch(error => {
                    console.error(error);
                    setErrorMessage("The microphone session could not be started. Try again.");
                  });
                }
              }}
              className="cursor-pointer rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 disabled:cursor-wait disabled:opacity-60"
            >
              {isConnecting ? "Connecting..." : isRunning ? "Stop microphone" : "Start microphone"}
            </button>
            {!borrowerToken && <button
              disabled={isBusy || isConnecting}
              onClick={() => {
                void runAnalysis();
              }}
              className="cursor-pointer rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isBusy
                ? "Processing..."
                : "Run analysis"}
            </button>}
            <button
              disabled={isBusy || isConnecting}
              onClick={() => {
                void completeInterview();
              }}
              className="cursor-pointer rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:opacity-60"
            >
              {isBusy ? "Processing interview..." : "Complete interview"}
            </button>
          </div>
          <Transcript turns={transcriptRows} partialBorrowerText={partialTranscript} />
        </div>

        <div className="space-y-6">
          {!borrowerToken && <InterviewAnalysisPanel analysis={analysis} />}
        </div>
      </div>
      </>}
    </div>
  );
}

