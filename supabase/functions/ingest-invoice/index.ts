// Receives one email (from the Gmail bridge script, or any forwarder) and
// files it in invoice_inbox for a human to confirm. Never auto-files into a
// property: a suggestion is stored, a person confirms it on inbox.html.
//
// Secret needed (supabase secrets set INGEST_SECRET=...): a long random
// string, shared only with the bridge script. Deploy with JWT verification
// OFF (the bridge is not a signed-in user); the secret is the gate.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RECEIPTS_ENTITY = 'oscar-receipts-invoices';
const MAX_BYTES = 10 * 1024 * 1024;

// Supplier rules: first match wins. Add a line per recurring supplier.
const RULES: { test: RegExp; supplier: string; entity: string | null; why: string }[] = [
  { test: /crosby home and garden/i, supplier: 'Crosby home and garden', entity: '3-horning-close', why: 'Crosby always invoices 3 Horning Close' },
  { test: /bookkeepher/i, supplier: 'Bookkeepher Ltd', entity: 'ltd-company', why: 'Bookkeeping fees are company-level' },
  { test: /lcsdr\.com|lcs ref/i, supplier: 'LCS Debt Recovery (E.ON)', entity: '6a-chaucer-street', why: 'E.ON bill for 6a Chaucer Street' },
  { test: /minorsandbrady/i, supplier: 'Minors & Brady', entity: null, why: 'Property named in the subject' },
];
const PROPERTY_WORDS: [RegExp, string][] = [
  [/6a\s+chaucer/i, '6a-chaucer-street'], [/6\s+chaucer/i, '6-chaucer-street'],
  [/north\s+denes/i, '33-north-denes'], [/wild\s+thyme/i, 'wild-thyme'],
  [/horning/i, '3-horning-close'],
];
const NOISE = /(membership|docusign|eversign|unsubscribe|newsletter|marketing|payment advice request)/i;

function suggest(sender: string, subject: string, body: string) {
  const hay = sender + ' ' + subject;
  let supplier: string | null = null, entity: string | null = null, why = 'No rule matched. Please choose.';
  for (const r of RULES) if (r.test.test(hay) || r.test.test(body.slice(0, 600))) {
    supplier = r.supplier; entity = r.entity; why = r.why; break;
  }
  if (!entity) for (const [re, id] of PROPERTY_WORDS) if (re.test(subject) || re.test(body)) {
    entity = id; why = 'Property named in the email'; break;
  }
  return { supplier, entity, why };
}

function pickAmount(text: string): number | null {
  const m = text.match(/(?:balance due|amount due|total|due)[^£\d]{0,40}£\s?([\d,]+\.\d{2})/i)
    || text.match(/£\s?([\d,]+\.\d{2})/);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
function pickRef(text: string): string | null {
  const m = text.match(/invoice\s*(?:no\.?|number|#|:)?\s*#?\s*([A-Z0-9-]{3,})/i);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = Deno.env.get('INGEST_SECRET');
  const given = req.headers.get('x-ingest-secret') || '';
  if (!secret || given.length !== secret.length || given !== secret) return json({ error: 'Forbidden' }, 403);

  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'Bad JSON' }, 400); }
  const messageId = String(b.message_id || '').slice(0, 200);
  if (!messageId) return json({ error: 'message_id required' }, 400);
  const sender = String(b.from || '').slice(0, 300), subject = String(b.subject || '').slice(0, 300);
  const body = String(b.text || '').slice(0, 20000);
  if (NOISE.test(sender + ' ' + subject)) return json({ skipped: 'noise' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: existing } = await db.from('invoice_inbox').select('id').eq('message_id', messageId).maybeSingle();
  if (existing) return json({ skipped: 'already seen' });

  let filePath: string | null = null;
  const pdf = (b.attachments || []).find((a: any) => /pdf/i.test(a.content_type || '') || /\.pdf$/i.test(a.filename || ''));
  if (pdf && pdf.content_base64) {
    const bytes = Uint8Array.from(atob(pdf.content_base64), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_BYTES) return json({ error: 'attachment too large' }, 413);
    filePath = RECEIPTS_ENTITY + '/inbox/' + crypto.randomUUID() + '.pdf';
    const up = await db.storage.from('owner-documents').upload(filePath, bytes, { contentType: 'application/pdf' });
    if (up.error) return json({ error: 'upload failed' }, 500);
  }

  const s = suggest(sender, subject, body);
  const dateOk = /^\d{4}-\d{2}-\d{2}/.test(b.date || '') ? String(b.date).slice(0, 10) : null;
  const { error } = await db.from('invoice_inbox').insert({
    message_id: messageId, source: String(b.source || 'gmail').slice(0, 20), sender, subject,
    supplier: s.supplier, invoice_ref: pickRef(subject + ' ' + body), amount: pickAmount(body),
    doc_date: dateOk, suggested_entity_id: s.entity, suggestion_reason: s.why, file_path: filePath,
  });
  if (error) return json({ error: 'insert failed' }, 500);
  return json({ queued: true, suggested: s.entity });
});
