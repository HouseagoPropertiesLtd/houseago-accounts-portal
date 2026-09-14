# Setting up the Houseago Asset Management

This is a completely separate site from houseagoproperties.co.uk — its own
repo, its own hosting, and its own Supabase project (so the tenant portal
and this one never share a database). It works the same way the tenant
portal does: until you connect Supabase, it runs as a preview.

## 1. Create the GitHub repo and put the site online

1. Go to github.com and create a **new, private** repository (e.g.
   `houseago-accounts-portal`). Private matters here — this repo's contents
   aren't sensitive by themselves (no passwords are stored in code), but
   there's no reason to make it public.
2. On the new repo's page, choose "uploading an existing file" and drag in
   every file and folder from the `houseago-accounts-portal` folder you were
   sent (keep the `assets` folder structure intact), then commit.
3. Go to Settings -> Pages. Under "Build and deployment", set Source to
   "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. GitHub will give you a URL like `https://yourusername.github.io/houseago-accounts-portal/`.
   That works immediately and is all you need for now — no domain required.
   If you buy one later (e.g. `accounts.houseagoproperties.co.uk`), add a
   `CNAME` file to the repo containing just that domain, then add a CNAME
   DNS record for it pointing at `yourusername.github.io` — happy to walk
   through this with you whenever you're ready, it's a five-minute change.

Because this repo is private, GitHub Pages needs a paid plan to serve it
directly — if you'd rather not do that, keep the repo private for the
source code but know that Pages publishing from a private repo needs
GitHub Pro/Team, or you can make the repo public (there's nothing secret in
the code itself, only in Supabase).

## 2. Create your Supabase project

1. Go to supabase.com, create a free account, then a new project — pick any
   name (e.g. "houseago-accounts") and a strong database password.
2. Wait for it to finish setting up.

## 3. Run the database setup

1. In your project, go to **Storage** in the sidebar and create a new
   bucket called exactly `owner-documents`. Leave it **private**.
2. Go to the **SQL Editor**, open a new query, paste in the contents of
   `supabase-schema.sql` (included alongside this file), and run it. This
   creates the `entities`, `portal_access`, and `entity_documents` tables,
   seeds every entity (Ltd company; Oscar, Sally, and Iris's sole
   trader/finances accounts, each with its own Bank Statements, Investment
   & Dividend Returns, and Employment/Payslips submission points; the five
   properties — 33 North Denes, 6 Chaucer Street, 6a Chaucer Street, Wild
   Thyme, and 3 Horning Close — each with its own Compliance & Tenancy,
   Insurance, and Income sections (Compliance & Tenancy and Insurance are
   still separate underlying database entities from the general Documents
   one, even though on the property's page they're all shown merged into
   one "Documents" card — see section 7); and three Receipts & Invoices
   sections, one each for Oscar, Sally, and Iris), and sets up the access
   rules.
3. Go to **Authentication -> Providers -> Email**, and turn **off**
   "Confirm email" — this lets you create Oscar's, Sally's, and the
   accountant's accounts and have them log in immediately with the
   password you set, rather than needing to click a confirmation link.

## 4. Connect the website to your project

1. In your Supabase project, go to Settings -> API.
2. Copy the **Project URL** and the **anon public** key.
3. Open `assets/supabase-config.js` and paste them in, replacing the
   placeholder values.
4. Commit and push this change to the GitHub repo (or use GitHub's web
   editor, the same way changes have been made on the main site). The
   portal now uses real logins.

## 5. Create the three accounts

Do this for Oscar, Sally, and the accountant:

1. Authentication -> Users -> Add user.
2. Enter their email address and a temporary password. Leave "Auto
   confirm" ticked.
3. Optional but recommended: open "User Metadata" and add
   `{"first_name": "Oscar"}` (their real first name) so the dashboard
   greets them by name.
4. Copy their user ID from this screen (you'll need it in the next step) —
   click their row, the ID is the long string at the top.
5. Tell them their email and temporary password however you'd normally get
   in touch. There's no self-service sign-up on this site on purpose.

Two-factor authentication (an authenticator app code, alongside the
password) is available to every account but off by default — each person
turns it on for themselves from the site once they've logged in, see
section 13.

## 6. Give each account access to the right sections

Back in the SQL Editor, use the commented-out block at the bottom of
`supabase-schema.sql` as a template — uncomment it, replace
`OSCAR_USER_ID` / `SALLY_USER_ID` / `ACCOUNTANT_USER_ID` with the real user
IDs from step 5, and run it. As set up, this gives:

- **Oscar**: Houseago Properties Ltd, his own sole trader account plus his
  own Bank Statements, Investment & Dividend Returns and
  Employment/Payslips submission points, 33 North Denes / 6 Chaucer
  Street / 6a Chaucer Street (jointly managed with Sally) with each one's
  Compliance & Tenancy, Insurance and Income sections, 3 Horning Close in
  full (owned by Houseago Properties Ltd itself — Oscar is the Ltd's
  exclusive shareholder, so it's managed through his access), all of Iris's sections (her general finances
  plus her own three submission points — she doesn't log in herself, so
  Oscar and Sally manage these on her behalf), all three people's
  Receipts & Invoices, and Wild Thyme's Insurance and Income sections —
  all with upload rights.
- **Sally**: her own sole trader account plus her own three submission
  points, 33 North Denes / 6 Chaucer Street / 6a Chaucer Street (jointly
  managed with Oscar) with their Compliance & Tenancy, Insurance and
  Income sections, all of Iris's sections, all three people's Receipts &
  Invoices, Wild Thyme in full (her own property), and 3 Horning Close's
  Insurance and Income sections — all with upload rights.
- **Accountant**: the financial sections only — Houseago Properties Ltd,
  all three people's sole trader/finances accounts and their Bank
  Statements, Investment & Dividend Returns and Employment/Payslips
  submission points, all five properties' Documents and Income sections,
  and all three people's Receipts & Invoices — read and download only (no
  upload). The five Insurance sections and the five Compliance & Tenancy
  sections are left out entirely, so they don't appear for the accountant
  at all, not even to view — their view of each property's Documents card
  only ever pools the general Documents entity, never the Compliance &
  Tenancy or Insurance ones, so nothing from those two ever mixes in.

**A note on 3 Horning Close.** Unlike the other four properties, this one
is owned by Houseago Properties Ltd itself — Oscar is its exclusive
shareholder, so it's a company asset, not personal property the way Wild
Thyme is genuinely Sally's own. Day to day it's still managed through
portal access the same way: Sally only sees its Insurance and Income
sections (the same "sight of every property's insurance and income"
arrangement Oscar has for Wild Thyme), not its Documents or Compliance &
Tenancy, since she isn't a shareholder in the Ltd. If you'd rather she had
full access too, give her the same set of rows Oscar has for it
(`3-horning-close`, `3-horning-close-compliance-tenancy`,
`3-horning-close-insurance`, `3-horning-close-income`, all with upload
rights) instead.

Because 33 North Denes, 6 Chaucer Street, and 6a Chaucer Street, their
Compliance & Tenancy, Insurance and Income sections, and Iris Houseago
Finances are the same `entity_id` for both of you, documents either of
you uploads there show up for both — it's genuinely the same shared
section, not two copies. Insurance and Income work the same way even for
Wild Thyme and 3 Horning Close, each otherwise one of your own (or, for 3
Horning Close, the Ltd's) — you both have sight of every property's
insurance and income, just not each other's Documents/Compliance & Tenancy on the property that isn't jointly
owned. Each of your three Receipts & Invoices sections (yours, your
co-owner's, and Iris's) is also shared between you both, for the same
reason — you're not restricted to your own submissions anywhere you
haven't been given a `portal_access` row for.

If you ever add a new property, or want to change who can see or upload to
what, it's just more rows in `portal_access` — no code changes needed. You
can do this from the Table Editor instead of SQL if you prefer a
click-through interface.

## 7. Property pages and person pages

Each property and each person now has its own dedicated page rather than
everything sitting inline on the dashboard. This is purely a navigation
change — the underlying sections and access rules are exactly the same
`portal_access` rows as before.

**Properties.** Any entity that has a Compliance & Tenancy or Insurance
sibling is treated as having "full" access and gets its own standalone
page — nothing is hardcoded here either, so a new property is still just
rows in `supabase-schema.sql` or the Table Editor, per the note at the
end of section 6. There are five properties today: 33 North Denes, 6
Chaucer Street, 6a Chaucer Street, Wild Thyme, and 3 Horning Close. For
someone with full access, the dashboard shows a short card for each with
an "Open [property name]" button, linking to `property.html?id=<entity
id>`, where the page has exactly two sections, kept deliberately simple:

- **Income & Outgoings** (section 9), near the top of the page.
- **Documents**, below it — every document for the property in one
  list, whatever it is: general paperwork, a compliance certificate, an
  insurance policy. When you upload, you pick a "Type" (General,
  Compliance & Tenancy, or Insurance) from a dropdown, and that's what
  determines where it's actually filed — the certificate-status panel
  from section 10 still sits at the top of this card for anyone with
  Compliance & Tenancy access. Under the hood, Documents, Compliance &
  Tenancy, and Insurance are still three separate database entities with
  their own `portal_access` rows, exactly as before — only the on-page
  presentation is merged into one card. That's what lets someone be
  given the general Documents and Income & Outgoings but excluded from
  Compliance & Tenancy and Insurance entirely (the accountant, see
  section 6): they simply never get a "Type" choice or see those
  documents, because the merge only ever pools entities they actually
  have `portal_access` to.

**Partial access nests inside the owner's person page instead.** Someone
who only ever gets a property's base row and/or its `-income` row — never
Compliance & Tenancy or Insurance — is treated as having "partial" access
to that property. Rather than getting the property its own card and
page, that property's Documents and Income & Outgoings sections (in that
same order, Income & Outgoings first) appear nested inside the relevant
owner's `person.html` page — trivially just the two sections again, since
partial access never includes Compliance & Tenancy or Insurance to merge
in, so there's no "Type" dropdown to show there either. A small table in
`assets/auth.js` (`PROPERTY_OWNERS`, mirrored as `PROPERTIES_BY_PERSON`
in `assets/person.js`) says which person each property nests under:

- **3 Horning Close, 33 North Denes** → Oscar
- **33 North Denes, Wild Thyme** → Sally
- **6 Chaucer Street, 6a Chaucer Street** → Iris

This is how the accountant's dashboard works today: their `portal_access`
rows only ever give them a property's base/`-income` rows, never
Compliance & Tenancy or Insurance (see section 6), so every property
counts as partial access for them and none get their own card — the
accountant's dashboard shows just the Ltd company plus one card each for
Oscar, Sally, and Iris, and opening a person's card shows that person's
own Documents/submission-point sections plus (per the mapping above)
whichever properties nest under them, each with its own Income &
Outgoings and Documents sections, exactly as if they were on that
property's own page (just without a "Type" dropdown, since there's
nothing else to merge in for a partial-access viewer). If you ever give
the accountant (or anyone else) full access to
a property instead — by adding its Compliance & Tenancy or Insurance
row — it stops nesting and gets its own page/card for them immediately,
no code change needed. The mapping only matters for partial access; if a
property with partial access has no entry in it, it still gets a
fallback card of its own rather than silently disappearing.

**People.** Oscar, Sally, and Iris each get a page too
(`person.html?id=oscar` / `sally` / `iris`) bringing together their
General Documents, Bank Statements, Investment & Dividend Returns,
Employment (Payslips), and Receipts & Invoices sections, plus (per the
mapping above) any properties nested under them. Bank Statements is
labelled by UK tax year (6 April to 5 April, e.g. "2025/26") rather than
a plain calendar year, since that's how a person's own accounts are
actually organised; the other sections use plain years like everywhere
else. As with properties, whichever section a person's account (or
whoever manages it) has been given `portal_access` rows for is what shows
up — there's nothing to configure beyond the access rows themselves.

A flat section that isn't a property or a person — Houseago Properties
Ltd — stays exactly where it's always been, directly on the dashboard.

## 8. Uploading documents day to day

Once logged in, Oscar and Sally each see their relevant sections and can
upload straight from the dashboard — "Take a photo" or "Choose a file",
give it a name (and optionally a category, a year, and an expiry date),
and it's added immediately. Every upload form on the whole site works
this way now, not just Receipts & Invoices — the Ltd company, sole trader
accounts, and Iris's finances on the dashboard; a property's single
Documents form (which also lets you pick a Type, per section 7, when
more than one is available to you); a person's Bank Statements,
Investment & Dividend Returns, Employment (Payslips), and General
Documents; and a nested property's Documents inside a person's page — all
share the same capture-and-read behaviour described under "Take a photo,
or choose a file" below. Whatever's picked is converted to a PDF before
it's stored if it's a photo or other image, so every section's documents
stay one consistent format. Deleting a document you or your co-owner
uploaded works the same way, with a "Delete" link next to it.

**Labelling and archiving by year.** The optional Year field on each
upload form is just a label — it doesn't restrict who can see a document,
it only groups things so old paperwork doesn't clutter a section. Once a
section has documents labelled with two or more different years, a "Year"
dropdown appears above its document list (defaulting to "All years") so
you can filter down to just one year at a time — handy for pulling up
last year's accounts, or archiving old documents out of the way visually
without deleting them. Receipts & Invoices works the same way, except its
year is worked out automatically from the date you give each submission,
rather than a separate field to fill in.

The accountant sees the same sections (whichever ones you've given them
access to) with a "Download" button on each document, but no upload form —
they can't add or remove anything, only read.

**Receipts & Invoices works a little differently, and is per person.**
Each of Oscar, Sally, and Iris has their own Receipts & Invoices section
(`oscar-receipts-invoices` / `sally-receipts-invoices` /
`iris-receipts-invoices`), with a card on their own `person.html` page —
just a short description and an "Open Receipts & Invoices" button, rather
than a list of documents right there on the page. That button links to
`receipts.html?owner=oscar` (or `sally` / `iris`), which has a submit
form — Name, a receipt (photographed or picked as a file), Date, Amount,
Description, and a "Relates to" dropdown to optionally link the
submission to one of the core accounts/properties (or leave it as
"General / Other") — plus the full list of everything ever submitted
under that person, each with its date, amount, description, and link
shown, and a Download (and Delete, if you have upload rights) button.
Anyone with `portal_access` to a given person's Receipts & Invoices sees
every submission filed there, regardless of what it's linked to — the
link is just for organising, not for restricting who sees what. As
section 6 sets things up, Oscar and Sally see all three people's Receipts
& Invoices (their own, their co-owner's, and Iris's); the accountant sees
all three too, read-only.

**Take a photo, or choose a file.** Every upload form on the site — not
just Receipts & Invoices — has the same two buttons: "Take a photo" opens
your phone's camera directly; "Choose a file" picks an existing photo,
scan, or PDF instead. This shared capture widget lives in
`assets/doc-scan.js`, used by `assets/auth.js`, `assets/property.js`,
`assets/person.js`, and `assets/receipts.js` alike, so a change to how it
reads a file (or a bug fix) only needs making once.

As soon as a file's chosen, the page reads it in the background (from a
PDF's own text where there is one, or by scanning — OCR — the image or a
scanned PDF page otherwise) and tries to fill in whichever fields that
form actually has: Receipts & Invoices gets both a Date and an Amount;
every other upload form (a property's Documents form, Bank Statements,
and so on) only has a "Valid until" date field, so that's what gets
filled in there, most useful for the four tracked certificates in
section 10. Either way it's shown with a note asking you to check it's
right, and it never overwrites something you've already typed by hand. If
nothing can be found, it says so and leaves the field for you to fill in
yourself, same as before this existed. None of this blocks you from
submitting — it's purely a shortcut to typing things yourself, and it
runs entirely in your browser (via pdf.js, Tesseract.js and jsPDF, loaded
from a CDN), nothing is sent anywhere else to do it.

Receipts & Invoices additionally auto-crops a photographed receipt down
to just the printed content, with an "Use auto-cropped version" tickbox
to fall back to the untouched photo with one tap if the crop doesn't look
right. This is a plain contrast-based crop, not a full document scanner:
it works well for a receipt on a plain, contrasting surface (a desk, a
table), but won't straighten out a photo taken at a sharp angle — for
those, the untouched photo is often just as usable anyway. This crop step
is specific to Receipts & Invoices (`assets/receipts.js`); other upload
forms don't auto-crop, since a bank statement, certificate, or company
document is rarely photographed the way a small receipt is.

**Scanning a bank statement for rent** (see section 9) uses the same
underlying OCR/PDF-text engine, but instead of filling in one form it
looks for whole lines that mention "rent" alongside an amount. It's
available anywhere there's an Income & Outgoings section with upload
rights — a property's own page (`property.html`) for whoever has full
access, and a nested property inside a person's page (`person.html`) for
whoever only has partial access — so an accountant-style viewer with
upload rights to a nested property's Income section gets exactly the same
tool a full-access owner does.

**Everything is stored as a PDF.** Whether you photograph a receipt,
upload an existing photo, or add a document from the main dashboard, it's
converted into a single-page PDF before it's stored — so the whole
document store stays one consistent format regardless of what was
originally supplied. A file that's already a PDF is left as it is; a file
type that isn't a plain image and isn't already a PDF (for instance a
bank's own .docx or .xlsx statement) can't be converted this way and is
stored as originally supplied.

**Expenses by month, for a financial year.** Above the submissions list, a
bar chart breaks down everything submitted with an amount into the twelve
months of a UK financial year (6 April to 5 April) — pick the year from
the dropdown and it shows April through March for that year, with a
running total alongside it. It updates live as submissions are added or
removed, and only appears once there's at least one dated, priced
submission to show. Like the totals themselves, it's a quick running
picture of spend, not a replacement for your actual accounts.

**Export as Excel.** Next to the chart, an "Export as Excel" button
downloads a spreadsheet built from everything submitted with a date and
amount — not just a raw dump, but each financial year already worked
through: a Summary sheet with every year's total, submission count, and
month-by-month breakdown side by side, followed by one sheet per
financial year with its own monthly breakdown, a by-category breakdown,
and the full list of transactions for that year (date, name, category,
amount, description, what it's linked to), sorted and totalled. It's
meant to give you and your accountant a running start on forecasting, a
balance sheet, or the end-of-year accounts, rather than starting from a
blank sheet. The file's named with today's date, e.g.
`Houseago-Receipts-2026-09-13.xlsx`.

**Expense categories.** Each submission can optionally be given a
Category — Repairs & maintenance, Insurance, Letting & management fees,
Legal & professional fees, Ground rent & service charges, Mortgage / loan
interest, Utilities, Cleaning & gardening, or Other. It's a fixed list
rather than free text on purpose, and it's chosen to roughly match how a
UK property tax return groups expenses, so the breakdown is actually
useful at tax time rather than just tidy. A "By category" list appears
under the chart for whichever financial year is selected, and the same
breakdown is included per year in the Excel export. Leaving it
uncategorised is fine — those submissions still count in the totals,
just grouped together as "Uncategorised".

## 9. Income & Outgoings, and scanning bank statements for rent

Each property's page has an Income & Outgoings section, positioned near
the top of the page (section 7), that gives each property an actual net
figure rather than just an expense total.

**Outgoing figures come from Receipts & Invoices, automatically.**
Whatever's already been submitted there and linked to a property (the
"Relates to" dropdown, see section 8) counts as that property's outgoings
— nothing new to submit, this section just totals it up per year
alongside income.

**Income entries are simple records, not documents.** You can add one by
hand — a description, an amount, and a date — or let the page do a first
pass over an uploaded bank statement: choose a PDF or photo under "scan a
bank statement for rent payments", and it looks for lines mentioning
"rent" alongside an amount. Be clear-eyed about what this is: bank
statement formats vary hugely between banks, and this is plain keyword
and amount matching over whatever text can be pulled off the page (via
the same pdf.js/Tesseract OCR already used for receipts — see section
8), not a real bank-statement reader. Every line it finds is shown for
you to check, edit, or discard before anything is saved — nothing about
the statement itself is stored, only the income entries you choose to
add. A statement that's a scanned image with no text layer, or one where
nothing matches, just comes back with nothing found; you can always add
entries by hand instead.

Once there's at least one income entry or linked outgoing for a year, the
top of the Income & Outgoings section shows that year's Income, Outgoing,
and Net totals. The accountant sees this section too — Documents and
Income are the two things they have access to on every property, per
section 6, nested inside the owning person's page per section 7 — but
can't add entries or scan statements, same read-only rule as everywhere
else. The bank-statement scanning tool itself is available both on a
property's own page (`property.html`, for whoever has full access) and on
a nested property inside a person's page (`person.html`, for whoever has
upload rights to just its Income section) — the reading itself lives in
`assets/doc-scan.js`, shared by both, so there's no reduced experience
either way.

## 10. Compliance tracking

Each property still tracks four specific certificates/assessments under
its Compliance & Tenancy entity (merged into the Documents card on
screen, as described in section 7), chosen to match what the NRLA's own
compliance guidance lists as the core legal requirements for a rental
property:

- **Gas Safety Certificate (CP12)** — renews annually
- **Electrical Installation Condition Report (EICR)** — renews at least
  every 5 years
- **Energy Performance Certificate (EPC)** — valid for 10 years
- **Legionella Risk Assessment** — review at least every 2 years

A status panel at the top of the Documents card (for anyone with
Compliance & Tenancy access) shows all four at a glance: green ("Valid
until …") once a certificate's been uploaded with a date, amber ("Expires
in N days") once it's within 60 days of that date, red ("Expired …") once
it's passed, or grey ("Not on file yet") if nothing's been uploaded for
it at all. Anything else tagged Compliance & Tenancy — a tenancy
agreement, for instance — just appears
in the ordinary document list below, unaffected by any of this.

To make an upload count towards one of the four, anyone with Compliance &
Tenancy access sees an extra dropdown on the property's Documents form,
"Is this one of the tracked certificates?" — it appears once "Type:
Compliance & Tenancy" is selected. Pick the matching certificate and give
it a "Valid until" date, and the status panel picks it up immediately.
Leave it as "No — general document" (the default) for anything else.

This tracking is deliberately limited to these four. Other things NRLA's
own guidance lists — smoke/CO alarm checks, Right to Rent records, HMO
licensing — don't have a fixed renewal date in the same way and would
turn this into a much bigger compliance system than a small accounts
portal needs; they're still fine to store as ordinary documents in the
same section, just without a tracked status.

## 11. "Documents expiring soon" and Self Assessment reminders

Anything in the whole portal with a "Valid until" date — the four tracked
certificates above, an insurance policy, anything else you've given an
expiry date — is checked for what's due soon, alongside two fixed dates
that don't depend on anything being uploaded: Self Assessment's 31
January (balancing payment) and 31 July (payment on account) deadlines,
always showing the next upcoming occurrence of each. This all works in
two ways:

**On the dashboard.** A banner appears above your sections listing
everything that's expired/overdue or due within 60 days, soonest/most
overdue first, with a "Dismiss" button to clear it for that visit (it
comes back next time you load the dashboard if something's still due).
No setup needed — the Self Assessment dates work immediately, and
document dates show up as soon as documents with dates exist.

**By email, once a week.** A Supabase Edge Function
(`supabase/functions/expiry-digest`, included in this repo) checks the
same thing and emails a summary to whoever you configure, once a week —
skipping the email entirely on a week where nothing's due, so it's never
just noise. Setting this part up takes a bit more than the rest of this
guide, because — unlike everything else in this site — it needs a small
piece of code actually running on a schedule, which a static site can't
do by itself. Here's how:

1. **Install the Supabase CLI** on your computer, if you haven't already
   — see supabase.com/docs/guides/cli for your platform (on a Mac with
   Homebrew, `brew install supabase/tap/supabase`).
2. **Create a free Resend account** at resend.com — this is what actually
   sends the email. On the free plan you can send from Resend's own
   testing address to your own inbox immediately, but to send to more
   than one real recipient (Oscar and Sally) you'll need to verify a
   sending domain under Resend's Domains page — a few DNS records added
   at wherever your domain's registered, same idea as any "verify your
   domain" step, and Resend's own instructions walk through it. If you'd
   rather not deal with domain verification yet, you can leave this until
   later and use the in-app banner alone in the meantime.
3. **From a terminal, in this project's folder:**
   ```
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase functions deploy expiry-digest
   ```
   Your project ref is in the Supabase dashboard's URL, or under Settings
   -> General.
4. **Set the function's secrets** (these are stored by Supabase, never in
   this repo or on GitHub):
   ```
   supabase secrets set RESEND_API_KEY=re_your_key_here
   supabase secrets set REMINDER_RECIPIENTS=oscar@example.com,sally@example.com
   supabase secrets set REMINDER_FROM_EMAIL="Houseago Asset Management <reminders@yourdomain.com>"
   ```
   (`REMINDER_FROM_EMAIL` is optional — leaving it out sends from Resend's
   own testing address, which only reaches your own verified inbox, not
   real recipients.)
5. **Schedule it to run weekly.** Open `supabase/functions/expiry-digest/schedule.sql`
   (also included in this repo), fill in your project ref and anon key
   where marked, and run it once in the SQL Editor. It runs every Monday
   morning from then on. The file has notes on checking it ran and
   changing the schedule.
6. **Test it once manually** before waiting for Monday — Function Details
   -> Invoke, in the Supabase dashboard, or:
   ```
   curl -X POST https://YOUR-PROJECT-REF.functions.supabase.co/expiry-digest \
     -H "Authorization: Bearer YOUR-ANON-KEY"
   ```
   It replies with what it found and whether it sent anything — handy for
   confirming the whole chain works without waiting a week.

This function uses the Supabase "service_role" key — the one this whole
project otherwise avoids everywhere else. That's expected and safe here:
this code runs only on Supabase's own servers (never in anyone's
browser), Supabase injects that key into it automatically, and it never
appears in this repo, on GitHub, or anywhere a browser could read it. The
website itself — everything in `assets/` — still only ever uses the
public anon key, unchanged.

## 12. Installing it as an app

Once it's live on its real URL (not just opened as a local file), the site
can be installed like an app on a phone, tablet, or computer — its own icon
on the home screen or dock, opening full-screen with no browser address bar,
and loading instantly because it keeps its own pages, styles, and scripts
cached on the device.

- **iPhone/iPad (Safari):** open the site, tap the Share icon, then "Add to
  Home Screen".
- **Android (Chrome):** open the site, tap the three-dot menu, then "Install
  app" (or "Add to Home screen").
- **Mac/Windows/Chromebook (Chrome or Edge):** open the site, click the
  install icon at the right of the address bar (or the three-dot menu ->
  "Install Houseago Asset Management…").

Nothing extra needs setting up for this — it's already built in
(`manifest.webmanifest` and `sw.js`, both already in the repo). It only
caches the site's own pages, styles and scripts, never your documents or
login — those still always come fresh from Supabase — so installing it is
just a shortcut, not a separate copy of your data. If you ever update the
site's files, the next time it's opened it quietly fetches the new version
in the background and uses it from then on.

## 13. Two-factor authentication (optional, but recommended)

Each account (Oscar, Sally, the accountant) can turn on two-factor
authentication for themselves — a 6-digit code from an authenticator app,
required alongside their password every time they log in. **Microsoft
Authenticator works for this** — so does Google Authenticator, Authy,
1Password, and any other authenticator app, since they all speak the same
standard (TOTP) and this doesn't care which one you use; it's Supabase
Auth's own built-in MFA support underneath, not anything Microsoft- or
Google-specific. Nothing needs setting up in Supabase for this to be
available — it's already active as soon as your project exists — but
running `supabase-schema.sql` (or just the "Two-factor authentication"
section of it, if you're adding this to a site you already set up) does
add the enforcement described below, so it's worth re-running that file if
you set this site up before this section existed.

**Turning it on.** From the dashboard, click "Security" in the header
(also reachable from a property, person, or Receipts &amp; Invoices page)
to get to `security.html`. Click "Set up two-factor authentication" and
it shows a QR code — scan it with your authenticator app, which then
starts showing a fresh 6-digit code every 30 seconds — enter the current
code back into the page to confirm it's working, and it's on. If scanning
isn't convenient, the same page shows a "setup key" to type into the app
by hand instead. From then on, logging in asks for a code from that app
straight after the password, on every device, every time.

**Using Microsoft Authenticator specifically:** open the app, tap the "+"
to add an account, choose "Other account" (not "Work or school account" —
that option is for signing into a Microsoft/Office 365 account itself,
which is a different thing to this site's own login), then scan the QR
code shown on `security.html`. It'll then show alongside your other
accounts in the app.

**Turning it off.** Same page, "Turn off two-factor authentication" — one
click, no code needed (if you'd rather it required re-entering a code
first, that's a small change to `security.js`, not something built in
today, since for a three-person family portal the extra friction didn't
seem worth it by default).

**This is enforced by the database, not just the login page.** A browser
could in principle be told to skip the login page's own code-entry step,
so the real enforcement lives in `supabase-schema.sql` (see "5. Two-factor
authentication (TOTP) enforcement") — once an account has a verified
authenticator app, the database itself refuses to hand back that account's
`portal_access` rows, documents, or files unless the current session has
actually completed a code challenge (Supabase calls this reaching "aal2",
as opposed to the password-only "aal1"). An account that's never turned
2FA on is completely unaffected by this — it only ever tightens things for
an account that opted in, and it's automatic per account, nothing to
configure per person.

**Losing access to the authenticator app.** There's no backup-code or
SMS fallback built in — if someone loses the device their app was on,
turning their 2FA back off has to be done for them: in the Supabase
dashboard, go to Authentication -> Users, open their account, and remove
their MFA factor from there (or, with the service_role key, call
`supabase.auth.admin.mfa.deleteFactor(...)` — see Supabase's MFA docs).
They can then log in with just their password and set 2FA up again
themselves from `security.html`.

## Notes

- The website itself (everything in `assets/`, loaded in a browser) never
  uses the Supabase "service_role" key — only the public "anon" key, the
  same as the tenant portal. What makes an account see a given section is
  being listed in `portal_access`, enforced by the database itself, not
  by anything being hidden in this code. The one exception is the
  `expiry-digest` Edge Function (section 11) — server-side code that never
  runs in a browser, where using that key is the correct, standard
  pattern, not a departure from this rule.
- If you want a fourth person with access later (a bookkeeper, a second
  accountant), just add their account the same way and give them
  `portal_access` rows for whichever sections they should see.
- **Tax year pack.** Every property and person page has a "Tax year pack"
  card at the top: pick a year and it downloads a single zip of every
  document filed anywhere on that page labelled with that year, ready to
  hand to your accountant. On person.html, remember Bank Statements uses
  a tax year label (e.g. "2025/26") while the other three sections use a
  plain calendar year — pick both labels if you want a complete tax year
  including statements. This and the bank-statement scan in section 9
  both use a small library (JSZip) loaded from the same CDN as everything
  else in this site, so both need the site to be online, same as always.
