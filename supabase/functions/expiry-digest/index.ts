// Weekly "documents expiring soon" email digest.
//
// This is a Supabase Edge Function — it runs on Supabase's own servers, not
// in anyone's browser, so (unlike every other file in this repo) it's
// allowed to use the Supabase "service_role" key: that key never appears in
// any file here, never ships to a browser, and is only ever read from this
// function's own environment, where Supabase injects it automatically for
// every Edge Function. See SETUP.md section 9 for how this gets deployed
// and scheduled.
//
// What it does, once a week (triggered by a pg_cron job, see SETUP.md):
//   1. Reads every entity_documents row with a "Valid until" date that's
//      already passed, or falls within the next 60 days.
//   2. If there's nothing due, does nothing else — no email, no noise.
//   3. Otherwise, groups what's due by property/section, and emails a plain
//      summary to whichever addresses are configured, via Resend.
//
// Secrets this function needs (set once, see SETUP.md — never put these in
// any file in this repo):
//   RESEND_API_KEY        — from resend.com, after verifying a sending domain
//   REMINDER_RECIPIENTS    — comma-separated email addresses, e.g.
//                            "oscar@example.com,sally@example.com"
//   REMINDER_FROM_EMAIL    — optional, e.g.
//                            "Houseago Asset Management <reminders@yourdomain>"
//                            (must be on the domain verified with Resend);
//                            defaults to Resend's own onboarding address,
//                            which only works for testing, not real delivery

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPIRING_SOON_DAYS = 60;

const COMPLIANCE_LABELS: Record<string, string> = {
  gas_safety: 'Gas Safety Certificate (CP12)',
  eicr: 'Electrical Installation Condition Report (EICR)',
  epc: 'Energy Performance Certificate (EPC)',
  legionella: 'Legionella Risk Assessment'
};

function daysUntil(dateStr: string, today: Date): number {
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

function formatDateUK(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric'
  });
}

// Self Assessment's two fixed HMRC deadlines, same idea as the dashboard
// banner (assets/auth.js) — 31 January and 31 July, always the next
// upcoming occurrence of each, independent of anything uploaded.
function nextOccurrence(month: number, day: number, today: Date): string {
  const year = today.getFullYear();
  let candidate = new Date(year, month - 1, day);
  if (candidate < today) candidate = new Date(year + 1, month - 1, day);
  return candidate.getFullYear() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function selfAssessmentDates(today: Date): { label: string; date: string }[] {
  return [
    { label: 'Self Assessment balancing payment due', date: nextOccurrence(1, 31, today) },
    { label: 'Self Assessment payment on account due', date: nextOccurrence(7, 31, today) }
  ];
}

Deno.serve(async (_req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const recipientsRaw = Deno.env.get('REMINDER_RECIPIENTS');
    const fromEmail = Deno.env.get('REMINDER_FROM_EMAIL') || 'Houseago Asset Management <onboarding@resend.dev>';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (should be auto-provided to every Edge Function).' }), { status: 500 });
    }
    if (!resendApiKey || !recipientsRaw) {
      return new Response(JSON.stringify({ error: 'Missing the RESEND_API_KEY and/or REMINDER_RECIPIENTS secrets — see SETUP.md section 9.' }), { status: 500 });
    }
    const recipients = recipientsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ error: 'REMINDER_RECIPIENTS is set but empty.' }), { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + EXPIRING_SOON_DAYS);
    const cutoffIso = cutoff.toISOString().slice(0, 10);

    // service_role bypasses row-level security entirely, by design — this
    // digest is a system-wide job, not scoped to any one signed-in user.
    const { data: docs, error } = await supabase
      .from('entity_documents')
      .select('id, entity_id, name, valid_until, compliance_type, entities(name)')
      .not('valid_until', 'is', null)
      .lte('valid_until', cutoffIso)
      .order('valid_until', { ascending: true });

    if (error) {
      return new Response(JSON.stringify({ error: 'Could not query entity_documents: ' + error.message }), { status: 500 });
    }

    const docRows = (docs || []).map((doc: any) => {
      const daysLeft = daysUntil(doc.valid_until, today);
      const label = (doc.compliance_type && COMPLIANCE_LABELS[doc.compliance_type]) || doc.name || 'Document';
      const entityName = (doc.entities && doc.entities.name) || doc.entity_id;
      const when = daysLeft < 0
        ? 'expired ' + formatDateUK(doc.valid_until)
        : daysLeft === 0
          ? 'expires today'
          : 'expires in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's');
      return { label, entityName, when, overdue: daysLeft < 0, daysLeft };
    });

    const dateRows = selfAssessmentDates(today)
      .map((d) => {
        const daysLeft = daysUntil(d.date, today);
        const when = daysLeft < 0
          ? 'overdue since ' + formatDateUK(d.date)
          : daysLeft === 0
            ? 'due today'
            : 'due in ' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's');
        return { label: d.label, entityName: '', when, overdue: daysLeft < 0, daysLeft };
      })
      .filter((r) => r.daysLeft <= EXPIRING_SOON_DAYS);

    const rows = docRows.concat(dateRows).sort((a, b) => a.daysLeft - b.daysLeft);

    if (rows.length === 0) {
      return new Response(JSON.stringify({ sent: false, reason: 'Nothing due — no email sent.' }), { status: 200 });
    }

    const overdue = rows.filter((r) => r.overdue);
    const upcoming = rows.filter((r) => !r.overdue);

    function rowsToHtml(list: typeof rows): string {
      return list.map((r) =>
        '<tr><td style="padding:6px 12px 6px 0;">' + escapeHtml(r.label) + '</td>' +
        '<td style="padding:6px 12px 6px 0; color:#68717f;">' + escapeHtml(r.entityName) + '</td>' +
        '<td style="padding:6px 0; font-weight:700;">' + escapeHtml(r.when) + '</td></tr>'
      ).join('');
    }

    function escapeHtml(s: string): string {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
    }

    const html =
      '<div style="font-family:sans-serif; color:#152238; max-width:560px;">' +
      '<h2 style="margin-bottom:4px;">Houseago Asset Management</h2>' +
      '<p style="color:#68717f; margin-top:0;">Weekly check — documents and Self Assessment deadlines due or coming due within the next ' + EXPIRING_SOON_DAYS + ' days.</p>' +
      (overdue.length > 0
        ? '<h3 style="color:#b3261e;">Overdue (' + overdue.length + ')</h3><table>' + rowsToHtml(overdue) + '</table>'
        : '') +
      (upcoming.length > 0
        ? '<h3 style="color:#9a5b00;">Coming up (' + upcoming.length + ')</h3><table>' + rowsToHtml(upcoming) + '</table>'
        : '') +
      '<p style="color:#68717f; font-size:13px; margin-top:24px;">Open the portal to renew or re-upload these. This is an automated weekly digest — it repeats until each item is updated with a new date.</p>' +
      '</div>';

    const subject = overdue.length > 0
      ? overdue.length + ' item' + (overdue.length === 1 ? ' is' : 's are') + ' overdue — Houseago Asset Management'
      : rows.length + ' item' + (rows.length === 1 ? '' : 's') + ' due soon — Houseago Asset Management';

    const resendResult = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + resendApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject: subject,
        html: html
      })
    });

    if (!resendResult.ok) {
      const errText = await resendResult.text();
      return new Response(JSON.stringify({ error: 'Resend rejected the email: ' + errText }), { status: 502 });
    }

    return new Response(JSON.stringify({ sent: true, recipients: recipients, itemCount: rows.length, overdueCount: overdue.length }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
