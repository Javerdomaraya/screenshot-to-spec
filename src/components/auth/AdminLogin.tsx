import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SCHOOL_ADDRESS, schoolDisplayName, schoolLogoSrc } from "@/lib/schoolBrand";

type Props = {
  firstRun: boolean;
  onAuthenticate: (password: string) => Promise<void>;
};

/** No credentials are kept in browser storage or embedded in the renderer. */
export function AdminLogin({ firstRun, onAuthenticate }: Props) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (firstRun && (password.length < 12 || password.length > 256)) {
      setError("Use a password between 12 and 256 characters.");
      return;
    }
    if (firstRun && password !== confirmation) {
      setError("Passwords do not match. Please try again.");
      return;
    }
    if (!password) {
      setError("Enter your administrator password.");
      return;
    }
    setBusy(true);
    try {
      await onAuthenticate(password);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-login-shell">
      <section className="admin-login-brand" aria-label="E-CLASS school identity">
        <div className="admin-login-brand-top">
          <div className="admin-login-brand-symbol"><img src={schoolLogoSrc()} alt="School logo" /></div>
          <div className="admin-login-brand-title">
            <span>THE SCHOOL WORKSPACE</span>
            <strong>E-CLASS</strong>
          </div>
        </div>
        <div className="admin-login-brand-body">
          <div className="admin-login-label"><span /> TEACHER'S DIGITAL TOOLBOX PH</div>
          <h1>School scheduling, all in one secure workspace.</h1>
          <p>Plan classes, coordinate teachers, and prepare class programs with confidence.</p>
        </div>
        <div className="admin-login-brand-bottom">
          <div className="admin-login-school">
            <span>OFFICIAL SCHOOL WORKSPACE</span>
            <strong>{schoolDisplayName()}</strong>
            <span>{SCHOOL_ADDRESS}</span>
          </div>
          <div className="admin-login-brand-footer"><ShieldCheck aria-hidden="true" /> Local school data stays on this device.</div>
        </div>
      </section>
      <section className="admin-login-form-side">
        <div className="admin-login-form-wrap">
          <div className="admin-login-lock-icon"><LockKeyhole aria-hidden="true" /></div>
          <div className="admin-login-form-intro">
            <span className="admin-login-overline">{firstRun ? "FIRST-TIME SETUP" : "WELCOME BACK"}</span>
            <h2>{firstRun ? "Create administrator password" : "Administrator sign in"}</h2>
            <p>{firstRun
              ? "Protect school records by setting a private password for the local administrator account."
              : "Enter your administrator password to open the E-CLASS Dashboard."}</p>
          </div>
          <form className="admin-login-form" onSubmit={(event) => { void submit(event); }} noValidate>
            <label className="admin-login-field">
              <span>Username</span>
              <span className="admin-login-username">
                <UserRound aria-hidden="true" />
                <Input value="admin" aria-label="Username" readOnly autoComplete="username" />
              </span>
            </label>
            <label className="admin-login-field">
              <span>Password</span>
              <span className="admin-login-password">
                <Input
                  autoFocus
                  aria-label="Password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={firstRun ? "new-password" : "current-password"}
                  minLength={firstRun ? 12 : undefined}
                  maxLength={256}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); setError(""); }}
                  placeholder={firstRun ? "Create a strong password" : "Enter your password"}
                  disabled={busy}
                />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"}
                  onClick={() => setShowPassword((previous) => !previous)}>
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </span>
            </label>
            {firstRun && (
              <label className="admin-login-field">
                <span>Confirm password</span>
                <Input type={showPassword ? "text" : "password"} aria-label="Confirm password"
                  autoComplete="new-password" maxLength={256} value={confirmation}
                  onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
                  placeholder="Re-enter your new password" disabled={busy} />
                <small>Use at least 12 characters. Store this password securely.</small>
              </label>
            )}
            {error && <p className="admin-login-error" role="alert">{error}</p>}
            <Button type="submit" disabled={busy} className="admin-login-submit">
              {busy ? "Please wait…" : firstRun ? "Create administrator account" : "Sign in to E-CLASS"}
              {!busy && <ArrowRight aria-hidden="true" />}
            </Button>
          </form>
          <div className="admin-login-security-note">
            <Check aria-hidden="true" />
            <span>{firstRun
              ? "No default password is provided. Keep your credentials in a safe place."
              : "Offline administrator access · Protected local school records"}</span>
          </div>
        </div>
        <p className="admin-login-copyright">E-CLASS · Academic planning for Philippine schools</p>
      </section>
    </main>
  );
}
