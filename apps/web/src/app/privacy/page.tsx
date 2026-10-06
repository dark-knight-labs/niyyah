import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy - Niyyah" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 space-y-5 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="text-[var(--muted-foreground)]">Last updated 6 October 2026</p>
      <p>
        Niyyah is a personal productivity app run by Alamin Mahamud for his own use at niyyah.alamin.rocks. Anyone can view
        the public routine page. Everything else is private to the owner.
      </p>
      <h2 className="text-lg font-semibold">What Niyyah handles</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>The owner&apos;s account details (email, hashed password) and sign-in sessions.</li>
        <li>Notes, tasks and logs stored in the owner&apos;s own Obsidian vault, which Niyyah reads and writes.</li>
        <li>
          If the owner connects Google Calendar: a refresh token and the connected Google email address, used only to add
          events to and read events from that calendar.
        </li>
      </ul>
      <h2 className="text-lg font-semibold">Google user data</h2>
      <p>
        Niyyah asks for the Google Calendar events permission and your email address. It uses them only to create events you
        enter on the routine page and to display your events on the daily ring. Google data is not shared with anyone, not
        sold, not used for advertising, and not used to train AI models. Niyyah&apos;s use of information received from Google
        APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>
      <h2 className="text-lg font-semibold">Storage and retention</h2>
      <p>
        Data lives on the owner&apos;s own servers. The Google refresh token is stored in the app&apos;s database. You can revoke
        access at any time at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>; on
        request the stored token is deleted. Visitors who are not signed in are not tracked and no cookies are set for them.
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>Questions or deletion requests: alamin.root@gmail.com.</p>
      <p><Link className="underline" href="/terms">Terms of Service</Link></p>
    </main>
  );
}
