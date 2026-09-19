// Login and document access for the Houseago Asset Management, backed by
// Supabase. Falls back to a sample preview until assets/supabase-config.js
// has real values in it, so the site never breaks mid-setup (see SETUP.md).
//
// Access model: every signed-in user (Oscar, Sally, the accountant) is
// granted access to one or more "entities" — the Ltd company, a sole
// trader account, a property, or one of a property's/person's own
// sub-sections — via rows in the portal_access table, each with its own
// can_upload flag. A user only ever sees the entities they've been given a
// row for, and can only upload into ones where can_upload is true. This is
// enforced by the database (row level security), not by this file.
//
// This file (the dashboard) only lists things directly. A property someone
// can see the Compliance & Tenancy or Insurance section of becomes a link
// to property.html?id=<id> instead — see assets/property.js. A person's
// finances entity (see PEOPLE below) becomes a link to person.html?id=<key>
// instead — see assets/person.js, which also groups in that person's own
// Receipts & Invoices, and any property someone can only see the Documents
// and/or Income of (see PROPERTY_OWNERS below). Everything else still
// renders right here as a flat card (the Ltd company, and similar).

(function () {
  var keysConfigured =
    typeof SUPABASE_URL !== 'undefined' &&
    typeof SUPABASE_ANON_KEY !== 'undefined' &&
    SUPABASE_URL.indexOf('YOUR_SUPABASE') !== 0;

  var libraryLoaded = typeof supabase !== 'undefined';

  var client = (keysConfigured && libraryLoaded)
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  window.__houseagoAccounts = client;

  // Oscar, Sally, and Iris each get a person page (person.html?id=<key>)
  // bundling their general documents with three fixed submission points
  // (see PERSON_SUFFIXES) — their existing "finances" entity's own id isn't
  // uniform enough to derive the others from, hence this small fixed table.
  var PEOPLE = [
    { key: 'oscar', label: 'Oscar', baseEntityId: 'oscar-sole-trader' },
    { key: 'sally', label: 'Sally', baseEntityId: 'sally-sole-trader' },
    { key: 'iris', label: 'Iris', baseEntityId: 'iris-houseago-finances' }
  ];

  // Which person a property is grouped under when someone can't see its
  // Compliance & Tenancy or Insurance (only its Documents and/or Income) —
  // the accountant today, but this is a property of the property, not of
  // any one role: whoever has that shape of access sees it nested inside
  // that person's page (person.html) instead of as its own card here.
  // Someone with full access (Oscar, Sally) always gets the property's own
  // page regardless of this table. A property can list more than one
  // person (33 North Denes is jointly Oscar and Sally's).
  //
  // 3 Horning Close isn't listed here — it's owned by Houseago Properties
  // Ltd, not any one person, and has no Documents/Income access of its own
  // any more (see COMPANY_OWNED_PROPERTY_IDS below), so it never nests
  // under a person; it nests under the Ltd company's own page instead —
  // see NESTED_COMPLIANCE_PROPERTIES_BY_COMPANY in assets/property.js.
  var PROPERTY_OWNERS = {
    '33-north-denes': ['oscar', 'sally'],
    'wild-thyme': ['sally'],
    '6-chaucer-street': ['iris'],
    '6a-chaucer-street': ['iris']
  };

  var DOC_ICONS = {
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>',
    receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/>',
    bank: '<line x1="3" y1="21" x2="21" y2="21"/><line x1="5" y1="21" x2="5" y2="10"/><line x1="19" y1="21" x2="19" y2="10"/><polygon points="12 2 21 8 3 8"/><line x1="9" y1="21" x2="9" y2="10"/><line x1="15" y1="21" x2="15" y2="10"/>',
    shieldCheck: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
    percent: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>'
  };

  function docIconSvg(label) {
    var s = (label || '').toLowerCase();
    var path = DOC_ICONS.file;
    if (/invoice|receipt/.test(s)) path = DOC_ICONS.receipt;
    if (/statement|bank/.test(s)) path = DOC_ICONS.bank;
    if (/insurance|certificate|cert/.test(s)) path = DOC_ICONS.shieldCheck;
    if (/tax|return/.test(s)) path = DOC_ICONS.percent;
    return '<svg viewBox="0 0 24 24">' + path + '</svg>';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  // Only needed for the QR-code data: URI in the forced-enrollment step
  // below — see the matching helper in security.js for why quotes need
  // escaping there too.
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // Kept here (rather than moved wholesale to property.js) purely so the
  // dashboard-wide "expiring soon" banner below can show a friendly label
  // for a compliance-tagged document, wherever it was uploaded. The status
  // panel itself (green/amber/red/grey per certificate) lives on
  // property.html now, with its own copy of this list.
  var COMPLIANCE_TYPES = [
    { id: 'gas_safety', label: 'Gas Safety Certificate (CP12)' },
    { id: 'eicr', label: 'Electrical Installation Condition Report (EICR)' },
    { id: 'epc', label: 'Energy Performance Certificate (EPC)' },
    { id: 'legionella', label: 'Legionella Risk Assessment' },
    { id: 'deposit_certificate', label: 'Deposit Protection Certificate' },
    { id: 'deposit_prescribed_info', label: 'Deposit — Prescribed Information' },
    { id: 'inventory', label: 'Inventory / Schedule of Condition' }
  ];
  var EXPIRING_SOON_DAYS = 60; // matches the CP12 early-renewal window, so a due gas cert always shows amber first

  function complianceTypeLabel(id) {
    var match = COMPLIANCE_TYPES.filter(function (t) { return t.id === id; })[0];
    return match ? match.label : null;
  }

  function daysUntil(dateStr) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var target = new Date(dateStr + 'T00:00:00');
    return Math.round((target - today) / 86400000);
  }

  function firstNameFor(user) {
    var meta = (user && user.user_metadata) || {};
    var name = meta.first_name || meta.given_name || meta.full_name || meta.name;
    if (name) return String(name).trim().split(/\s+/)[0];
    var local = ((user && user.email) || '').split('@')[0];
    local = local.split(/[.\-_+0-9]/).filter(Boolean)[0] || local;
    if (!local) return 'there';
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var loginForm = document.getElementById('portal-login-form');
    var entitiesContainer = document.getElementById('entities-container');
    var expiringBanner = document.getElementById('expiring-soon-banner');

    // ---- Configured, but the Supabase library itself failed to load ----
    if (keysConfigured && !libraryLoaded) {
      if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var errorBox = document.getElementById('portal-error');
          if (errorBox) {
            errorBox.textContent = 'The portal could not load just now. Please refresh the page and try again in a moment.';
            errorBox.hidden = false;
          }
        });
      }
      if (entitiesContainer) {
        entitiesContainer.innerHTML = '<div class="entity-card"><p>The portal could not load just now. Please refresh the page and try again in a moment.</p></div>';
      }
      return;
    }

    // ---- Not configured yet: sample preview ----
    if (!client) {
      var setupNote = document.getElementById('portal-setup-note');
      if (setupNote) setupNote.hidden = false;

      if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
          e.preventDefault();
          window.location.href = 'asset-overview.html';
        });
      }

      if (entitiesContainer) {
        var sampleEntities = [
          { name: 'Houseago Properties Ltd', canUpload: true, docs: [['Corporation Tax Return 2025/26', 'Filed · PDF'], ['Company Accounts 2025', 'Filed with Companies House · PDF']] }
        ];
        var sampleHtml = sampleEntities.map(function (ent) {
          var rows = ent.docs.map(function (row) {
            return '<div class="doc-row"><div class="doc-row-main"><div class="doc-icon">' + docIconSvg(row[0]) + '</div><div><div class="doc-name">' + row[0] + '</div><div class="doc-meta">' + row[1] + '</div></div></div><a href="#" class="btn btn-outline">Download</a></div>';
          }).join('');
          return '<div class="entity-card"><div class="section-head left"><h2>' + ent.name + '</h2></div><div class="doc-list">' + rows + '</div></div>';
        }).join('');
        sampleHtml +=
          '<div class="entity-card"><div class="section-head left"><h2>33 North Denes</h2></div>' +
          '<p>Documents, Compliance &amp; Tenancy, and Insurance for this property, all in one place.</p>' +
          '<a href="#" class="btn btn-primary">Open 33 North Denes</a></div>' +
          '<div class="entity-card"><div class="section-head left"><h2>Oscar</h2></div>' +
          '<p>General documents, tax year bank statements, investment &amp; dividend returns, and employment/payslips, all in one place.</p>' +
          '<a href="#" class="btn btn-primary">Open Oscar</a></div>';
        entitiesContainer.innerHTML = sampleHtml;

        entitiesContainer.querySelectorAll('a[href="#"], .doc-row a').forEach(function (link) {
          link.addEventListener('click', function (e) {
            e.preventDefault();
            alert('This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).');
          });
        });
      }
      return;
    }

    // ---- Login page ----
    // Two-factor authentication (TOTP, via Supabase's built-in MFA) is
    // compulsory for every account. A password alone gets a session at
    // "aal1" (assurance level 1); an account with a verified authenticator
    // app enrolled gets a "next level" of aal2, and that second step — a
    // 6-digit code — is required immediately, right here, before treating
    // the person as actually logged in. An account with NO factor enrolled
    // yet is walked straight into setting one up, also right here, rather
    // than being allowed to reach the dashboard first — see showEnrollStep
    // below. Nothing here is enforced client-side only: the database
    // itself now refuses to hand back rows (portal_access,
    // entity_documents, Storage) for any account/session that hasn't
    // actually completed a 2FA challenge — see the "Two-factor
    // authentication" section of supabase-schema.sql — so neither step can
    // be skipped by going straight to dashboard.html either (dashboard.js,
    // property.js and person.js all check this the same way on load and
    // bounce back here if it isn't satisfied yet).
    if (loginForm) {
      var errorBox = document.getElementById('portal-error');
      var mfaForm = document.getElementById('portal-mfa-form');
      var mfaErrorBox = document.getElementById('portal-mfa-error');
      var mfaCancelLink = document.getElementById('portal-mfa-cancel');
      var loginFoot = document.getElementById('portal-login-foot');
      var mfaFoot = document.getElementById('portal-mfa-foot');
      var forgotOpenWrap = document.getElementById('portal-forgot-open-wrap');
      var forgotOpenLink = document.getElementById('portal-forgot-open');
      var forgotForm = document.getElementById('portal-forgot-form');
      var forgotFoot = document.getElementById('portal-forgot-foot');
      var forgotCancelLink = document.getElementById('portal-forgot-cancel');
      var forgotError = document.getElementById('portal-forgot-error');
      var forgotSuccess = document.getElementById('portal-forgot-success');
      var enrollWrap = document.getElementById('portal-enroll-wrap');
      var enrollCard = document.getElementById('portal-enroll-card');
      var enrollFoot = document.getElementById('portal-enroll-foot');
      var enrollCancelLink = document.getElementById('portal-enroll-cancel');

      function hideAllSteps() {
        loginForm.hidden = true;
        if (loginFoot) loginFoot.hidden = true;
        if (forgotOpenWrap) forgotOpenWrap.hidden = true;
        if (forgotForm) forgotForm.hidden = true;
        if (forgotFoot) forgotFoot.hidden = true;
        if (mfaForm) mfaForm.hidden = true;
        if (mfaFoot) mfaFoot.hidden = true;
        if (enrollWrap) enrollWrap.hidden = true;
        if (enrollFoot) enrollFoot.hidden = true;
      }

      function showMfaStep() {
        hideAllSteps();
        if (mfaForm) mfaForm.hidden = false;
        if (mfaFoot) mfaFoot.hidden = false;
        if (mfaForm) {
          var codeInput = mfaForm.querySelector('#portal-mfa-code');
          if (codeInput) codeInput.focus();
        }
      }

      // A never-enrolled account doesn't get to see the dashboard at all —
      // 2FA is compulsory, so this starts setup immediately, inline, right
      // after the password step succeeds (or on any later visit while
      // still signed in and still unenrolled). Mirrors security.js's own
      // enrollment UI (renderEnrolling), just reached from the login page
      // instead of the account-management page.
      function showEnrollStep() {
        hideAllSteps();
        if (enrollWrap) enrollWrap.hidden = false;
        if (enrollFoot) enrollFoot.hidden = false;
        if (enrollCard) enrollCard.innerHTML = '<p>Setting up&hellip;</p>';
        // Clear out any abandoned, never-confirmed enrollment first —
        // Supabase only allows one unverified TOTP factor (and one of a
        // given friendly name) on an account at a time, so a setup
        // attempt that was never finished (browser closed mid-scan, a
        // refresh, whatever) would otherwise silently block every future
        // attempt with no way back in short of a manual fix in Supabase.
        // Same cleanup security.js already does before showing its own
        // "off" state.
        client.auth.mfa.listFactors().then(function (listResult) {
          // listFactors()'s own grouped .totp array has proven unreliable
          // here — it can come back empty even when .all correctly lists
          // an unverified TOTP factor (confirmed by hand during testing:
          // same account, same moment, .totp === [] and .all === [that
          // factor]) — so this reads the type/status off .all directly
          // rather than trusting the pre-grouped array. Same fix applied
          // everywhere else in the codebase that was doing this cleanup.
          var allFactors = (listResult.data && listResult.data.all) || [];
          var unverified = allFactors.filter(function (f) { return f.factor_type === 'totp' && f.status !== 'verified'; });
          Promise.all(unverified.map(function (f) { return client.auth.mfa.unenroll({ factorId: f.id }); }))
            .then(function () {
              client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' }).then(function (result) {
                if (result.error || !result.data) {
                  if (enrollCard) enrollCard.innerHTML = '<p>Could not start setup just now. Please refresh the page and try again.</p>';
                  return;
                }
                renderEnrollCard(result.data);
              });
            });
        });
      }

      function renderEnrollCard(factor) {
        if (!enrollCard) return;
        var qr = (factor.totp && factor.totp.qr_code) || '';
        var secret = (factor.totp && factor.totp.secret) || '';
        enrollCard.innerHTML =
          '<p>Scan this QR code with an authenticator app &mdash; Microsoft Authenticator, Google Authenticator, Authy, 1Password, and similar all work, since this uses the same standard (TOTP) every one of them supports. In Microsoft Authenticator: tap the &ldquo;+&rdquo; to add an account, then &ldquo;Other account&rdquo; (not &ldquo;Work or school account&rdquo;), then scan. Or enter the setup key by hand below if you can’t scan it.</p>' +
          '<div class="mfa-qr-wrap">' +
            (qr ? '<img src="' + escapeAttr(qr) + '" alt="QR code for two-factor authentication setup">' : '') +
            '<div class="mfa-secret"><strong>Setup key</strong><br><code>' + escapeHtml(secret) + '</code></div>' +
          '</div>' +
          '<div>' +
            '<label for="portal-enroll-code">Enter the 6-digit code your app shows now, to confirm it’s working</label>' +
            '<input type="text" id="portal-enroll-code" class="mfa-code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="123456">' +
          '</div>' +
          '<div style="display:flex; gap:12px; margin-top:14px;">' +
            '<button type="button" class="btn btn-primary" id="portal-enroll-confirm">Verify and continue</button>' +
          '</div>' +
          '<p class="form-status" role="status" id="portal-enroll-status"></p>';

        document.getElementById('portal-enroll-confirm').addEventListener('click', function () {
          var code = document.getElementById('portal-enroll-code').value.trim();
          var status = document.getElementById('portal-enroll-status');
          if (!code) { status.textContent = 'Enter the 6-digit code first.'; return; }
          status.textContent = 'Checking…';

          client.auth.mfa.challenge({ factorId: factor.id }).then(function (challengeResult) {
            if (challengeResult.error) { status.textContent = 'Something went wrong. Please try again.'; return; }
            client.auth.mfa.verify({ factorId: factor.id, challengeId: challengeResult.data.id, code: code }).then(function (verifyResult) {
              if (verifyResult.error) {
                status.textContent = 'That code wasn’t recognised. Check the time on your phone is correct, and try the next code your app shows.';
                return;
              }
              window.location.href = 'asset-overview.html';
            });
          });
        });
      }

      if (enrollCancelLink) {
        enrollCancelLink.addEventListener('click', function (e) {
          e.preventDefault();
          // Clears the half-finished, never-verified factor first —
          // Supabase only allows one unverified TOTP factor on an account
          // at a time, so leaving it behind would block the next attempt
          // at logging in (same cleanup security.js does for an abandoned
          // enrollment).
          client.auth.mfa.listFactors().then(function (result) {
            var allFactors = (result.data && result.data.all) || [];
            var unverified = allFactors.filter(function (f) { return f.factor_type === 'totp' && f.status !== 'verified'; });
            Promise.all(unverified.map(function (f) { return client.auth.mfa.unenroll({ factorId: f.id }); }))
              .then(function () { client.auth.signOut().then(function () { window.location.reload(); }); });
          });
        });
      }

      // After a valid session exists (fresh sign-in, or one already on
      // file), decide whether it's actually ready to use yet.
      function proceedPastAuth() {
        Promise.all([
          client.auth.mfa.getAuthenticatorAssuranceLevel(),
          client.auth.mfa.listFactors()
        ]).then(function (results) {
          var levelsResult = results[0], factorsResult = results[1];
          if (levelsResult.error) {
            // Fail closed, not open — if we can't tell whether a second
            // factor is required, don't assume it isn't.
            if (errorBox) {
              errorBox.textContent = 'Could not verify your login just now. Please try again.';
              errorBox.hidden = false;
            }
            return;
          }
          var levels = levelsResult.data;
          if (levels.nextLevel === 'aal2' && levels.currentLevel !== levels.nextLevel) {
            showMfaStep();
            return;
          }
          var allFactors = (!factorsResult.error && factorsResult.data && factorsResult.data.all) || [];
          var verified = allFactors.filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; });
          if (verified.length === 0) {
            showEnrollStep();
            return;
          }
          window.location.href = 'asset-overview.html';
        });
      }

      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('portal-email').value.trim();
        var password = document.getElementById('portal-password').value;
        var submitBtn = loginForm.querySelector('button[type="submit"]');

        if (errorBox) errorBox.hidden = true;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Logging in…'; }

        client.auth.signInWithPassword({ email: email, password: password }).then(function (result) {
          if (result.error) {
            if (errorBox) {
              errorBox.textContent = 'That email and password were not recognised.';
              errorBox.hidden = false;
            }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Log in'; }
            return;
          }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Log in'; }
          proceedPastAuth();
        });
      });

      if (mfaForm) {
        mfaForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var code = mfaForm.querySelector('#portal-mfa-code').value.trim();
          var submitBtn = mfaForm.querySelector('button[type="submit"]');

          if (mfaErrorBox) mfaErrorBox.hidden = true;
          if (!code) return;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying…'; }

          client.auth.mfa.listFactors().then(function (factorsResult) {
            var allFactors = (factorsResult.data && factorsResult.data.all) || [];
            var factor = allFactors.filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; })[0];
            if (factorsResult.error || !factor) {
              if (mfaErrorBox) {
                mfaErrorBox.textContent = 'Could not find your authenticator app. Please try again, or log out and contact Oscar.';
                mfaErrorBox.hidden = false;
              }
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Verify and continue'; }
              return;
            }

            client.auth.mfa.challenge({ factorId: factor.id }).then(function (challengeResult) {
              if (challengeResult.error) {
                if (mfaErrorBox) {
                  mfaErrorBox.textContent = 'Something went wrong. Please try again.';
                  mfaErrorBox.hidden = false;
                }
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Verify and continue'; }
                return;
              }

              client.auth.mfa.verify({ factorId: factor.id, challengeId: challengeResult.data.id, code: code }).then(function (verifyResult) {
                if (verifyResult.error) {
                  if (mfaErrorBox) {
                    mfaErrorBox.textContent = 'That code was not recognised. Please check your authenticator app and try again.';
                    mfaErrorBox.hidden = false;
                  }
                  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Verify and continue'; }
                  mfaForm.querySelector('#portal-mfa-code').value = '';
                  mfaForm.querySelector('#portal-mfa-code').focus();
                  return;
                }
                window.location.href = 'asset-overview.html';
              });
            });
          });
        });
      }

      if (mfaCancelLink) {
        mfaCancelLink.addEventListener('click', function (e) {
          e.preventDefault();
          client.auth.signOut().then(function () { window.location.reload(); });
        });
      }

      // "Forgot your password?" — swaps the login form for an
      // email-only form that calls resetPasswordForEmail. Deliberately
      // shows the same success message whether or not the address has an
      // account (Supabase's own behaviour here already avoids leaking
      // that — see the account-enumeration check in the security review),
      // so this never confirms or denies who has a login.
      if (forgotOpenLink && forgotForm) {
        forgotOpenLink.addEventListener('click', function (e) {
          e.preventDefault();
          loginForm.hidden = true;
          if (loginFoot) loginFoot.hidden = true;
          if (forgotOpenWrap) forgotOpenWrap.hidden = true;
          forgotForm.hidden = false;
          if (forgotFoot) forgotFoot.hidden = false;
          if (forgotError) forgotError.hidden = true;
          if (forgotSuccess) forgotSuccess.hidden = true;
          forgotForm.reset();
          var emailInput = document.getElementById('portal-forgot-email');
          if (emailInput) emailInput.focus();
        });
      }

      if (forgotCancelLink) {
        forgotCancelLink.addEventListener('click', function (e) {
          e.preventDefault();
          forgotForm.hidden = true;
          if (forgotFoot) forgotFoot.hidden = true;
          loginForm.hidden = false;
          if (loginFoot) loginFoot.hidden = false;
          if (forgotOpenWrap) forgotOpenWrap.hidden = false;
        });
      }

      if (forgotForm) {
        forgotForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var email = document.getElementById('portal-forgot-email').value.trim();
          var submitBtn = forgotForm.querySelector('button[type="submit"]');

          if (forgotError) forgotError.hidden = true;
          if (forgotSuccess) forgotSuccess.hidden = true;
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

          var redirectTo = new URL('reset-password.html', window.location.href).href;

          client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo }).then(function (result) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send reset link'; }
            // Shown on success AND on error (other than a malformed email,
            // which the input's own type="email" validation already
            // catches) — same reasoning as above, this never reveals
            // whether the address has an account.
            if (forgotSuccess) {
              forgotSuccess.textContent = 'If ' + email + ' has an account, a password reset link is on its way. The link is valid for a limited time — check your inbox (and spam folder).';
              forgotSuccess.hidden = false;
            }
          }).catch(function () {
            // A rejected promise here (a dropped connection, a browser
            // extension blocking the request, a flaky network) previously
            // left the button stuck on "Sending…" forever with no feedback
            // at all — indistinguishable, from the person's side, from the
            // button doing nothing when clicked. Always resolve the button
            // back to a usable state and say something went wrong, so a
            // failed request is visible and retryable rather than silent.
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send reset link'; }
            if (forgotError) {
              forgotError.textContent = 'Could not send that just now — please check your connection and try again.';
              forgotError.hidden = false;
            }
          });
        });
      }

      // Already signed in (or partway through, from an earlier visit)?
      // Work out where that actually leaves them rather than assuming.
      client.auth.getSession().then(function (result) {
        if (result.data.session) proceedPastAuth();
      });
    }

    // ---- Dashboard page ----
    if (entitiesContainer) {
      client.auth.getSession().then(function (result) {
        var session = result.data.session;
        if (!session) {
          window.location.href = 'index.html';
          return;
        }

        ensureAal2(session).then(function (ok) {
          if (!ok) return; // ensureAal2 already sent them back to index.html

          var userEmail = document.getElementById('portal-user-email');
          if (userEmail) userEmail.textContent = session.user.email;

          var firstName = firstNameFor(session.user);
          var welcomeName = document.getElementById('portal-welcome-name');
          if (welcomeName) welcomeName.textContent = firstName;
          var avatar = document.getElementById('portal-avatar');
          if (avatar) avatar.textContent = firstName.charAt(0).toUpperCase();

          loadEntities(session);
        });
      });
    }

    // 2FA is compulsory. A session that hasn't actually completed a code
    // challenge — whether the account has never enrolled, or has enrolled
    // but this particular sign-in only did the password step — has nowhere
    // useful to go on this page (the database would just refuse every
    // query anyway, per supabase-schema.sql), so send it back to
    // index.html, which walks it through whichever of those two steps
    // applies. Kept here (rather than only on the login page) so that
    // reaching dashboard.html directly with an old, insufficiently
    // authenticated session can't skip enrollment. Same check, same
    // reasoning, in property.js and person.js.
    function ensureAal2(session) {
      return Promise.all([
        client.auth.mfa.getAuthenticatorAssuranceLevel(),
        client.auth.mfa.listFactors()
      ]).then(function (results) {
        var levelsResult = results[0];
        if (levelsResult.error || !levelsResult.data || levelsResult.data.currentLevel !== 'aal2') {
          window.location.href = 'index.html';
          return false;
        }
        return true;
      });
    }

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        client.auth.signOut().then(function () {
          window.location.href = 'index.html';
        });
      });
    });

    function personForBaseId(id) {
      return PEOPLE.filter(function (p) { return p.baseEntityId === id; })[0];
    }

    function loadEntities(session) {
      client
        .from('portal_access')
        .select('entity_id, can_upload, entities(id, name, sort_order)')
        .then(function (accessResult) {
          if (accessResult.error) {
            entitiesContainer.innerHTML = '<div class="entity-card"><p>Could not load your sections right now. Please try again shortly.</p></div>';
            return;
          }

          var access = (accessResult.data || []).filter(function (row) { return row.entities; });
          access.sort(function (a, b) {
            return (a.entities.sort_order || 0) - (b.entities.sort_order || 0);
          });

          if (access.length === 0) {
            entitiesContainer.innerHTML = '<div class="entity-card"><p>Your account is not linked to any sections yet. Contact Oscar to get this set up.</p></div>';
            return;
          }

          var idSet = {};
          access.forEach(function (row) { idSet[row.entities.id] = true; });

          // A property has full status (its own page, its own card here)
          // when someone can see its Compliance & Tenancy or Insurance —
          // no property names hardcoded anywhere for this, so adding a new
          // property is still just new rows in Supabase (see SETUP.md).
          function hasFullPropertyAccess(id) {
            return !!(idSet[id + '-compliance-tenancy'] || idSet[id + '-insurance']);
          }
          // Someone who can only see a property's Documents and/or Income
          // (the accountant today) doesn't get a card for it here at all —
          // it's grouped inside PROPERTY_OWNERS[id]'s own page instead (see
          // person.js). If a property isn't listed there, nothing would
          // ever show it to a partial-access viewer, so this still falls
          // back to a plain flat card for them rather than silently
          // disappearing.
          function hasPartialPropertyAccess(id) {
            return !hasFullPropertyAccess(id) && !!(idSet[id] || idSet[id + '-income']);
          }
          function isPropertyBase(id) {
            return hasFullPropertyAccess(id) || (hasPartialPropertyAccess(id) && !PROPERTY_OWNERS[id]);
          }
          function nestedUnderPerson(id) {
            return hasPartialPropertyAccess(id) && !!PROPERTY_OWNERS[id];
          }
          function isSatellite(id) {
            if (/-compliance-tenancy$/.test(id) || /-insurance$/.test(id) || /-income$/.test(id)) return true;
            if (nestedUnderPerson(id)) return true;
            return PEOPLE.some(function (p) {
              return id === p.key + '-bank-statements' || id === p.key + '-investment-dividends' ||
                id === p.key + '-employment-payslips' || id === p.key + '-receipts-invoices';
            });
          }

          // 3 Horning Close (see COMPANY_OWNED_PROPERTY_IDS below) has no
          // Documents/Income access of its own any more — only its
          // Compliance & Tenancy — which isSatellite above always excludes
          // from topLevel. That's deliberate: it never gets a card (or a
          // page) of its own here at all. It renders nested inside the Ltd
          // company's own page instead — see
          // NESTED_COMPLIANCE_PROPERTIES_BY_COMPANY in assets/property.js,
          // kept in sync by hand with this file.
          var topLevel = access.filter(function (row) { return !isSatellite(row.entities.id); });

          function cardHtmlForRow(row) {
            var ent = row.entities;
            var person = personForBaseId(ent.id);
            if (person) return personCardHtml(person);
            if (isPropertyBase(ent.id)) return propertyCardHtml(ent);
            var uploadBlock = row.can_upload ? uploadFormHtml(ent.id) : '';
            return (
              '<div class="entity-card" data-entity-card="' + ent.id + '">' +
                '<div class="section-head left"><h2>' + escapeHtml(ent.name) + '</h2></div>' +
                '<div class="year-filter-row" data-year-filter="' + ent.id + '" hidden>' +
                  '<label for="year-select-' + ent.id + '">Year</label>' +
                  '<select id="year-select-' + ent.id + '" data-year-select></select>' +
                '</div>' +
                '<div class="doc-list" data-doc-list="' + ent.id + '"><div class="doc-row"><div class="doc-row-main"><div>Loading documents&hellip;</div></div></div></div>' +
                uploadBlock +
              '</div>'
            );
          }

          // Purely visual grouping (Company / Properties / People) with a
          // subtle divider between them, so a long dashboard is easier to
          // scan — this changes nothing about who can see what, and the
          // order of cards within each group still follows sort_order, same
          // as before. A group with nothing in it is skipped entirely, and
          // if everything a given user has access to falls into a single
          // group (the accountant, say — no, they get both Company and
          // People — but a hypothetical single-section user would), no
          // heading is shown at all rather than one lonely label.
          //
          // The Ltd company is called out by id rather than inferred: it
          // renders through the same property.html template as an actual
          // property (see isPropertyBase/hasPartialPropertyAccess above,
          // which falls back to treating any non-person id without a
          // PROPERTY_OWNERS entry as a property) since that template is
          // just "Documents + Income & Outgoings," but it isn't a property
          // from Oscar's point of view, so it gets its own group here.
          var COMPANY_ENTITY_IDS = ['ltd-company'];
          // Reserved for a company-owned property that (unlike 3 Horning
          // Close) actually has its own Documents/Income access one day —
          // it would then group under Company here rather than Properties.
          // 3 Horning Close itself never reaches this list in practice: it
          // has no Documents/Income access at all any more, only Compliance
          // & Tenancy, which is always a satellite (isSatellite above) and
          // so never becomes a topLevel row here — it renders nested inside
          // the Ltd company's own page instead (see
          // NESTED_COMPLIANCE_PROPERTIES_BY_COMPANY in assets/property.js).
          var COMPANY_OWNED_PROPERTY_IDS = [];
          var GROUP_LABELS = { company: 'Company', properties: 'Properties', people: 'People' };
          var GROUP_ORDER = ['company', 'properties', 'people'];
          var grouped = { company: [], properties: [], people: [] };
          topLevel.forEach(function (row) {
            var ent = row.entities;
            var group = COMPANY_ENTITY_IDS.indexOf(ent.id) !== -1 ? 'company'
              : COMPANY_OWNED_PROPERTY_IDS.indexOf(ent.id) !== -1 ? 'company'
              : personForBaseId(ent.id) ? 'people'
              : isPropertyBase(ent.id) ? 'properties'
              : 'company';
            grouped[group].push(row);
          });
          var groupsPresent = GROUP_ORDER.filter(function (g) { return grouped[g].length > 0; });
          var showGroupHeadings = groupsPresent.length > 1;

          entitiesContainer.innerHTML = groupsPresent.map(function (g) {
            var headingHtml = showGroupHeadings ? '<p class="dashboard-group-label">' + GROUP_LABELS[g] + '</p>' : '';
            return headingHtml + grouped[g].map(cardHtmlForRow).join('');
          }).join('');

          var uploadableIds = {};
          access.forEach(function (row) { if (row.can_upload) uploadableIds[row.entities.id] = true; });

          var namesById = {};
          access.forEach(function (row) { namesById[row.entities.id] = row.entities.name; });

          // Only genuinely flat entities (the Ltd company, and similar) get
          // an inline doc-list + upload form wired here. Properties and
          // people now live on their own pages (property.html / person.html).
          var inlineIds = topLevel
            .map(function (row) { return row.entities.id; })
            .filter(function (id) {
              if (personForBaseId(id)) return false;
              if (isPropertyBase(id)) return false;
              return true;
            });

          // The "expiring soon" banner covers EVERY accessible document
          // regardless of which page it's actually managed on — it reads
          // straight from the unfiltered query below, not from this list.
          loadDocuments(inlineIds, uploadableIds, session, namesById);
          inlineIds.forEach(function (id) {
            var row = access.filter(function (r) { return r.entities.id === id; })[0];
            if (row.can_upload) wireUploadForm(id, session);
          });
        });
    }

    function propertyCardHtml(ent) {
      return (
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>' + escapeHtml(ent.name) + '</h2></div>' +
          '<p>Documents, income, and (where you have access) Compliance &amp; Tenancy and Insurance for this property, all in one place.</p>' +
          '<a href="property.html?id=' + encodeURIComponent(ent.id) + '" class="btn btn-primary">Open ' + escapeHtml(ent.name) + '</a>' +
        '</div>'
      );
    }

    function personCardHtml(person) {
      return (
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>' + escapeHtml(person.label) + '</h2></div>' +
          '<p>General documents, tax year bank statements, investment &amp; dividend returns, employment/payslips, Receipts &amp; Invoices, and (where you have access) any properties grouped under ' + escapeHtml(person.label) + ', all in one place.</p>' +
          '<a href="person.html?id=' + person.key + '" class="btn btn-primary">Open ' + escapeHtml(person.label) + '</a>' +
        '</div>'
      );
    }

    function uploadFormHtml(entityId) {
      var currentYear = new Date().getFullYear();
      var yearOptions = '<option value="" disabled selected>Choose a year&hellip;</option>';
      for (var y = currentYear + 1; y >= currentYear - 8; y--) {
        yearOptions += '<option value="' + y + '">' + y + '</option>';
      }
      return (
        '<form class="form-card upload-form" data-upload-entity="' + entityId + '">' +
          '<div class="form-grid-2">' +
            '<div><label>Document name</label><input type="text" name="name" required placeholder="e.g. Company Accounts 2026"></div>' +
            '<div><label>Category (optional)</label><input type="text" name="category" placeholder="e.g. Filed 14 July 2026"></div>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div><label>Year</label><select name="year" required>' + yearOptions + '</select></div>' +
            '<div><label>Valid until (optional)</label><input type="date" name="valid_until"></div>' +
          '</div>' +
          window.HouseagoDocScan.categoryFieldHtml() +
          window.HouseagoDocScan.captureFieldHtml({ label: 'File', multiple: true }) +
          '<button type="submit" class="btn btn-primary">Upload document</button>' +
          '<p class="form-status" role="status"></p>' +
        '</form>'
      );
    }

    function renderDocRow(doc, entityId, uploadableIds, entityIds, session) {
      var metaBits = [];
      if (doc.category) metaBits.push(doc.category);
      if (doc.expense_category) metaBits.push(doc.expense_category);
      if (doc.year) metaBits.push(doc.year);
      if (doc.valid_until) metaBits.push('Valid until ' + doc.valid_until);

      var row = document.createElement('div');
      row.className = 'doc-row';
      row.innerHTML =
        '<div class="doc-row-main">' +
          '<div class="doc-icon">' + docIconSvg(doc.name || doc.category || '') + '</div>' +
          '<div>' +
            '<div class="doc-name">' + escapeHtml(doc.name || 'Document') + '</div>' +
            '<div class="doc-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="doc-row-actions">' +
          (uploadableIds[entityId] ? '<button type="button" class="btn-text" data-delete>Delete</button>' : '') +
          '<a href="#" class="btn btn-outline">Download</a>' +
        '</div>';

      row.querySelector('a').addEventListener('click', function (e) {
        e.preventDefault();
        client.storage
          .from('owner-documents')
          .createSignedUrl(doc.file_path, 300)
          .then(function (signedResult) {
            if (signedResult.error || !signedResult.data) {
              alert('This file could not be opened. Please try again.');
              return;
            }
            window.open(signedResult.data.signedUrl, '_blank', 'noopener');
          });
      });

      var deleteBtn = row.querySelector('[data-delete]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
          if (!window.confirm('Delete "' + doc.name + '"? This cannot be undone.')) return;
          client.storage.from('owner-documents').remove([doc.file_path]).then(function () {
            client.from('entity_documents').delete().eq('id', doc.id).then(function () {
              loadDocuments(entityIds, uploadableIds, session);
            });
          });
        });
      }

      return row;
    }

    function renderDocList(listEl, docs, selectedYear, entityId, uploadableIds, entityIds, session) {
      var filtered = selectedYear
        ? docs.filter(function (doc) { return String(doc.year || '') === selectedYear; })
        : docs;

      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>' +
          (selectedYear ? 'No documents labelled ' + escapeHtml(selectedYear) + '.' : 'No documents here yet.') +
          '</div></div></div>';
        return;
      }
      filtered.forEach(function (doc) {
        listEl.appendChild(renderDocRow(doc, entityId, uploadableIds, entityIds, session));
      });
    }

    function loadDocuments(entityIds, uploadableIds, session, namesById) {
      client
        .from('entity_documents')
        .select('*')
        .order('created_at', { ascending: false })
        .then(function (result) {
          var byEntity = {};
          entityIds.forEach(function (id) { byEntity[id] = []; });

          if (!result.error) {
            (result.data || []).forEach(function (doc) {
              if (byEntity[doc.entity_id]) byEntity[doc.entity_id].push(doc);
            });
            // Deliberately independent of entityIds/byEntity above — this
            // reads every document this user can see (RLS-scoped), whether
            // it's rendered inline on this page or lives on property.html /
            // person.html, so the banner is always complete.
            if (namesById) renderExpiringSoonBanner(result.data || [], namesById);
          }

          entityIds.forEach(function (entityId) {
            var listEl = entitiesContainer.querySelector('[data-doc-list="' + entityId + '"]');
            if (!listEl) return;

            if (result.error) {
              listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>Could not load documents right now.</div></div></div>';
              return;
            }

            var docs = byEntity[entityId];

            var filterRow = entitiesContainer.querySelector('[data-year-filter="' + entityId + '"]');
            var yearSelect = filterRow ? filterRow.querySelector('[data-year-select]') : null;
            var years = [];
            docs.forEach(function (doc) {
              if (doc.year && years.indexOf(String(doc.year)) === -1) years.push(String(doc.year));
            });
            years.sort(function (a, b) { return b - a; });

            if (filterRow && yearSelect) {
              if (years.length > 0) {
                filterRow.hidden = false;
                yearSelect.innerHTML = '<option value="">All years</option>' +
                  years.map(function (y) { return '<option value="' + escapeAttr(y) + '">' + escapeHtml(y) + '</option>'; }).join('');
                yearSelect.onchange = function () {
                  renderDocList(listEl, docs, yearSelect.value, entityId, uploadableIds, entityIds, session);
                };
              } else {
                filterRow.hidden = true;
              }
            }

            renderDocList(listEl, docs, yearSelect ? yearSelect.value : '', entityId, uploadableIds, entityIds, session);
          });
        });
    }

    var bannerDismissed = false;

    // Self Assessment's two fixed HMRC deadlines — 31 January (the previous
    // tax year's balancing payment, plus any first payment on account for
    // the current year) and 31 July (the second payment on account) — shown
    // in the same banner as document expiries, but keyed to the calendar
    // rather than to anything uploaded. Always the NEXT upcoming occurrence
    // of each: once 31 January has passed, it jumps straight to next year's.
    function nextOccurrence(month, day) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var year = today.getFullYear();
      var candidate = new Date(year, month - 1, day);
      if (candidate < today) candidate = new Date(year + 1, month - 1, day);
      var iso = candidate.getFullYear() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      return { date: iso, daysLeft: daysUntil(iso) };
    }

    function selfAssessmentDueItems() {
      var jan = nextOccurrence(1, 31);
      var jul = nextOccurrence(7, 31);
      return [
        { label: 'Self Assessment balancing payment due', valid_until: jan.date, daysLeft: jan.daysLeft },
        { label: 'Self Assessment payment on account due', valid_until: jul.date, daysLeft: jul.daysLeft }
      ];
    }

    function renderExpiringSoonBanner(allDocs, namesById) {
      if (!expiringBanner || bannerDismissed) return;

      var docsDue = allDocs
        .filter(function (doc) { return doc.valid_until; })
        .map(function (doc) {
          var label = (doc.compliance_type && complianceTypeLabel(doc.compliance_type)) || doc.name || 'Document';
          return { kind: 'doc', label: label, entityName: namesById[doc.entity_id] || '', valid_until: doc.valid_until, daysLeft: daysUntil(doc.valid_until) };
        });

      var datesDue = selfAssessmentDueItems().map(function (item) {
        item.kind = 'date';
        return item;
      });

      var due = docsDue.concat(datesDue)
        .filter(function (item) { return item.daysLeft <= EXPIRING_SOON_DAYS; })
        .sort(function (a, b) { return a.daysLeft - b.daysLeft; });

      if (due.length === 0) { expiringBanner.hidden = true; expiringBanner.innerHTML = ''; return; }

      var rows = due.map(function (item) {
        var when;
        if (item.kind === 'date') {
          when = item.daysLeft < 0
            ? 'overdue since ' + formatDate(item.valid_until)
            : (item.daysLeft === 0 ? 'due today' : 'due in ' + item.daysLeft + ' day' + (item.daysLeft === 1 ? '' : 's'));
        } else {
          when = item.daysLeft < 0
            ? 'expired ' + formatDate(item.valid_until)
            : (item.daysLeft === 0 ? 'expires today' : 'expires in ' + item.daysLeft + ' day' + (item.daysLeft === 1 ? '' : 's'));
        }
        var cls = item.daysLeft < 0 ? 'critical' : 'warning';
        return (
          '<div class="expiring-row">' +
            '<span class="status-pill status-' + cls + '">' + escapeHtml(when) + '</span>' +
            '<span>' + escapeHtml(item.label) + (item.entityName ? ' &middot; ' + escapeHtml(item.entityName) : '') + '</span>' +
          '</div>'
        );
      }).join('');

      expiringBanner.innerHTML =
        '<div class="expiring-banner-head">' +
          '<strong>' + due.length + ' item' + (due.length === 1 ? '' : 's') + ' need' + (due.length === 1 ? 's' : '') + ' attention</strong>' +
          '<button type="button" class="btn-text" data-dismiss-banner>Dismiss</button>' +
        '</div>' +
        rows;
      expiringBanner.hidden = false;

      var dismissBtn = expiringBanner.querySelector('[data-dismiss-banner]');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function () {
          bannerDismissed = true;
          expiringBanner.hidden = true;
        });
      }
    }

    function wireUploadForm(entityId, session) {
      var form = entitiesContainer.querySelector('[data-upload-entity="' + entityId + '"]');
      if (!form) return;

      var currentYear = new Date().getFullYear();
      var status = form.querySelector('.form-status');

      function handleBulkFiles(files) {
        status.textContent = 'Uploading ' + files.length + ' files…';
        window.HouseagoDocScan.bulkUploadFiles(files, {
          client: client,
          entityId: entityId,
          session: session,
          onProgress: function (done, total) { status.textContent = 'Uploading ' + done + ' of ' + total + '…'; },
          buildRow: function (fields, file) {
            return {
              name: fields.title || file.name.replace(/\.[^.]+$/, ''),
              category: null,
              expense_category: fields.category || null,
              year: fields.year || String(currentYear),
              valid_until: null
            };
          }
        }).then(function (results) {
          status.textContent = window.HouseagoDocScan.summarizeBulkResults(results);
          form.reset();
          capture.reset();
          loadEntities(session);
        });
      }

      var capture = window.HouseagoDocScan.wireCaptureField(form, {
        dateInput: form.querySelector('input[name="valid_until"]'),
        nameInput: form.querySelector('input[name="name"]'),
        categorySelect: form.querySelector('select[name="expense_category"]'),
        yearSelect: form.querySelector('select[name="year"]'),
        onMultipleFiles: handleBulkFiles
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        var file = capture.getFile();
        if (!file) { form.querySelector('.form-status').textContent = 'Please take a photo or choose a file first.'; return; }

        var name = form.querySelector('input[name="name"]').value.trim();
        var category = form.querySelector('input[name="category"]').value.trim();
        var expenseCategory = form.querySelector('select[name="expense_category"]').value || null;
        var year = form.querySelector('select[name="year"]').value;
        var validUntil = form.querySelector('input[name="valid_until"]').value;
        var submitBtn = form.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading…';
        status.textContent = '';

        function doUpload(hash) {
          // Every document ends up stored as a PDF, whatever was picked —
          // an image gets wrapped into one, a PDF is left as-is.
          window.HouseagoPdfConvert.toPdfIfImage({ blob: file, name: file.name, type: file.type }).then(function (finalUpload) {
            var safeFileName = finalUpload.name.replace(/[^a-zA-Z0-9._-]/g, '-');
            var path = entityId + '/' + Date.now() + '-' + safeFileName;

            client.storage.from('owner-documents').upload(path, finalUpload.blob, { contentType: finalUpload.type || undefined }).then(function (uploadResult) {
              if (uploadResult.error) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Upload document';
                status.textContent = 'Could not upload that file. Please try again.';
                return;
              }

              client.from('entity_documents').insert({
                entity_id: entityId,
                name: name,
                category: category || null,
                expense_category: expenseCategory,
                year: year || null,
                valid_until: validUntil || null,
                file_path: path,
                file_hash: hash || null,
                uploaded_by: session.user.id
              }).then(function (insertResult) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Upload document';
                if (insertResult.error) {
                  status.textContent = 'The file uploaded, but could not be added to the document list. Please try again.';
                  return;
                }
                status.textContent = 'Uploaded.';
                form.reset();
                capture.reset();
                loadEntities(session);
              });
            });
          });
        }

        window.HouseagoDocScan.hashFile(file).then(function (hash) {
          window.HouseagoDocScan.findDuplicateByHash(client, entityId, hash).then(function (existing) {
            if (existing && !window.confirm('This exact file looks like it’s already been uploaded (as “' + (existing.name || 'a document') + '”). Upload it again anyway?')) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Upload document';
              status.textContent = 'Not uploaded — already on file.';
              return;
            }
            doUpload(hash);
          });
        });
      });
    }
  });
})();
