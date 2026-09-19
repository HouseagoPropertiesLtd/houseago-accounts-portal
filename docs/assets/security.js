// Powers security.html: setting up two-factor authentication (TOTP, via an
// authenticator app) for the signed-in account, changing the account
// password, and sending a password-reset email. 2FA is compulsory for
// every account (see supabase-schema.sql and the security review) and is
// deliberately NOT self-service to turn off from here once it's on - see
// the note in renderEnabled below. Uses Supabase Auth's own built-in MFA
// support (client.auth.mfa.*) - no server-side code of ours involved, same
// anon-key-only approach as the rest of the site. See the "Two-factor
// authentication" section of supabase-schema.sql for the database-side
// enforcement this pairs with (once an account has a verified factor, the
// database itself refuses to hand back documents until that account's
// session has actually completed a 2FA challenge).
//
// Falls back to a sample preview until assets/supabase-config.js has real
// values in it, same as the rest of the site (see SETUP.md).

(function () {
  var keysConfigured =
    typeof SUPABASE_URL !== 'undefined' &&
    typeof SUPABASE_ANON_KEY !== 'undefined' &&
    SUPABASE_URL.indexOf('YOUR_SUPABASE') !== 0;

  var libraryLoaded = typeof supabase !== 'undefined';

  var client = (keysConfigured && libraryLoaded)
    ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  // escapeHtml is for text content - it doesn't need to (and by default
  // doesn't) escape quote characters, since those are harmless there. The
  // QR code below is a data: URI (an embedded SVG) placed inside an HTML
  // attribute instead, where an unescaped " breaks straight out of the
  // attribute - so that one specifically needs its quotes escaped too.
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

  document.addEventListener('DOMContentLoaded', function () {
    var sectionsEl = document.getElementById('security-sections');

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (client) { client.auth.signOut().then(function () { window.location.href = 'index.html'; }); }
        else { window.location.href = 'index.html'; }
      });
    });

    if (!sectionsEl) return;

    if (keysConfigured && !libraryLoaded) {
      sectionsEl.innerHTML = '<div class="entity-card"><p>The portal could not load just now. Please refresh the page and try again in a moment.</p></div>';
      return;
    }

    if (!client) {
      sectionsEl.innerHTML = '<div class="entity-card"><p>This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).</p></div>';
      return;
    }

    client.auth.getSession().then(function (result) {
      var session = result.data.session;
      if (!session) { window.location.href = 'index.html'; return; }
      loadStatus(session);
    });

    function loadStatus(session) {
      sectionsEl.innerHTML =
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>Signed in as</h2></div>' +
          '<p>' + escapeHtml(session.user.email) + '</p>' +
        '</div>' +
        '<div class="entity-card" id="password-card">' +
          '<div class="section-head left"><h2>Password</h2></div>' +
          '<form class="form-card" id="password-form">' +
            '<div><label for="password-current">Current password</label><input type="password" id="password-current" name="currentPassword" autocomplete="current-password" required></div>' +
            '<div><label for="password-new-1">New password</label><input type="password" id="password-new-1" name="password" autocomplete="new-password" minlength="10" required></div>' +
            '<div><label for="password-new-2">Confirm new password</label><input type="password" id="password-new-2" name="password2" autocomplete="new-password" minlength="10" required></div>' +
            '<p style="margin:0 0 4px; font-size:0.85rem; color:var(--ink-soft);">Needs at least 10 characters, with a mix of uppercase, lowercase, a number, and a symbol.</p>' +
            '<button type="submit" class="btn btn-primary">Change password</button>' +
            '<p class="form-status" role="status" id="password-status"></p>' +
          '</form>' +
          '<p style="margin-top:14px; font-size:0.9rem;"><a href="#" id="password-reset-email-link">Forgot your current password? Email me a reset link instead</a></p>' +
          '<p class="form-status" role="status" id="password-reset-email-status"></p>' +
        '</div>' +
        '<div class="entity-card" id="mfa-card"><p>Loading&hellip;</p></div>';

      // Sends a normal Supabase password-reset email to this account's own
      // registered address - same mechanism as the "Forgot your password?"
      // link on the login page (index.html/auth.js), just reachable from
      // here too since the person is already signed in and their email is
      // already known, so there's no need to type it in again. Lands on
      // the same reset-password.html page.
      var resetEmailLink = document.getElementById('password-reset-email-link');
      if (resetEmailLink) {
        resetEmailLink.addEventListener('click', function (e) {
          e.preventDefault();
          var status = document.getElementById('password-reset-email-status');
          status.style.color = 'var(--ink-soft)';
          status.textContent = 'Sending…';
          var redirectTo = new URL('reset-password.html', window.location.href).href;
          client.auth.resetPasswordForEmail(session.user.email, { redirectTo: redirectTo }).then(function (result) {
            if (result.error) {
              status.style.color = 'var(--rose-deep)';
              status.textContent = 'Could not send that just now. Please try again.';
              return;
            }
            status.style.color = 'var(--ink-soft)';
            status.textContent = 'A password reset link is on its way to ' + session.user.email + '. Check your inbox (and spam folder).';
          });
        });
      }

      var passwordForm = document.getElementById('password-form');
      if (passwordForm) {
        passwordForm.addEventListener('submit', function (e) {
          e.preventDefault();
          var current = document.getElementById('password-current').value;
          var pw1 = document.getElementById('password-new-1').value;
          var pw2 = document.getElementById('password-new-2').value;
          var status = document.getElementById('password-status');
          var submitBtn = passwordForm.querySelector('button[type="submit"]');

          status.style.color = 'var(--rose-deep)';

          if (pw1 !== pw2) { status.textContent = 'Those two new passwords do not match.'; return; }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Changing…';
          status.textContent = '';

          // currentPassword requires supabase-js v2.102.0+ (this site
          // loads the "@2" tag, which always resolves to the latest v2.x)
          // - matches "Require current password when updating" turned on
          // in the Supabase dashboard, so a hijacked session or an
          // unlocked laptop can't change the password without already
          // knowing it. See the security review.
          client.auth.updateUser({ password: pw1, currentPassword: current }).then(function (result) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Change password';
            if (result.error) {
              status.textContent = result.error.message || 'Could not change your password. Please check your current password and try again.';
              return;
            }
            status.style.color = 'var(--ink-soft)';
            status.textContent = 'Password changed.';
            passwordForm.reset();
          });
        });
      }

      Promise.all([
        client.auth.mfa.listFactors(),
        client.auth.mfa.getAuthenticatorAssuranceLevel()
      ]).then(function (results) {
        var factorsResult = results[0], levelsResult = results[1];
        if (factorsResult.error) {
          document.getElementById('mfa-card').innerHTML = '<p>Could not load your two-factor authentication settings right now. Please refresh and try again.</p>';
          return;
        }
        // listFactors()'s own grouped .totp array has proven unreliable -
        // it can come back empty even when .all correctly lists an
        // unverified TOTP factor (confirmed by hand: same account, same
        // moment, .totp === [] and .all === [that factor]) - so this reads
        // type/status off .all directly instead of trusting the grouped
        // array. Same fix applied everywhere else in the codebase doing
        // this same kind of factor lookup.
        var allFactors = (factorsResult.data && factorsResult.data.all) || [];
        var totp = allFactors.filter(function (f) { return f.factor_type === 'totp'; });
        var verified = totp.filter(function (f) { return f.status === 'verified'; });
        var unverified = totp.filter(function (f) { return f.status !== 'verified'; });
        // Whether THIS session has actually completed a code challenge -
        // not just whether the account has 2FA on. See the note above
        // "Turn off" below for why this matters.
        var thisSessionIsAal2 = !levelsResult.error && levelsResult.data && levelsResult.data.currentLevel === 'aal2';

        // Clean up any abandoned, never-confirmed enrolment before showing
        // the "off" state, so a half-finished setup doesn't quietly block a
        // new one (Supabase only allows one unverified TOTP factor at a
        // time).
        if (verified.length === 0 && unverified.length > 0) {
          Promise.all(unverified.map(function (f) { return client.auth.mfa.unenroll({ factorId: f.id }); }))
            .then(function () { renderDisabled(session); });
          return;
        }

        if (verified.length > 0) renderEnabled(session, verified[0], thisSessionIsAal2);
        else renderDisabled(session);
      });
    }

    function renderEnabled(session, factor, thisSessionIsAal2) {
      // Two-factor authentication is compulsory for every account (see the
      // "Two-factor authentication made compulsory" section of the
      // security review) - there is deliberately no way to turn it off
      // here. The database itself refuses to hand back any data for a
      // session that hasn't completed a 2FA challenge, so a UI toggle to
      // disable it would be misleading even if it were offered. Lost
      // access to the authenticator app is handled by Oscar directly in
      // the Supabase dashboard (removing the factor there so the account
      // can enrol a new one), not self-service.
      var card = document.getElementById('mfa-card');
      card.innerHTML =
        '<div class="section-head left"><h2>Two-factor authentication</h2></div>' +
        '<div class="mfa-status-row"><span class="status-pill status-good">On</span><span>' +
          escapeHtml(factor.friendly_name || 'Authenticator app') +
          (factor.created_at ? ', added ' + formatDate(factor.created_at) : '') +
        '</span></div>' +
        '<p>A code from your authenticator app is required every time you log in, in addition to your password. This is required for every account and can&rsquo;t be turned off here.</p>' +
        '<p style="font-size:0.9rem; color:var(--ink-soft);">Lost your authenticator app? Contact Oscar to have it reset so you can set up a new one.</p>' +
        '<p class="form-status" role="status" id="mfa-status"></p>';
    }

    function renderDisabled(session) {
      var card = document.getElementById('mfa-card');
      card.innerHTML =
        '<div class="section-head left"><h2>Two-factor authentication</h2></div>' +
        '<div class="mfa-status-row"><span class="status-pill status-neutral">Off</span><span>Add a one-time code from an authenticator app (Microsoft Authenticator, Google Authenticator, Authy, 1Password, and similar) as a second step when logging in.</span></div>' +
        '<button type="button" class="btn btn-primary" id="mfa-set-up">Set up two-factor authentication</button>' +
        '<p class="form-status" role="status" id="mfa-status"></p>';

      document.getElementById('mfa-set-up').addEventListener('click', function () {
        var status = document.getElementById('mfa-status');
        status.textContent = 'Setting up…';
        client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator app' }).then(function (result) {
          if (result.error || !result.data) {
            status.textContent = 'Could not start setup just now. Please try again.';
            return;
          }
          renderEnrolling(session, result.data);
        });
      });
    }

    function renderEnrolling(session, factor) {
      var card = document.getElementById('mfa-card');
      var qr = (factor.totp && factor.totp.qr_code) || '';
      var secret = (factor.totp && factor.totp.secret) || '';
      card.innerHTML =
        '<div class="section-head left"><h2>Set up two-factor authentication</h2></div>' +
        '<p>Scan this QR code with an authenticator app - Microsoft Authenticator, Google Authenticator, Authy, 1Password, and similar all work, since this uses the same standard (TOTP) every one of them supports. In Microsoft Authenticator: tap the &ldquo;+&rdquo; to add an account, then &ldquo;Other account&rdquo; (not &ldquo;Work or school account&rdquo;), then scan. Or enter the setup key by hand below if you can’t scan it.</p>' +
        '<div class="mfa-qr-wrap">' +
          (qr ? '<img src="' + escapeAttr(qr) + '" alt="QR code for two-factor authentication setup">' : '') +
          '<div class="mfa-secret"><strong>Setup key</strong><br><code>' + escapeHtml(secret) + '</code></div>' +
        '</div>' +
        '<div>' +
          '<label for="mfa-confirm-code">Enter the 6-digit code your app shows now, to confirm it’s working</label>' +
          '<input type="text" id="mfa-confirm-code" class="mfa-code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="123456">' +
        '</div>' +
        '<div style="display:flex; gap:12px; margin-top:14px;">' +
          '<button type="button" class="btn btn-primary" id="mfa-confirm-btn">Verify and turn on</button>' +
          '<button type="button" class="btn-text" id="mfa-enroll-cancel">Cancel</button>' +
        '</div>' +
        '<p class="form-status" role="status" id="mfa-status"></p>';

      document.getElementById('mfa-confirm-btn').addEventListener('click', function () {
        var code = document.getElementById('mfa-confirm-code').value.trim();
        var status = document.getElementById('mfa-status');
        if (!code) { status.textContent = 'Enter the 6-digit code first.'; return; }
        status.textContent = 'Checking…';

        client.auth.mfa.challenge({ factorId: factor.id }).then(function (challengeResult) {
          if (challengeResult.error) { status.textContent = 'Something went wrong. Please try again.'; return; }
          client.auth.mfa.verify({ factorId: factor.id, challengeId: challengeResult.data.id, code: code }).then(function (verifyResult) {
            if (verifyResult.error) {
              status.textContent = 'That code wasn’t recognised. Check the time on your phone is correct, and try the next code your app shows.';
              return;
            }
            loadStatus(session);
          });
        });
      });

      document.getElementById('mfa-enroll-cancel').addEventListener('click', function () {
        client.auth.mfa.unenroll({ factorId: factor.id }).then(function () { loadStatus(session); });
      });
    }
  });
})();
