"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useToggleState } from "@/components/layout/hooks";
import { COLORS, FONTS } from "@/components/layout/theme";
import { credentialsSchema } from "@/lib/validations/auth";

const ERROR_RED = "#e0483d";

// The email sign-in. With the Restaurant module on (`recovery`), an
// Administrator who has lost their PIN or password can sign in once with the
// recovery code from Settings › Staff instead (Part 6f Step 4) — it then
// lands on Settings › Staff to set things right.
export default function LoginForm({ recovery = false }: { recovery?: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const emailFocus = useToggleState();
  const passwordFocus = useToggleState();
  const buttonHover = useToggleState();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (mode === "recovery") {
      if (!email.trim() || code.replace(/[\s-]/g, "").length !== 20) {
        setError("Enter an Administrator's email and the 20-character recovery code.");
        return;
      }
      setSubmitting(true);
      const result = await signIn("recovery", { email: email.trim(), code, redirect: false }).catch(() => null);
      setSubmitting(false);
      if (!result || result.error) {
        setError("That email and recovery code don't match. A code works once; after 5 wrong tries, wait 15 minutes.");
        return;
      }
      router.push("/settings/restaurant/staff");
      router.refresh();
      return;
    }

    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your email and password.");
      return;
    }

    setSubmitting(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setSubmitting(false);

    if (!result || result.error) {
      setError("Invalid email or password.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26,
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          flex: "0 0 auto",
          borderRadius: 999,
          overflow: "hidden",
          boxShadow: "0 4px 12px -4px rgba(23,27,28,.2)",
          background: COLORS.teal,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontFamily: FONTS.display,
          fontWeight: 700,
          fontSize: 24,
        }}
      >
        R
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        style={{
          width: "100%",
          maxWidth: 544,
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 8px 28px -12px rgba(23,27,28,.16)",
          padding: "38px 40px 42px",
          display: "flex",
          flexDirection: "column",
          gap: 26,
        }}
      >
        <h1
          style={{
            margin: 0,
            textAlign: "center",
            fontFamily: FONTS.display,
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "-.015em",
          }}
        >
          {mode === "recovery" ? "Recovery sign-in" : "Sign In"}
        </h1>
        {mode === "recovery" && (
          <p style={{ margin: "-12px 0 0", textAlign: "center", fontSize: 14, color: COLORS.slateMid, lineHeight: 1.5 }}>
            For an Administrator who has lost their PIN or password: your email and the recovery code made on Settings › Staff. The code works once.
          </p>
        )}

        {error && (
          <div
            style={{
              background: "#fceceb",
              border: "1px solid #f3c7c2",
              color: ERROR_RED,
              borderRadius: 9,
              padding: "12px 15px",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <label style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
            Email :<span style={{ color: ERROR_RED }}>*</span>
          </label>
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="Enter Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onFocus={emailFocus.on}
            onBlur={emailFocus.off}
            style={{
              height: 50,
              border: `1px solid ${emailFocus.value ? COLORS.teal : COLORS.borderStrong}`,
              borderRadius: 9,
              padding: "0 15px",
              fontSize: 15,
              color: COLORS.ink,
              outline: "none",
              boxShadow: emailFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
              transition: "border-color .12s, box-shadow .12s",
            }}
          />
        </div>

        {mode === "recovery" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <label htmlFor="recovery-code" style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
              Recovery code:<span style={{ color: ERROR_RED }}>*</span>
            </label>
            <input
              id="recovery-code"
              data-recovery-code
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              onFocus={passwordFocus.on}
              onBlur={passwordFocus.off}
              style={{
                height: 50,
                border: `1px solid ${passwordFocus.value ? COLORS.teal : COLORS.borderStrong}`,
                borderRadius: 9,
                padding: "0 15px",
                fontSize: 16,
                fontFamily: FONTS.mono,
                letterSpacing: ".06em",
                color: COLORS.ink,
                outline: "none",
                boxShadow: passwordFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
                transition: "border-color .12s, box-shadow .12s",
              }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <label style={{ fontSize: 14, fontWeight: 600, color: COLORS.text }}>
                Password:<span style={{ color: ERROR_RED }}>*</span>
              </label>
              <a href="#reset" style={{ fontSize: 14, fontWeight: 500 }}>
                Forgot Password ?
              </a>
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Enter Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onFocus={passwordFocus.on}
              onBlur={passwordFocus.off}
              style={{
                height: 50,
                border: `1px solid ${passwordFocus.value ? COLORS.teal : COLORS.borderStrong}`,
                borderRadius: 9,
                padding: "0 15px",
                fontSize: 15,
                color: COLORS.ink,
                outline: "none",
                boxShadow: passwordFocus.value ? `0 0 0 3px ${COLORS.focusRing}` : "none",
                transition: "border-color .12s, box-shadow .12s",
              }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          onMouseEnter={buttonHover.on}
          onMouseLeave={buttonHover.off}
          style={{
            height: 52,
            marginTop: 6,
            border: "none",
            borderRadius: 9,
            background: buttonHover.value && !submitting ? COLORS.tealDark : COLORS.teal,
            color: "#fff",
            fontSize: 16,
            fontWeight: 600,
            cursor: submitting ? "default" : "pointer",
            opacity: submitting ? 0.75 : 1,
            transition: "background .12s",
          }}
        >
          {submitting ? "Signing in…" : mode === "recovery" ? "Sign in with the code" : "Login"}
        </button>
        {recovery && (
          <button
            type="button"
            data-recovery-toggle
            onClick={() => {
              setMode(mode === "recovery" ? "password" : "recovery");
              setError(null);
            }}
            style={{ alignSelf: "center", marginTop: -8, border: "none", background: "none", color: COLORS.teal, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
          >
            {mode === "recovery" ? "Back to the password sign-in" : "Use a recovery code"}
          </button>
        )}
      </form>
    </div>
  );
}
