-- Invoice inbox: invoices found in email wait here for a human to confirm
-- which property they belong to. Run once in the Supabase SQL editor.
-- Rows are only ever INSERTED by the ingest-invoice Edge Function (service
-- role). Signed-in users with upload access to Oscar's receipts section can
-- read them and mark them filed or dismissed. The attachment itself is stored
-- under oscar-receipts-invoices/inbox/, so the existing storage policies
-- (first folder = entity id) already decide who can open it.
create table if not exists public.invoice_inbox (
  id uuid primary key default gen_random_uuid(),
  message_id text not null unique,
  source text not null default 'gmail',
  sender text,
  subject text,
  supplier text,
  invoice_ref text,
  amount numeric(10, 2),
  doc_date date,
  suggested_entity_id text references public.entities(id) on delete set null,
  suggestion_reason text,
  file_path text,
  status text not null default 'pending' check (status in ('pending', 'filed', 'dismissed')),
  filed_document_id uuid references public.entity_documents(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.invoice_inbox enable row level security;

create policy "Receipts users read inbox" on public.invoice_inbox
  for select using (exists (
    select 1 from public.portal_access pa
    where pa.user_id = auth.uid() and pa.entity_id = 'oscar-receipts-invoices' and pa.can_upload));

create policy "Receipts users update inbox status" on public.invoice_inbox
  for update using (exists (
    select 1 from public.portal_access pa
    where pa.user_id = auth.uid() and pa.entity_id = 'oscar-receipts-invoices' and pa.can_upload))
  with check (status in ('pending', 'filed', 'dismissed'));

create policy "Require completed 2FA once enrolled" on public.invoice_inbox
  as restrictive for all using (public.mfa_ok()) with check (public.mfa_ok());
