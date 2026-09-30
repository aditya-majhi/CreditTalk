import { useEffect, useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { Interview } from "./pages/Interview";
import { Report } from "./pages/Report";
import { api } from "./lib/api";
import { supabase } from "./lib/supabase";
import { useAppStore } from "./store";

function clearLenderData() {
  useAppStore.setState({
    applications: [],
    selectedApplicationId: null,
    activeInterviewId: null,
    transcript: [],
    analysis: null,
  });
}

function LenderLogin({
  onLogin,
  createAccount,
  onChangeMode,
}: {
  onLogin: () => void;
  createAccount: boolean;
  onChangeMode: (create: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const changeMode = (create: boolean) => {
    setError("");
    setNotice("");
    setPassword("");
    setConfirmPassword("");
    onChangeMode(create);
  };

  return (
    <main className="mx-auto mt-20 max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xs">
      <h1 className="text-2xl font-semibold">
        {createAccount ? "Create lender account" : "Lender sign in"}
      </h1>
      <p className="mt-2 text-sm text-slate-600">
        {createAccount
          ? "Create an account with your email and password."
          : "Sign in with your lender account."}
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setError("");
          setNotice("");
          try {
            if (!supabase) throw new Error("Supabase Auth is not configured.");
            if (createAccount) {
              if (password !== confirmPassword)
                throw new Error("Passwords do not match.");
              const { data, error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                  // Supabase appends the confirmation tokens to this URL. Keep it on
                  // the browser app so its client can consume the session hash.
                  emailRedirectTo: `${window.location.origin}/`,
                },
              });
              if (signUpError) throw signUpError;
              if (!data.user || data.user.identities?.length === 0) {
                throw new Error(
                  "Could not create the account. The email may already be registered."
                );
              }
              if (data.session) await supabase.auth.signOut({ scope: "local" });
              setPassword("");
              setConfirmPassword("");
              setNotice(
                "Account created. Check your email to confirm it if requested. A lender administrator must authorize your account before you can access the dashboard."
              );
            } else {
              const { error: signInError } =
                await supabase.auth.signInWithPassword({ email, password });
              if (signInError) throw signInError;
              await api.authMe();
              onLogin();
            }
          } catch (cause) {
            if (!createAccount && supabase)
              await supabase.auth
                .signOut({ scope: "local" })
                .catch(() => undefined);
            setError(
              cause instanceof Error
                ? cause.message
                : "Sign in failed. Check your details and lender authorization."
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {supabase ? (
          <>
            <input
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              aria-label="Email"
              placeholder="Email"
            />
            <input
              autoComplete={createAccount ? "new-password" : "current-password"}
              type="password"
              minLength={6}
              required
              value={password}
              onChange={event => setPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2"
              aria-label="Password"
              placeholder="Password"
            />
            {createAccount && (
              <input
                autoComplete="new-password"
                type="password"
                minLength={6}
                required
                value={confirmPassword}
                onChange={event => setConfirmPassword(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                aria-label="Confirm password"
                placeholder="Confirm password"
              />
            )}
          </>
        ) : (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Supabase Auth is not configured. Local demo access is enabled.
          </p>
        )}
        {createAccount && supabase && (
          <p className="text-xs leading-5 text-slate-500">
            New accounts need lender administrator approval before they can view
            applications or reports.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {notice}
          </p>
        )}
        <button
          disabled={busy || !supabase}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white cursor-pointer"
        >
          {busy ? "Please wait" : createAccount ? "Create account" : "Sign in"}
        </button>
      </form>
      {supabase && (
        <p className="mt-5 text-center text-sm text-slate-600">
          {createAccount ? "Already have an account? " : "Need an account? "}
          <button
            className="font-medium text-slate-900 underline cursor-pointer"
            onClick={() => changeMode(!createAccount)}
          >
            {createAccount ? "Sign in" : "Create account"}
          </button>
        </p>
      )}
    </main>
  );
}

function BorrowerRoute() {
  const { hash } = useLocation();
  const token = hash.startsWith("#") ? hash.slice(1) : "";
  return <Interview borrowerToken={token} />;
}

function RoutedApp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [lenderAuthenticated, setLenderAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const isBorrower = location.pathname === "/borrow";

  useEffect(() => {
    if (isBorrower) {
      setCheckingSession(false);
      return;
    }
    setCheckingSession(true);
    void api
      .authMe()
      .then(() => setLenderAuthenticated(true))
      .catch(() => {
        setLenderAuthenticated(false);
      })
      .finally(() => setCheckingSession(false));
  }, [isBorrower]);

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    clearLenderData();
    setLenderAuthenticated(false);
  };

  if (!isBorrower && checkingSession)
    return (
      <main className="mx-auto mt-20 max-w-md text-center text-slate-600">
        Loading
      </main>
    );
  if (!isBorrower && !lenderAuthenticated)
    return (
      <LenderLogin
        createAccount={location.pathname === "/create-account"}
        onChangeMode={create => navigate(create ? "/create-account" : "/")}
        onLogin={() => {
          clearLenderData();
          setLenderAuthenticated(true);
        }}
      />
    );
  return (
    <>
      {!isBorrower && (
        <nav className="border-b border-slate-200 bg-white/80 backdrop-blur-xs">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <div className="text-xl font-bold text-slate-900">CreditTalk</div>
            <NavLink to="/" className="text-sm font-medium text-slate-600">
              Dashboard
            </NavLink>
            <button
              className="ml-auto text-sm text-slate-500 cursor-pointer"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </nav>
      )}
      <Routes>
        <Route
          path="/"
          element={!isBorrower ? <Dashboard /> : <Navigate to="/" replace />}
        />
        <Route
          path="/interview"
          element={!isBorrower ? <Interview /> : <Navigate to="/" replace />}
        />
        <Route
          path="/report"
          element={!isBorrower ? <Report /> : <Navigate to="/" replace />}
        />
        <Route path="/borrow" element={<BorrowerRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-100 text-slate-900">
        <RoutedApp />
      </div>
    </BrowserRouter>
  );
}
