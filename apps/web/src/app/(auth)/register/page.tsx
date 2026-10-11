"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { register } from "@/lib/auth";
import { AuthSheet } from "@/components/auth/auth-sheet";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await register(email, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthSheet eyebrow="Register / new notebook" title={<>Start with one <span>intention.</span></>} lead="Create an account for your plan, your ring and your progress. Six characters or more for the password." facts={[["Account","Per user"],["Password","6+ characters"],["Transport","TLS"]]} alt={<>Have an account? <Link href="/login">Sign in</Link></>}>
      <form onSubmit={handleSubmit}>
        {error && <p className="sheet-err" role="alert">{error}</p>}
        <div className="sheet-field"><label className="mono" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div className="sheet-field"><label className="mono" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        <button type="submit" disabled={loading} className="sheet-go mono"><span>{loading ? "Creating..." : "Create account"}</span><span aria-hidden="true">→</span></button>
      </form>
    </AuthSheet>
  );
}
