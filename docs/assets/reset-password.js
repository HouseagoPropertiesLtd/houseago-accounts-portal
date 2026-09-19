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
        if (document.readyState !== 'loading') showForm();
      }
    });
  }

  function showForm() {
    var intro = document.getElementById('reset-intro');
    var form = document.getElementById('reset-password-form');
    if (intro) intro.hidden = true;
    if (form) {
      form.hidden = false;
      var first = document.getElementById('reset-password-1');
      if (first) first.focus();
    }
  }

  function showInvalid() {
    var intro = document.getElementById('reset-intro');
    var invalid = document.getElementById('reset-invalid');
    if (intro) intro.hidden = true;
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

    if (recoveryReady) {
      showForm();
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
      });
    });
  });
})();
