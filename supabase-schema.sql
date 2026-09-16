-- Run this once in your Supabase project's SQL editor (Database -> SQL Editor -> New query).
-- This is a SEPARATE Supabase project from the Houseago Properties Ltd tenant
-- portal's — keep the two projects and their keys completely apart.
--
-- It sets up:
--   entities         one row per company, sole trader account, property,
--                    or per-property document section (Compliance &
--                    Tenancy, Insurance), plus the shared Receipts &
--                    Invoices section
--   portal_access     which signed-in users can see which entities, and
--                     whether they're allowed to upload into them
--   entity_documents  the documents themselves (the file lives in Storage,
--                     this table just points at it)
-- and locks all three down with row-level security so a user can only ever
-- see the entities they've been explicitly given access to. It also wires
-- up optional two-factor authentication enforcement (section 5 below) —
-- each account can turn on an authenticator-app code at login from
-- security.html; this is what makes that actually required at the
-- database level, not just on the login page.

-- ---------------------------------------------------------------------------
-- 1. Entities
-- ---------------------------------------------------------------------------
create table if not exists public.entities (
  id text primary key,
  name text not null,
  sort_order int not null default 0
);

alter table public.entities enable row level security;

-- Anyone signed in can read the list of entities (just names, nothing
-- sensitive) — what actually restricts a user to their own sections is
-- portal_access and entity_documents below, not this table.
create policy "Signed in users read entities"
  on public.entities
  for select
  using (auth.uid() is not null);

insert into public.entities (id, name, sort_order) values
  ('ltd-company', 'Houseago Properties Ltd', 1),
  ('ltd-company-income', 'Houseago Properties Ltd - Income', 2),
  ('oscar-sole-trader', 'Oscar - Sole Trader (Personal)', 2),
  ('oscar-bank-statements', 'Oscar - Bank Statements', 21),
  ('oscar-investment-dividends', 'Oscar - Investment & Dividend Returns', 22),
  ('oscar-employment-payslips', 'Oscar - Employment (Payslips)', 23),
  ('sally-sole-trader', 'Sally - Sole Trader (Personal)', 3),
  ('sally-bank-statements', 'Sally - Bank Statements', 24),
  ('sally-investment-dividends', 'Sally - Investment & Dividend Returns', 25),
  ('sally-employment-payslips', 'Sally - Employment (Payslips)', 26),
  ('33-north-denes', '33 North Denes', 4),
  ('33-north-denes-compliance-tenancy', '33 North Denes - Compliance & Tenancy', 5),
  ('33-north-denes-insurance', '33 North Denes - Insurance', 6),
  ('6-chaucer-street', '6 Chaucer Street', 7),
  ('6-chaucer-street-compliance-tenancy', '6 Chaucer Street - Compliance & Tenancy', 8),
  ('6-chaucer-street-insurance', '6 Chaucer Street - Insurance', 9),
  ('6a-chaucer-street', '6a Chaucer Street', 10),
  ('6a-chaucer-street-compliance-tenancy', '6a Chaucer Street - Compliance & Tenancy', 11),
  ('6a-chaucer-street-insurance', '6a Chaucer Street - Insurance', 12),
  ('iris-houseago-finances', 'Iris Houseago Finances', 13),
  ('iris-bank-statements', 'Iris - Bank Statements', 27),
  ('iris-investment-dividends', 'Iris - Investment & Dividend Returns', 28),
  ('iris-employment-payslips', 'Iris - Employment (Payslips)', 29),
  ('oscar-receipts-invoices', 'Oscar - Receipts & Invoices', 14),
  ('wild-thyme', 'Wild Thyme', 15),
  ('wild-thyme-compliance-tenancy', 'Wild Thyme - Compliance & Tenancy', 16),
  ('wild-thyme-insurance', 'Wild Thyme - Insurance', 17),
  ('3-horning-close', '3 Horning Close', 18),
  ('3-horning-close-compliance-tenancy', '3 Horning Close - Compliance & Tenancy', 19),
  ('3-horning-close-insurance', '3 Horning Close - Insurance', 20),
  ('33-north-denes-income', '33 North Denes - Income', 33),
  ('6-chaucer-street-income', '6 Chaucer Street - Income', 34),
  ('6a-chaucer-street-income', '6a Chaucer Street - Income', 35),
  ('wild-thyme-income', 'Wild Thyme - Income', 36),
  ('3-horning-close-income', '3 Horning Close - Income', 37),
  ('sally-receipts-invoices', 'Sally - Receipts & Invoices', 38),
  ('iris-receipts-invoices', 'Iris - Receipts & Invoices', 39)
on conflict (id) do nothing;

-- 3 Horning Close is owned by Houseago Properties Ltd (Oscar is the Ltd's
-- exclusive shareholder, so it's a company asset, not his personal
-- property — unlike Wild Thyme, which really is Sally's own). Because of
-- that, its rent is tracked as the Ltd's own business income rather than
-- the property's own — there is deliberately no '3-horning-close-income'
-- or '3-horning-close-insurance' access in ordinary use, and the entity
-- id itself (bare '3-horning-close', i.e. its Documents section) isn't
-- granted either. The only thing left at the property level is
-- '3-horning-close-compliance-tenancy' (property-specific paperwork:
-- gas safety, EICR, deposit certificate, etc. — see section 10 of
-- SETUP.md), which renders on the dashboard grouped under Houseago
-- Properties Ltd rather than in Properties (see COMPANY_OWNED_PROPERTY_IDS
-- in assets/auth.js). Rent itself is entered against the new
-- 'ltd-company-income' entity above, on Houseago Properties Ltd's own
-- page, the same Income & Outgoings mechanism every property uses.
-- ('3-horning-close-income' and '3-horning-close-insurance' rows still
-- exist below for now, in case anything was ever filed under them before
-- this change — nothing currently is — but they're not meant to be
-- granted to anyone going forward.)
--
-- Receipts & Invoices is now three separate entities, one per person
-- (oscar-receipts-invoices / sally-receipts-invoices /
-- iris-receipts-invoices), each with its own page
-- (receipts.html?owner=oscar / sally / iris) reachable from that
-- person's own page (person.html). Every submission is still optionally
-- tagged/linked to a property or account via related_entity_id — a
-- property's Income & Outgoings "Outgoing" total on property.html and
-- person.html sums across all three of these entities filtered by
-- related_entity_id, so RLS naturally limits what a given viewer sees.
--
-- The five "-income" rows above power a fourth sub-section on each
-- property's own page (property.html) — Income, alongside Documents,
-- Compliance & Tenancy, and Insurance — used for rent and other income
-- recorded against that property (see the note above entity_documents'
-- file_path column: income entries don't need an uploaded file).

-- The nine "-bank-statements" / "-investment-dividends" / "-employment-payslips"
-- rows above power the Bank Statements, Investment & Dividend Returns, and
-- Employment (Payslips) submission points on each person's own page
-- (person.html?id=oscar / sally / iris) — same idea as a property's
-- Compliance & Tenancy and Insurance sections, just keyed to a person
-- instead. Their sort_order doesn't matter much since person.html always
-- shows them in the same fixed order regardless.

-- If you've already run this file once before (so some of the rows above
-- already exist and "on conflict do nothing" skipped them), run this once
-- to fix up sort_order so everything lines up under the right property:
-- update public.entities set sort_order = 7 where id = '6-chaucer-street';
-- update public.entities set sort_order = 10 where id = '6a-chaucer-street';
-- update public.entities set sort_order = 13 where id = 'iris-houseago-finances';
-- update public.entities set sort_order = 15 where id = 'wild-thyme';
-- update public.entities set sort_order = 17 where id = 'wild-thyme-insurance';

-- ---------------------------------------------------------------------------
-- 2. Portal access — who can see/upload to which entity
-- ---------------------------------------------------------------------------
create table if not exists public.portal_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id text not null references public.entities(id) on delete cascade,
  can_upload boolean not null default false,
  primary key (user_id, entity_id)
);

alter table public.portal_access enable row level security;

-- A user can only ever read their own access rows — this is what the
-- dashboard uses to decide which entity sections to show someone.
create policy "Users read own access rows"
  on public.portal_access
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. Documents
-- ---------------------------------------------------------------------------
create table if not exists public.entity_documents (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(id) on delete cascade,
  name text not null,
  category text,
  -- year is an optional label used to archive/filter documents by year on
  -- the dashboard (e.g. "2025", "2026") — set from the upload form's Year
  -- dropdown for ordinary sections, or derived automatically from doc_date
  -- for Receipts & Invoices submissions. Purely a label: it doesn't affect
  -- who can see a document, only how it's grouped on screen.
  year text,
  valid_until date,
  -- Used specifically by the Receipts & Invoices page (receipts.html):
  -- doc_date is the receipt/invoice's own date, notes is its free-text
  -- description, and related_entity_id is the optional "relates to" link
  -- to one of the core accounts/properties. All three are nullable and
  -- unused by the other, per-property sections.
  doc_date date,
  notes text,
  related_entity_id text references public.entities(id) on delete set null,
  -- amount is the receipt/invoice's total, in pounds — read automatically
  -- off the document where possible (see receipts.js), always editable, and
  -- what the "Expenses by financial year" chart on receipts.html totals up.
  -- Nullable and unused outside Receipts & Invoices.
  amount numeric(10, 2),
  -- expense_category is a fixed pick-list (see EXPENSE_CATEGORIES in
  -- receipts.js) used only by Receipts & Invoices submissions, roughly
  -- matching the categories a UK property tax return groups expenses into
  -- — separate from the free-text "category" field above, which is used by
  -- the ordinary per-property document sections for a note like "Filed 14
  -- July 2026", not an expense type.
  expense_category text,
  -- expense_type is a fixed two-way pick-list ('Property Expense' or
  -- 'Business Expense', see EXPENSE_TYPES in receipts.js), used only by
  -- Receipts & Invoices submissions — separate from expense_category
  -- above (which groups WHAT kind of cost it is), this is about WHO it
  -- belongs to for the accounts: a specific property's own running costs,
  -- or Houseago Properties Ltd's general overheads, not tied to any one
  -- property (accountancy fees, software, and the like).
  expense_type text,
  -- entry_type is 'Income' or 'Outgoing', set only on rows in a property or
  -- person's own "...-income" section (the hand-typed/scanned Income &
  -- Outgoings ledger) — distinguishes rent received from money spent that
  -- was logged directly on the ledger rather than through Receipts &
  -- Invoices, so the running totals split correctly. An older row with
  -- nothing set here is treated as Income, matching how the ledger worked
  -- before this column existed. Unused outside "...-income" sections.
  entry_type text,
  -- compliance_type is set only on documents uploaded into a "...
  -- -compliance-tenancy" section, and only when the document IS one of the
  -- fixed certificate/assessment types the Compliance status panel tracks
  -- (see COMPLIANCE_TYPES in auth.js) — 'gas_safety', 'eicr', 'epc', or
  -- 'legionella'. Left null for anything else filed in that section, e.g. a
  -- tenancy agreement, which just appears in the ordinary document list.
  compliance_type text,
  -- file_path is nullable because a row in a property's "...-income"
  -- section (see the Income sub-entities above) is a pure data record —
  -- a rent payment's date, description and amount, either picked out of
  -- a bank statement or typed in by hand — with no document of its own
  -- attached. Every other section always sets it, same as before.
  file_path text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- If this table already existed before year/doc_date/notes/related_entity_id/
-- amount/expense_category/expense_type/entry_type/compliance_type were
-- added, these bring an existing database up to date (harmless to re-run —
-- a fresh project just skips them since the columns above already created
-- them).
alter table public.entity_documents add column if not exists year text;
alter table public.entity_documents add column if not exists doc_date date;
alter table public.entity_documents add column if not exists notes text;
alter table public.entity_documents add column if not exists related_entity_id text references public.entities(id) on delete set null;
alter table public.entity_documents add column if not exists amount numeric(10, 2);
alter table public.entity_documents add column if not exists expense_category text;
alter table public.entity_documents add column if not exists expense_type text;
alter table public.entity_documents add column if not exists entry_type text;
alter table public.entity_documents add column if not exists compliance_type text;

-- One-off backfill: existing "...-income" ledger rows predate entry_type
-- and would otherwise all read as Income (including hand-typed expenses
-- like a gardener or an insurance renewal). This guesses Outgoing for any
-- row whose name matches a common expense keyword, leaving everything else
-- (rent, etc.) as Income — the same starting guess the scan itself makes
-- for a new entry, and just as editable afterwards from the property or
-- person's own page. Safe to re-run: only touches rows still null.
update public.entity_documents
set entry_type = case
  when name ~* 'garden|landscap|lawn|hedge|clean|letting agent|estate agent|managing agent|management fee|gas safety|eicr|epc|legionella|deposit protection|tenancy deposit|inventory|boiler|plumb|heating engineer|gas engineer|electrician|electrical repair|roofer|roofing|locksmith|pest control|insurance|mortgage|loan interest|solicitor|conveyanc|legal fee|accountant|bookkeep|ground rent|service charge|council tax|water (bill|rates|board)|electricity bill|energy bill|gas bill|broadband|internet (bill|provider)'
    then 'Outgoing'
  else 'Income'
end
where entity_id like '%-income' and entry_type is null;
-- Only needed if this table was created before file_path became nullable
-- (a fresh run of the create table above already has it right):
alter table public.entity_documents alter column file_path drop not null;

alter table public.entity_documents enable row level security;

-- Anyone with an access row for an entity can read its documents...
create policy "Access holders read entity documents"
  on public.entity_documents
  for select
  using (
    exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = entity_documents.entity_id
    )
  );

-- ...but only insert or delete documents for an entity where their access
-- row has can_upload set (this is what makes the accountant's access
-- read/download-only, and Oscar/Sally's upload-capable, purely from data).
-- The second half of the check (related_entity_id) matters for Receipts &
-- Invoices specifically: without it, someone could tag a submission's
-- "Relates to" link to a property/section they have no portal_access row
-- for at all — not a document leak on its own (they still couldn't read
-- that entity's own documents), but it would plant a stray entry that
-- shows up in that entity's Income & Outgoings outgoings total for
-- whoever DOES have access to it, and lets someone probe for the
-- existence of an entity id they can't otherwise see. Requiring at least
-- a read (portal_access) row on related_entity_id — not upload rights,
-- just visibility — closes both without stopping anyone from linking a
-- receipt to any property they can actually see.
-- uploaded_by must either be left blank or match whoever is actually
-- signed in — without this, anyone with upload rights to any one section
-- could set uploaded_by to someone else's account ID on their own upload,
-- forging who submitted it. auth.js always sends session.user.id (or
-- omits the field), so this never affects a normal upload through the site.
create policy "Upload-permitted users insert entity documents"
  on public.entity_documents
  for insert
  with check (
    (entity_documents.uploaded_by is null or entity_documents.uploaded_by = auth.uid())
    and exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = entity_documents.entity_id and pa.can_upload
    )
    and (
      entity_documents.related_entity_id is null
      or exists (
        select 1 from public.portal_access pa2
        where pa2.user_id = auth.uid() and pa2.entity_id = entity_documents.related_entity_id
      )
    )
  );

create policy "Upload-permitted users delete entity documents"
  on public.entity_documents
  for delete
  using (
    exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = entity_documents.entity_id and pa.can_upload
    )
  );

-- ---------------------------------------------------------------------------
-- 4. Storage
-- ---------------------------------------------------------------------------
-- Create a private bucket called "owner-documents" from the Storage tab in
-- the dashboard first (a couple of clicks), then run this. Files are stored
-- as <entity_id>/<filename>, so the same access rows above can be reused to
-- police Storage too, via the folder name.
insert into storage.buckets (id, name, public)
values ('owner-documents', 'owner-documents', false)
on conflict (id) do nothing;

create policy "Access holders read entity files"
  on storage.objects
  for select
  using (
    bucket_id = 'owner-documents'
    and exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = (storage.foldername(name))[1]
    )
  );

create policy "Upload-permitted users insert entity files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'owner-documents'
    and exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = (storage.foldername(name))[1] and pa.can_upload
    )
  );

create policy "Upload-permitted users delete entity files"
  on storage.objects
  for delete
  using (
    bucket_id = 'owner-documents'
    and exists (
      select 1 from public.portal_access pa
      where pa.user_id = auth.uid() and pa.entity_id = (storage.foldername(name))[1] and pa.can_upload
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Two-factor authentication (TOTP) enforcement
-- ---------------------------------------------------------------------------
-- Two-factor authentication (an authenticator app code, in addition to a
-- password) is compulsory for every account — set up from security.html,
-- or, for an account that hasn't enrolled yet, walked through immediately
-- on the login page itself (index.html/auth.js) straight after the
-- password step, before it ever reaches the dashboard. Uses Supabase
-- Auth's own built-in MFA support — nothing extra to run for that part,
-- it's already active as soon as your project exists. What this section
-- adds is the enforcement: without it, someone could still sign in with
-- just a password and read/upload documents, because the site's own login
-- page is just JavaScript a browser could be told to skip. These policies
-- make the database itself refuse to hand back portal_access rows,
-- documents, or files to any session that hasn't actually completed a 2FA
-- challenge this login — including an account that has never enrolled at
-- all, since 2FA isn't optional here.
--
-- mfa_ok() is true only when the current session's assurance level is
-- "aal2" — a password AND a verified TOTP code, this login. There is
-- deliberately no exemption for an account with no verified factor: every
-- account is required to have one.
create or replace function public.mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
$$;

revoke all on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

-- "as restrictive" policies are AND-ed together with the permissive
-- policies above (sections 2-4) for the same table — they can only ever
-- narrow access, never grant anything extra, so adding these can't
-- accidentally open something up.
create policy "Require completed 2FA once enrolled"
  on public.entities
  as restrictive
  for all
  using (public.mfa_ok());

create policy "Require completed 2FA once enrolled"
  on public.portal_access
  as restrictive
  for all
  using (public.mfa_ok());

create policy "Require completed 2FA once enrolled"
  on public.entity_documents
  as restrictive
  for all
  using (public.mfa_ok())
  with check (public.mfa_ok());

create policy "Require completed 2FA once enrolled"
  on storage.objects
  as restrictive
  for all
  using (bucket_id <> 'owner-documents' or public.mfa_ok())
  with check (bucket_id <> 'owner-documents' or public.mfa_ok());

-- ---------------------------------------------------------------------------
-- 6. Giving people access (do this after creating each account — see
--    SETUP.md section 5). Uncomment and fill in the real user IDs, or just
--    run these as one-off statements later once you have them.
-- ---------------------------------------------------------------------------

-- Oscar: Ltd company, his own sole trader account plus his three new
-- submission points (Bank Statements, Investment & Dividend Returns,
-- Employment/Payslips), 33 North Denes and both Chaucer Street
-- properties (shared/jointly managed) with their compliance/tenancy,
-- insurance and income sections, 3 Horning Close in full (a Houseago
-- Properties Ltd asset, managed through his access as the Ltd's
-- exclusive shareholder), all of Iris's sections (general finances plus her own
-- three new submission points — she doesn't log in herself, so Oscar
-- and Sally manage these on her behalf), all three people's Receipts &
-- Invoices (kept mutually visible between Oscar and Sally, matching how
-- the rest of their finances are shared), and Wild Thyme's insurance and
-- income sections too (he has sight of every property's insurance and
-- income, even though Wild Thyme itself is Sally's) — all with upload
-- rights.
-- insert into public.portal_access (user_id, entity_id, can_upload) values
--   ('OSCAR_USER_ID', 'ltd-company', true),
--   ('OSCAR_USER_ID', 'oscar-sole-trader', true),
--   ('OSCAR_USER_ID', 'oscar-bank-statements', true),
--   ('OSCAR_USER_ID', 'oscar-investment-dividends', true),
--   ('OSCAR_USER_ID', 'oscar-employment-payslips', true),
--   ('OSCAR_USER_ID', '33-north-denes', true),
--   ('OSCAR_USER_ID', '33-north-denes-compliance-tenancy', true),
--   ('OSCAR_USER_ID', '33-north-denes-insurance', true),
--   ('OSCAR_USER_ID', '33-north-denes-income', true),
--   ('OSCAR_USER_ID', '6-chaucer-street', true),
--   ('OSCAR_USER_ID', '6-chaucer-street-compliance-tenancy', true),
--   ('OSCAR_USER_ID', '6-chaucer-street-insurance', true),
--   ('OSCAR_USER_ID', '6-chaucer-street-income', true),
--   ('OSCAR_USER_ID', '6a-chaucer-street', true),
--   ('OSCAR_USER_ID', '6a-chaucer-street-compliance-tenancy', true),
--   ('OSCAR_USER_ID', '6a-chaucer-street-insurance', true),
--   ('OSCAR_USER_ID', '6a-chaucer-street-income', true),
--   ('OSCAR_USER_ID', '3-horning-close-compliance-tenancy', true),
--   ('OSCAR_USER_ID', 'ltd-company-income', true),
--   ('OSCAR_USER_ID', 'iris-houseago-finances', true),
--   ('OSCAR_USER_ID', 'iris-bank-statements', true),
--   ('OSCAR_USER_ID', 'iris-investment-dividends', true),
--   ('OSCAR_USER_ID', 'iris-employment-payslips', true),
--   ('OSCAR_USER_ID', 'oscar-receipts-invoices', true),
--   ('OSCAR_USER_ID', 'sally-receipts-invoices', true),
--   ('OSCAR_USER_ID', 'iris-receipts-invoices', true),
--   ('OSCAR_USER_ID', 'wild-thyme-insurance', true),
--   ('OSCAR_USER_ID', 'wild-thyme-income', true);

-- Sally: her own sole trader account plus her three new submission points,
-- 33 North Denes and both Chaucer Street properties (shared/jointly
-- managed) with their compliance/tenancy, insurance and income sections,
-- all of Iris's sections, all three people's Receipts & Invoices (kept
-- mutually visible with Oscar), and Wild Thyme in full (her own property)
-- — all with upload rights. (3 Horning Close itself is a Houseago
-- Properties Ltd asset, not personal to either of them — see the note
-- above the entities insert — so neither Oscar's nor Sally's row here
-- grants its old insurance/income sections; add
-- ('SALLY_USER_ID', '3-horning-close-compliance-tenancy', true) below too
-- if Sally should also see that property's compliance paperwork.)
-- insert into public.portal_access (user_id, entity_id, can_upload) values
--   ('SALLY_USER_ID', 'sally-sole-trader', true),
--   ('SALLY_USER_ID', 'sally-bank-statements', true),
--   ('SALLY_USER_ID', 'sally-investment-dividends', true),
--   ('SALLY_USER_ID', 'sally-employment-payslips', true),
--   ('SALLY_USER_ID', '33-north-denes', true),
--   ('SALLY_USER_ID', '33-north-denes-compliance-tenancy', true),
--   ('SALLY_USER_ID', '33-north-denes-insurance', true),
--   ('SALLY_USER_ID', '33-north-denes-income', true),
--   ('SALLY_USER_ID', '6-chaucer-street', true),
--   ('SALLY_USER_ID', '6-chaucer-street-compliance-tenancy', true),
--   ('SALLY_USER_ID', '6-chaucer-street-insurance', true),
--   ('SALLY_USER_ID', '6-chaucer-street-income', true),
--   ('SALLY_USER_ID', '6a-chaucer-street', true),
--   ('SALLY_USER_ID', '6a-chaucer-street-compliance-tenancy', true),
--   ('SALLY_USER_ID', '6a-chaucer-street-insurance', true),
--   ('SALLY_USER_ID', '6a-chaucer-street-income', true),
--   ('SALLY_USER_ID', 'iris-houseago-finances', true),
--   ('SALLY_USER_ID', 'iris-bank-statements', true),
--   ('SALLY_USER_ID', 'iris-investment-dividends', true),
--   ('SALLY_USER_ID', 'iris-employment-payslips', true),
--   ('SALLY_USER_ID', 'oscar-receipts-invoices', true),
--   ('SALLY_USER_ID', 'sally-receipts-invoices', true),
--   ('SALLY_USER_ID', 'iris-receipts-invoices', true),
--   ('SALLY_USER_ID', 'wild-thyme', true),
--   ('SALLY_USER_ID', 'wild-thyme-compliance-tenancy', true),
--   ('SALLY_USER_ID', 'wild-thyme-insurance', true),
--   ('SALLY_USER_ID', 'wild-thyme-income', true);

-- Bookkeeper/accountant, financial access only (Charlotte, Tatiana, and
-- Dominic at Triple Bottom Line Accounting were set up this way on 15 Sep
-- 2026, and had their Compliance & Tenancy AND Insurance access revoked
-- on 16 Sep 2026 — accountants see financial information only, never
-- compliance certificates, tenancy paperwork, or insurance): every entity
-- EXCEPT *-compliance-tenancy and *-insurance ones, view AND upload, so
-- they can both pull records and file things like prepared accounts back
-- into the portal. The simplest way to grant this to a new person is the
-- one used for these three — select every entity except the deprecated
-- 3-horning-close rows and every *-compliance-tenancy/*-insurance entity,
-- rather than listing each one by hand:
--
-- insert into public.portal_access (user_id, entity_id, can_upload)
-- select u.id, e.id, true
-- from auth.users u
-- cross join public.entities e
-- where u.email = 'NEW_PERSON_EMAIL'
--   and e.id not in ('3-horning-close', '3-horning-close-income', '3-horning-close-insurance')
--   and e.id not like '%-compliance-tenancy'
--   and e.id not like '%-insurance'
-- on conflict (user_id, entity_id) do update set can_upload = excluded.can_upload;
--
-- For an even more restricted accountant (read-only, or with only some
-- properties) build the row list by hand instead, following Oscar's or
-- Sally's example above, setting can_upload to false and/or leaving
-- specific entities out entirely — with no portal_access row for a given
-- entity, it never appears for them at all, not even to view. A
-- partial-access property viewer (base row and/or -income row, but not
-- -compliance-tenancy or -insurance) gets that property nested inside
-- the relevant owner's person.html page instead of its own card — see
-- PROPERTY_OWNERS in auth.js.
