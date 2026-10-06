import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms of Service - Niyyah" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 space-y-5 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Terms of Service</h1>
      <p className="text-[var(--muted-foreground)]">Last updated 6 October 2026</p>
      <p>
        Niyyah (niyyah.alamin.rocks) is a personal productivity tool run by Alamin Mahamud. By using it you agree to these terms.
      </p>
      <h2 className="text-lg font-semibold">Use of the service</h2>
      <p>
        The public routine page is free to view. Editing, tasks, logs and the Google Calendar connection are limited to the
        owner. Do not attempt to access private data, disrupt the service or probe it for weaknesses.
      </p>
      <h2 className="text-lg font-semibold">Google Calendar</h2>
      <p>
        Connecting Google Calendar is optional and can be revoked at any time from your Google account. Niyyah only adds and
        reads events as described in the <Link className="underline" href="/privacy">Privacy Policy</Link>.
      </p>
      <h2 className="text-lg font-semibold">No warranty</h2>
      <p>
        The service is provided as is, without warranties of any kind. It is a personal project: it may change, be
        unavailable or be shut down at any time. The author is not liable for any loss arising from its use, including
        missed events or lost data.
      </p>
      <h2 className="text-lg font-semibold">Changes and contact</h2>
      <p>These terms may be updated; the date above shows the latest version. Contact: alamin.root@gmail.com.</p>
    </main>
  );
}
