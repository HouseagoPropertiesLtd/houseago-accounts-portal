// Receipt scanning proxy — hands a photographed/uploaded receipt to Azure
// AI Document Intelligence's prebuilt "Receipt" model (a purpose-built
// receipt-reading model, not general OCR) and hands back a small, already
// -parsed result: merchant name, date, total, tax, and line items.
//
// Why this exists as an Edge Function rather than calling Azure straight
// from the browser: Azure needs a subscription key on every request, and a
// key sitting in assets/*.js would be visible to anyone who opens the
// site's dev tools — they could then run up usage/cost against Oscar's
// Azure account. This function is the one place that key is allowed to
// exist: it runs on Supabase's own servers (like expiry-digest), reads the
// key from a secret Supabase injects into its environment, and checks the
// caller's own session token (via supabase.auth.getUser) to confirm this
// is a real signed-in portal user before ever touching Azure — not just
// anyone holding the site's public anon key, which alone isn't proof of
// sign-in (see SETUP.md).
//
// What it does NOT do: replace the client-side scanning in assets/doc-scan.js
// and assets/receipts.js. That code still runs first, still works with no
// setup at all (as it always has), and still auto-crops/fills fields from
// whatever this function returns, if it's configured (see SETUP.md — this
// is optional). If AZURE_DOC_INTEL_ENDPOINT/AZURE_DOC_INTEL_KEY aren't set,
// this function replies with { error: 'not_configured' } and the caller
// falls back to the existing free, fully client-side Tesseract path,
// exactly as it does today.
//
// Secrets this function needs (set once, see SETUP.md — never put these in
// any file in this repo):
//   AZURE_DOC_INTEL_ENDPOINT  — e.g. https://your-resource.cognitiveservices.azure.com
//                               (from the Azure Document Intelligence
//                               resource's "Keys and Endpoint" page)
//   AZURE_DOC_INTEL_KEY       — either key shown on that same page
//
// Request: POST, body = the raw image/PDF bytes, Content-Type set to the
// real mime type (image/jpeg, image/png, application/pdf, ...) — exactly
// what a browser's fetch(..., { body: file }) sends a File/Blob as.
//
// Response: 200 with a JSON body shaped like:
//   {
//     merchant: string | null,
//     date: "YYYY-MM-DD" | null,
//     total: number | null,
//     tax: number | null,
//     currency: string | null,
//     items: [{ description: string | null, amount: number | null }]
//   }
// or a non-200 with { error: '...' } — "not_configured" specifically means
// "the secrets above aren't set yet", which the caller treats as "fall
// back to the free path" rather than a real failure.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API_VERSION = '2024-11-30';
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 45000;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

// Azure returns money as { amount, currencyCode, currencySymbol } and most
// other fields as { content, valueString/valueDate/valueNumber, confidence }
// depending on field type — this pulls out just the plain value, whichever
// shape it came in as, and never throws on a field that's missing (a
// receipt this model isn't confident about a field for just omits it,
// which is normal, not an error).
function fieldValue(field: any): any {
  if (!field) return null;
  if (field.valueDate != null) return field.valueDate;
  if (field.valueNumber != null) return field.valueNumber;
  if (field.valueString != null) return field.valueString;
  if (field.valueCurrency != null) return field.valueCurrency.amount ?? null;
  if (field.content != null) return field.content;
  return null;
}

function currencyOf(field: any): string | null {
  return field?.valueCurrency?.currencyCode ?? field?.valueCurrency?.currencySymbol ?? null;
}

function parseReceiptResult(analyzeResult: any) {
  const doc = analyzeResult?.documents?.[0];
  const fields = doc?.fields || {};

  const items: { description: string | null; amount: number | null }[] = [];
  const itemsField = fields.Items;
  if (itemsField?.valueArray) {
    for (const item of itemsField.valueArray) {
      const itemFields = item?.valueObject || {};
      items.push({
        description: fieldValue(itemFields.Description),
        amount: fieldValue(itemFields.TotalPrice)
      });
    }
  }

  return {
    merchant: fieldValue(fields.MerchantName),
    date: fieldValue(fields.TransactionDate),
    total: fieldValue(fields.Total),
    tax: fieldValue(fields.TotalTax),
    currency: currencyOf(fields.Total) || currencyOf(fields.Subtotal),
    items
  };
}

async function pollForResult(operationLocation: string, subscriptionKey: string): Promise<any> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(operationLocation, {
      headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey }
    });
    if (!res.ok) {
      throw new Error(`Azure polling failed (${res.status}): ${await res.text()}`);
    }
    const body = await res.json();
    if (body.status === 'succeeded') return body.analyzeResult;
    if (body.status === 'failed') {
      throw new Error('Azure could not read that document: ' + (body.error?.message || 'unknown error'));
    }
    // status is "running" or "notStarted" - wait and try again
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for Azure to finish reading the document');
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Use POST with the receipt image/PDF as the request body.' }, 405, origin);
  }

  // Supabase's platform-level "verify JWT" check (on by default for every
  // Edge Function) only confirms the Authorization header is SOME validly
  // -signed Supabase token — and the public anon key is itself a valid
  // token of that kind. That key is meant to be public (it's printed in
  // this site's own client-shipped JavaScript, same as always — see
  // SETUP.md), so on its own it does NOT mean "a signed-in portal user
  // made this request". Left unchecked, that would let anyone who finds
  // this site's public URL call this function directly, with no account
  // at all, and run through the shared Azure quota for nothing. This
  // check confirms the token actually belongs to a real signed-in user,
  // not just anyone holding the public key.
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const supabaseUrlForAuth = Deno.env.get('SUPABASE_URL');
  const anonKeyForAuth = Deno.env.get('SUPABASE_ANON_KEY');
  if (!token || !supabaseUrlForAuth || !anonKeyForAuth) {
    return jsonResponse({ error: 'Not signed in.' }, 401, origin);
  }
  const authClient = createClient(supabaseUrlForAuth, anonKeyForAuth);
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: 'Not signed in.' }, 401, origin);
  }

  const endpoint = Deno.env.get('AZURE_DOC_INTEL_ENDPOINT');
  const key = Deno.env.get('AZURE_DOC_INTEL_KEY');
  if (!endpoint || !key) {
    // Not an error a person needs to see - just tells the caller "Azure
    // isn't set up yet", so it can silently fall back to the existing
    // client-side scan the way it always has.
    return jsonResponse({ error: 'not_configured' }, 501, origin);
  }

  const contentType = req.headers.get('content-type') || 'application/octet-stream';
  const bytes = await req.arrayBuffer();
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: 'No file received.' }, 400, origin);
  }
  // A phone photo is rarely small, but a stuck/huge upload shouldn't run up
  // Azure usage for nothing - the same ceiling the client already applies
  // to what it'll attempt to read.
  if (bytes.byteLength > 20 * 1024 * 1024) {
    return jsonResponse({ error: 'File is too large to scan (20MB limit).' }, 413, origin);
  }

  const analyzeUrl = `${endpoint.replace(/\/$/, '')}/documentintelligence/documentModels/prebuilt-receipt:analyze?api-version=${API_VERSION}`;

  try {
    const submitRes = await fetch(analyzeUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': contentType
      },
      body: bytes
    });

    if (submitRes.status !== 202) {
      const detail = await submitRes.text();
      return jsonResponse({ error: `Azure rejected the document (${submitRes.status}): ${detail}` }, 502, origin);
    }

    const operationLocation = submitRes.headers.get('operation-location');
    if (!operationLocation) {
      return jsonResponse({ error: 'Azure accepted the document but did not say where to check the result.' }, 502, origin);
    }

    const analyzeResult = await pollForResult(operationLocation, key);
    return jsonResponse(parseReceiptResult(analyzeResult), 200, origin);
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 502, origin);
  }
});
