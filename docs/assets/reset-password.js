// Powers reset-password.html — the second half of the "forgot password"
// flow (the first half is the request form on index.html, wired in
// auth.js). Someone arrives here from the link in the email Supabase
// sends after resetPasswordForEmail(). Supabase's client library parses
// the recovery token out of the URL itself (detectSessionInUrl, on by
// default) and fires a PASSWORD_RECOVERY auth event once it has turned
// that into a real (but recovery-only) session — this page waits for
// that event before showing the "set a new password" form, rather than
// assuming the link was valid just because the page loaded.
//
// Setting the new password here does NOT need the current password (see
// "Require current password when updating" in the Supabase dashboard,
// and the security review) — that setting only applies to a normal
// logged-in password change (security.html), not to this recovery flow,
// since clicking the emailed link is itself the proof of identity.
//
// One thing the recovery link does NOT do on its own: clicking the email
// link only ever proves the address, so Supabase starts the recovery
// session at aal1 (password-only) even for an account that already has a
// verified authenticator app — and since 2FA is compulsory here
// (supabase-schema.sql's mfa_ok()), Supabase's own server-side rule
// refuses to let an aal1 session call updateUser({password}) at all once
// a verified factor exists ("AAL2 session is required to update email or
// password when MFA is enable[d]" — a real Supabase error, previously
// shown to the person verbatim, unexplained). So for anyone who has
// already set up 2FA, this page needs an extra step before the password
// form: challenge that factor the same way index.html's login flow does,
// which elevates the recovery session to aal2, and only then is
// updateUser() allowed to succeed. An account with no factor yet (first
// login ever) skips straight to the password form, same as before.
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

  var recoveryReady = false;

  // Registered as early as possible (not inside DOMContentLoaded) so it
  // catches the event even if it fires before the rest of the page has
  // finished loading.
  if (client) {
    client.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') {
        recoveryReady = true;
        if (document.readyState !== 'loading') proceedAfterRecovery();
      }
    });
  }

  // Decides whether the recovery session can go straight to the password
  // form, or needs an MFA code first — see the note at the top of this
  // file. nextLevel is what the session COULD reach given the factors on
  // this account; currentLevel is where it actually is right now. They
  // only differ when a verified factor exists and this particular session
  // (the recovery one) hasn't cleared a challenge for it yet.
  function proceedAfterRecovery() {
    client.auth.mfa.getAuthenticatorAssuranceLevel().then(function (result) {
      var data = result.data;
      if (result.error || !data) { showForm(); return; }
      if (data.nextLevel === 'aal2' && data.currentLevel !== 'aal2') {
        showMfaForm();
      } else {
        showForm();
      }
    });
  }

  function showForm() {
    var intro = document.getElementById('reset-intro');
    var mfaForm = document.getElementById('reset-mfa-form');
    var form = document.getElementById('reset-password-form');
    if (intro) intro.hidden = true;
    if (mfaForm) mfaForm.hidden = true;
    if (form) {
      form.hidden = false;
      var first = document.getElementById('reset-password-1');
      if (first) first.focus();
    }
  }

  function showMfaForm() {
    var intro = document.getElementById('reset-intro');
    var mfaForm = document.getElementById('reset-mfa-form');
    if (intro) intro.hidden = true;
    if (mfaForm) {
      mfaForm.hidden = false;
      var codeInput = document.getElementById('reset-mfa-code');
      if (codeInput) codeInput.focus();
    }
  }

  function showInvalid() {
    var intro = document.getElementById('reset-intro');
    var mfaForm = document.getElementById('reset-mfa-form');
    var invalid = document.getElementById('reset-invalid');
    if (intro) intro.hidden = true;
    if (mfaForm) mfaForm.hidden = true;
    if (invalid) invalid.hidden = false;
  }

  document.addEventListener('DOMContentLoaded', function () {
    var intro = document.getElementById('reset-intro');

    if (keysConfigured && !libraryLoaded) {
      if (intro) intro.textContent = 'The portal could not load just now. Please refresh the page and try again in a moment.';
      return;
    }

    if (!client) {
      if (intro) intro.textContent = 'This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).';
      return;
    }

    var mfaForm = document.getElementById('reset-mfa-form');
    if (mfaForm) {
      mfaForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var code = document.getElementById('reset-mfa-code').value.trim();
        var mfaErrorBox = document.getElementById('reset-mfa-error');
        var submitBtn = mfaForm.querySelector('button[type="submit"]');

        if (mfaErrorBox) mfaErrorBox.hidden = true;
        if (!code) return;
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Verifying…'; }

        client.auth.mfa.listFactors().then(function (factorsResult) {
          // .data.all, not the pre-grouped .data.totp — see the security
          // review's note on this SDK quirk (auth.js/security.js use the
          // same fix).
          var allFactors = (factorsResult.data && factorsResult.data.all) || [];
          var factor = allFactors.filter(function (f) { return f.factor_type === 'totp' && f.status === 'verified'; })[0];
          if (factorsResult.error || !factor) {
            if (mfaErrorBox) {
              mfaErrorBox.textContent = 'Could not find your authenticator app. Please request a new reset link, or contact Oscar.';
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
                document.getElementById('reset-mfa-code').value = '';
                document.getElementById('reset-mfa-code').focus();
                return;
              }
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Verify and continue'; }
              showForm();
            });
          });
        });
      });
    }

    if (recoveryReady) {
      proceedAfterRecovery();
    } else {
      // Give the client library a few seconds to parse the link and fire
      // PASSWORD_RECOVERY. If nothing has happened by then, the link was
      // missing, already used, or expired.
      setTimeout(function () {
        if (!recoveryReady) showInvalid();
      }, 4000);
    }

    var form = document.getElementById('reset-password-form');
    if (!form) return;

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var errorBox = document.getElementById('reset-error');
      var pw1 = document.getElementById('reset-password-1').value;
      var pw2 = document.getElementById('reset-password-2').value;
      var submitBtn = form.querySelector('button[type="submit"]');

      if (errorBox) errorBox.hidden = true;

      if (pw1 !== pw2) {
        if (errorBox) {
          errorBox.textContent = 'Those two passwords do not match.';
          errorBox.hidden = false;
        }
        return;
      }

      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Setting password…'; }

      client.auth.updateUser({ password: pw1 }).then(function (result) {
        if (result.error) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Set new password'; }
          if (errorBox) {
            errorBox.textContent = result.error.message || 'Could not set that password. Please check it meets the requirements above and try again.';
            errorBox.hidden = false;
          }
          return;
        }
        form.hidden = true;
        var done = document.getElementById('reset-done');
        if (done) done.hidden = false;
        // Confirm briefly, then send them straight back to log in with the
        // new password rather than making them click through — matches
        // the plain login flow everywhere else on the site.
        setTimeout(function () {
          window.location.href = 'index.html';
        }, 1800);
      });
    });
  });
})();
