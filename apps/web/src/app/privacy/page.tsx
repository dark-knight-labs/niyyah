import type { Metadata } from "next";
import Link from "next/link";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy - Niyyah" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 space-y-5 text-sm leading-relaxed">
      <h1 className="text-2xl font-semibold">Privacy Policy</h1>
      <p className="text-[var(--muted-foreground)]">Last updated 9 October 2026</p>
      <p>
        Niyyah{site.url ? ` at ${site.url}` : ""} is a personal planner run by {site.operator}. Everything you enter is private to
        your account.
      </p>
      <h2 className="text-lg font-semibold">What Niyyah handles</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>Your account details (email, hashed password) and sign-in sessions.</li>
        <li>What you put in the planner: your blocks and schedule, tasks, logs, goals, streams and pipelines.</li>
        <li>Calendar addresses you add. They are stored on the server and never sent back to the browser.</li>
        <li>
          If you connect Google Calendar: a refresh token and the connected Google email address, used only to add
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
        Data lives in the database of the server that runs Niyyah. The Google refresh token is stored there too. You can revoke
        access at any time at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>; on
        request the stored token is deleted, and you can download all your data from your account. Visitors who are not signed
        in are not tracked and no cookies are set for them.
      </p>
      <h2 className="text-lg font-semibold">Contact</h2>
      <p>{site.contact ? `Questions or deletion requests: ${site.contact}.` : `Questions or deletion requests: contact ${site.operator}.`}</p>
      <p><Link className="underline" href="/terms">Terms of Service</Link></p>
    </main>
  );
}
