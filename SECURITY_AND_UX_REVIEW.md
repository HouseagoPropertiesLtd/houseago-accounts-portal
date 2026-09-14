# Houseago Asset Management — security & layout review

A full pass over the site: a hacker's-eye stress test of the front end and
back end, plus a check that the layout and navigation are as simple and
logical as they can be. Written after renaming the site from "Houseago
Family Accounts" to "Houseago Asset Management."

Three buckets below: **fixed now** (code changes already made and
re-tested), **recommended, needs a few minutes in the Supabase dashboard**
(not code — settings only you can change, since they need your project
access), and **accepted limitation** (understood and mitigated as far as
is practical, but not fully closable given the hosting platform).

## 1. What was fixed

### 1.1 `entities` table wasn't covered by the 2FA requirement

Once an account turns two-factor on, the database is supposed to refuse to
hand back anything until that session has completed a code challenge — not
just documents, but the account's own access rows. The restrictive
`mfa_ok()` policy from the 2FA work had been added to `portal_access`,
`entity_documents`, and Storage, but not to `entities` itself. That meant a
session stuck at password-only (aal1) could still read the full list of
property and person names — not documents, just names — regardless of
whether 2FA was meant to be blocking it.

**Fixed**: added the same restrictive `mfa_ok()` policy to `public.entities`
in `supabase-schema.sql`. Re-run the updated schema file's section 5 in the
Supabase SQL editor to apply this (safe to re-run — `create policy` will
just fail harmlessly if it's already there, or you can drop and re-create
the "Require completed 2FA once enrolled" policy on `entities` if needed).

### 1.2 Receipts & Invoices "Relates to" link had no access check

On the Receipts & Invoices page, a submission can optionally be tagged as
relating to a property or account (the "Relates to" dropdown). The insert
policy checked that you had upload rights on the receipts entity itself,
but never checked whether you had *any* access at all to the entity you
were linking it to. That meant someone could tag a receipt against a
property they have zero access to — not a document leak on its own (they
still couldn't read that property's own documents), but it would plant a
stray entry that shows up in that property's Income & Outgoings totals for
whoever *does* have access, and it let someone probe for whether a given
entity id exists at all.

**Fixed**: the insert policy on `entity_documents` now also requires a
`portal_access` row (any row — just visibility, not upload rights) on
`related_entity_id` before allowing the link. See `supabase-schema.sql`
section 3 for the updated policy and its comment.

### 1.3 QR code image was silently broken

Found while reviewing screenshots, not by a test: the two-factor
authenticator-app QR code on the security page rendered as a blank box with
stray text next to it. The QR code is a data-URI SVG string inserted into
an `<img src="...">` attribute; the string contains literal `"` characters
(from `xmlns="..."` inside the SVG), which broke out of the attribute and
corrupted the markup. The existing HTML-escaping helper only escaped
`&`/`<`/`>` — safe for ordinary text content, but not sufficient inside an
attribute value.

**Fixed**: added a second escaping helper (`escapeAttr`) that also escapes
quote characters, and used it for the QR image's `src`. This is a real bug
that would have affected every real enrolment, not just the test — worth
noting since it shipped once already and only surfaced visually.

### 1.4 Sample-preview mode threw a JavaScript error and silently failed

Running the login page and dashboard without a configured Supabase project
(the state the site is in before `assets/supabase-config.js` is filled in —
also what a first-time visitor or anyone testing the site sees) threw an
uncaught error: `receiptsCardHtml is not defined`. That function is called
but was never defined anywhere in the codebase — leftover from an earlier,
incomplete edit. Because the error was thrown partway through building the
sample dashboard's HTML, the whole render aborted: the entity cards never
got written to the page, and their click handlers (which show the "this is
a sample preview" message) never got attached either. In effect, the
sample-preview dashboard was silently broken.

**Fixed**: removed the broken call and its now-orphaned leftover code (a
click handler wired to a link that could never have existed). The sample
preview now renders cleanly and matches what real data actually looks
like. Caught by the regression suite's `production-sample-test.js`, which
loads the real HTML files directly rather than a mock.

### 1.5 Two-factor "Turn off" button didn't require a fresh code

This is the most significant finding of the review. Supabase's MFA
management calls (`listFactors`, `unenroll`, and friends) are handled by
the Auth service directly — they are **not** Postgres table operations, so
none of the row-level-security policies above can reach them. By design,
Supabase allows these calls at aal1 (password-only). That means, before
this fix, anyone who obtained just your password — a phished credential, a
reused password from another breach, a saved-password grab from a
compromised device — could open the security page and switch two-factor
off entirely, with nothing else required. It would look, from the account
owner's side, like 2FA had simply stopped working.

This can't be fixed at the database level, because the unenroll call never
touches the database. The mitigation has to live in the page itself.

**Mitigated**: the "Turn off two-factor authentication" button is now only
shown when the *current session* has itself completed a fresh code
challenge this login (Supabase reports this as the session's assurance
level, "aal2"). A session that's only ever done password-only login — even
on an account that has 2FA turned on — sees an explanation instead: "To
turn this off, log out and log back in with a code from your authenticator
app first — then come back here." A password-only compromise can no longer
silently strip your protection; the attacker would additionally need your
authenticator app.

**Be aware this is a UI-level control, not an unbreakable one.** Someone
with your password and comfortable using browser developer tools could
still call `unenroll()` directly through the Supabase JS SDK, bypassing the
page entirely — the button being hidden stops casual/UI-level abuse, not a
technically determined attacker. There is no way to close this gap
completely without Supabase adding server-side aal2 enforcement to its own
MFA-management endpoints, which is outside this site's control. Practical
compensating measures: keep your password unique to this site (a password
manager makes this easy) and treat any suspicious "your 2FA looks like it
turned off" moment as a signal your password may be compromised, not just
a glitch.

Covered by a new Playwright test (`security-page-test.js`): a
session with an already-verified factor that hasn't completed an aal2
challenge this session must not show the turn-off button, and must show
the explanatory message instead.

### 1.6 Clickjacking — added a JavaScript mitigation

GitHub Pages serves static files with no way to set custom HTTP response
headers, which rules out the standard fix for clickjacking
(`X-Frame-Options` or a `Content-Security-Policy: frame-ancestors`
directive telling browsers to refuse to render the page inside someone
else's `<iframe>`). Without either, in principle another site could embed
this portal in an invisible iframe and trick someone into clicking through
it, potentially triggering an action on their behalf while they think
they're clicking something else.

**Mitigated**: every page now carries a small inline script, as the very
first thing in `<head>`, that detects whether it's been loaded inside a
frame and — if so — immediately navigates the top-level page to itself
(breaking out of the frame) and hides the page's content in the meantime.
This is a reasonable defence-in-depth measure but not bulletproof: a
frame with `sandbox="allow-scripts"` and no `allow-top-navigation` can
suppress the redirect attempt. See the recommendation below for the real
fix.

**Recommended real fix (not code — a hosting change)**: put the domain
behind a reverse proxy that can set real HTTP headers — Cloudflare's free
tier is the standard choice for a GitHub Pages site, and it would let you
set `X-Frame-Options: DENY` (or a CSP frame-ancestors directive) properly,
closing this gap completely rather than best-effort. Not required — the
JS mitigation covers the common case — but worth doing if you want this
fully closed rather than mostly closed.

## 2. Recommended — a few minutes in the Supabase dashboard

These aren't code changes; they're project settings only you can turn on,
since they need access to your Supabase dashboard.

- **Leaked-password protection** (Authentication → Policies, or
  Authentication → Providers → Email, depending on your dashboard
  version): Supabase can check a password against the HaveIBeenPwned
  breached-password list at signup/password-change time and refuse known-
  compromised ones. Since accounts here are created directly by you rather
  than self-signup, this mainly matters if/when a password is ever changed
  — worth turning on regardless, no downside.
- **Storage upload limits** (Storage → owner-documents → bucket settings):
  the site's own upload form doesn't enforce a maximum file size or a
  strict file-type allow-list client-side — the `accept="application/pdf,
  image/*"` attribute on the file picker is just a suggestion to the
  browser's file dialog, not a real restriction (anyone can still attach
  any file type via drag-and-drop or by renaming a file). Setting a
  max file size and allowed MIME types on the bucket itself is what
  actually enforces this. A sensible starting point: 25MB max, PDF and
  common image types only.
- **Session/JWT expiry** (Authentication → Sessions): worth checking the
  default expiry is something you're comfortable with for documents this
  sensitive — shorter is safer but means logging in more often. This is a
  judgement call, not a fixed recommendation either way.
- **Rate limiting on auth attempts**: Supabase applies its own default
  rate limits to login/verify attempts, which is reasonable protection
  against brute-forcing a password or a 2FA code as-is — nothing to change
  here, just worth knowing it's already on by default rather than
  something this site's own code provides.

## 3. Accepted limitations (understood, not fully closable)

- **No custom HTTP security headers on GitHub Pages** — covered above
  (clickjacking). The JS mitigation is a reasonable stand-in; a proxy like
  Cloudflare is the complete fix, if you want it.
- **MFA unenroll is reachable at aal1 via the Supabase SDK directly** —
  covered above (1.5). Mitigated in the UI; not closable from this side of
  the fence at all.
- **The anon key is public by design.** This is not a bug — it's how
  Supabase's client-side model works, and it's why every table has row-
  level security switched on rather than relying on the key itself for
  protection. Confirmed clean: no `service_role` (secret) key appears
  anywhere in the site's own client-shipped files. The one place
  `service_role` is used at all — the `expiry-digest` email-reminder
  function — runs entirely on Supabase's servers as an Edge Function, never
  shipped to a browser, which is the correct and only place that key
  should ever live.
- **No self-signup or password-reset flow is exposed on the site** — this
  is a deliberate strength worth naming, not a gap: accounts are
  provisioned by you directly in the Supabase dashboard, so there's no
  public "create account" or "forgot password" surface for an attacker to
  probe at all.

## 4. Layout & navigation review

The site's information architecture, checked end to end:

**Login → Dashboard → (Property or Person page) → Documents**, with
Receipts & Invoices reachable from a person's own page, and Account &
Security reachable from the header on every page. That's a consistent
three-or-four-click depth to any document from login, which is about as
flat as a structure like this can reasonably get — there wasn't a case
found where a document needed more clicks than the shape of the data
actually requires (e.g. a property's own Insurance section genuinely is
one level under that property, not an accident of navigation design).

The two-upload-point simplification done earlier in this project (merging
what used to be several separate sections per property — Documents,
Compliance & Tenancy, Insurance — into a single "Documents" card with a
Type dropdown, alongside one Income & Outgoings section) is the single
biggest thing already done for simplicity, and it's still the right call:
fewer sections to scan, one place to look for "everything about this
property," one upload form instead of three.

A few smaller observations, in order of how much they'd actually help:

- **The dashboard is the one page most people will land on most often**,
  and it used to list every entity a user has access to as one flat set of
  cards. For Oscar/Sally, who have access to a lot of entities, this was a
  long scroll. **Now done**: cards are grouped under "Company,"
  "Properties," and "People" headings, each with a subtle divider, in that
  fixed order — the order of cards within each group still follows
  `sort_order`, exactly as before, and access rules haven't changed at
  all. A group with nothing in it is skipped, and if everything a given
  user sees falls into just one group, no heading shows at all. Covered by
  a new assertion in `dashboard-test.js` checking the group labels appear
  in the right order.
- **The header brand link ("Houseago") is the only way back to the
  dashboard from most pages that isn't an explicit "Back to dashboard"
  button** — worth double-checking on a phone-width screen that it's
  obviously tappable, since it's the de facto "home" affordance. This
  wasn't found to be broken, just worth a quick look given it's a small
  target.
- **Compliance status and expiry warnings** (gas safety, EICR, EPC,
  legionella) live on the dashboard as a banner and drive real urgency —
  their placement above the entity cards is correct and shouldn't move;
  flagging only because it's the one piece of the layout where getting the
  position right actually matters for someone noticing an expiring
  certificate in time.

Nothing found suggests the underlying structure is illogical — it maps
cleanly onto how the properties and people are actually organised, and the
earlier documents-consolidation work already did most of the simplification
that was available. The suggestions above are refinements, not fixes.

## 5. Testing

All of the above was verified with the project's existing Playwright
regression-test discipline — mocked Supabase clients, driven headlessly,
asserting on rendered DOM state and console/page errors — rather than
assumed correct:

- A new test scenario (in `security-page-test.js`) exercises the aal1 vs
  aal2 gating on the "Turn off two-factor authentication" button directly.
- The sample-preview crash (1.4) was caught by `production-sample-test.js`,
  which loads the real site files rather than a mock — a reminder that a
  mock-only test suite can miss a real production bug if nothing in the
  suite ever loads the actual HTML/JS as shipped.
- The full existing regression suite (dashboard, property/person pages,
  receipts, compliance status, expiry digests, MFA login, self-assessment
  banners, and more) was re-run after every change in this review and
  passes cleanly.

`sw.js`'s cache version was bumped so every visitor picks up these changes
on next load rather than serving a stale cached copy.
