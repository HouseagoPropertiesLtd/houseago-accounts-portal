// The rules about *when a signed-in session is still good*, in one place.
//
// Every signed-in page has to answer the same two questions before it shows
// anything: has this session actually completed a two-factor code challenge,
// and is it still young enough to trust? Those checks used to be copy-pasted
// into assets/auth.js, property.js, person.js and asset-overview.js, which is
// how one subtly wrong version of them ended up living in four files at once.
// They live here now, and those files delegate to this.
//
// The two rules:
//
//   1. A session must have completed a 2FA challenge (Supabase calls this
//      assurance level "aal2"). One that hasn't is sent back to index.html,
//      which walks it through either enrolling an authenticator app or
//      entering a code, whichever applies.
//
//   2. A session whose 2FA challenge was more than MAX_SESSION_AGE_MS ago has
//      to do it again, however much it's been used in between. Supabase can
//      enforce this itself ("Time-box user sessions" under Authentication →
//      Sessions) but only on its paid plans, so it's enforced here instead.
//
// What this deliberately does NOT do is treat "I couldn't tell" as "you're
// not allowed in".
//
// A check that *errors* - a dropped connection, a token refresh that didn't
// land, a response that couldn't be read - is not evidence that someone is
// unauthenticated. The previous version of this logic redirected to the login
// page whenever the assurance-level call returned an error, and on a phone
// with patchy signal that happens regularly: the access token expires every
// hour, so most visits need a network round-trip to renew it, and any one of
// those that fails looked exactly like being logged out. That is what made
// the portal feel like it forgot you at random.
//
// Carrying on when a check is merely inconclusive is safe, because none of
// this is the actual security boundary. Every table and the storage bucket
// independently require a completed 2FA challenge at the database level
// (mfa_ok() in supabase-schema.sql), so a session that genuinely hasn't done
// one gets nothing back but empty results no matter what this file decides.
// These checks exist to send people somewhere useful, not to keep them out.

(function () {
  // 24 hours. After this, the 2FA step is required again.
  var MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000;

  // Where the clock is kept when the token itself doesn't carry it (see
  // mfaTimeFromToken below).
  var MFA_TIME_KEY = 'houseago.lastMfaAt';

  // How long to wait before a second attempt at reading the session. Long
  // enough for a brief mobile blackspot to pass, short enough not to leave
  // someone staring at a blank page.
  var RETRY_DELAY_MS = 1200;

  function decodeJwtPayload(token) {
    try {
      var parts = String(token).split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return JSON.parse(new TextDecoder('utf-8').decode(bytes));
    } catch (e) {
      return null;
    }
  }

  // Supabase records how a session authenticated in the token's "amr" claim
  // (authentication methods reference): one entry per step taken, each with
  // the time it happened. The 2FA step is the one this rule runs against.
  // Reading it from the token rather than from our own storage matters,
  // because the token is signed by Supabase - the clock can't be wound back
  // from the browser. Not every token carries it, hence the fallback below.
  function mfaTimeFromToken(accessToken) {
    var payload = decodeJwtPayload(accessToken);
    if (!payload || !Array.isArray(payload.amr)) return null;

    var newest = null;
    for (var i = 0; i < payload.amr.length; i++) {
      var entry = payload.amr[i];
      if (!entry || typeof entry.method !== 'string') continue;
      if (!/totp|mfa|webauthn|phone/i.test(entry.method)) continue;
      var ts = Number(entry.timestamp);
      if (!isFinite(ts) || ts <= 0) continue;
      if (newest === null || ts > newest) newest = ts;
    }
    return newest === null ? null : newest * 1000; // amr timestamps are seconds
  }

  function storedMfaTime() {
    try {
      var raw = window.localStorage.getItem(MFA_TIME_KEY);
      var ts = raw ? Number(raw) : NaN;
      return isFinite(ts) && ts > 0 ? ts : null;
    } catch (e) {
      return null; // private browsing, or storage blocked - not an error
    }
  }

  function rememberMfaTime(ts) {
    try { window.localStorage.setItem(MFA_TIME_KEY, String(ts)); } catch (e) { /* see above */ }
  }

  function forgetMfaTime() {
    try { window.localStorage.removeItem(MFA_TIME_KEY); } catch (e) { /* see above */ }
  }

  // Call this once a 2FA challenge has actually been completed, so the 24
  // hours starts from the right moment even on a token that doesn't carry
  // an amr claim.
  function markMfaCompleted() {
    rememberMfaTime(Date.now());
  }

  function sessionTooOld(session) {
    if (!session || !session.access_token) return false;

    var mfaAt = mfaTimeFromToken(session.access_token);
    if (mfaAt !== null) {
      rememberMfaTime(mfaAt); // keep the fallback in step with the real thing
    } else {
      mfaAt = storedMfaTime();
      if (mfaAt === null) {
        // Nothing to measure against: most likely this browser cleared its
        // storage, or this is the first visit since the rule existed. Start
        // the clock now rather than locking someone out of a session that,
        // as far as anything here can tell, is perfectly good.
        markMfaCompleted();
        return false;
      }
    }

    return (Date.now() - mfaAt) > MAX_SESSION_AGE_MS;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function readSessionOnce(client) {
    return client.auth.getSession().then(function (result) {
      return result || { data: { session: null } };
    }).catch(function () {
      return { data: { session: null }, error: true };
    });
  }

  // getSession() looks the same whether someone is signed out or their token
  // simply couldn't be renewed just then. One retry separates the two often
  // enough to be worth the wait.
  function readSession(client) {
    return readSessionOnce(client).then(function (result) {
      if (result.data && result.data.session) return result;
      return delay(RETRY_DELAY_MS).then(function () { return readSessionOnce(client); });
    });
  }

  // Resolving with a promise that never settles is how this stops a caller
  // from carrying on while the browser is already navigating away.
  function navigateTo(url) {
    window.location.href = url;
    return new Promise(function () { /* deliberately never settles */ });
  }

  // The one call a signed-in page makes to find out where it stands.
  // Resolves with the live session, or navigates away and never resolves.
  function requireSession(client, opts) {
    opts = opts || {};
    var loginUrl = opts.loginUrl || 'index.html';

    return readSession(client).then(function (result) {
      var session = result.data ? result.data.session : null;

      if (!session) {
        // Still nothing after a retry. If even reading it failed outright we
        // can't be sure, but there's no session object to work with either
        // way, so the login page is the only useful place to be.
        return navigateTo(loginUrl);
      }

      if (sessionTooOld(session)) {
        return client.auth.signOut().catch(function () { /* going anyway */ }).then(function () {
          forgetMfaTime();
          return navigateTo(loginUrl + '?expired=1');
        });
      }

      return client.auth.mfa.getAuthenticatorAssuranceLevel().then(function (levels) {
        var answered = levels && !levels.error && levels.data;
        if (answered && levels.data.currentLevel !== 'aal2') {
          return navigateTo(loginUrl); // a definite "not done yet"
        }
        return session; // done, or couldn't tell - see the note at the top
      }).catch(function () {
        return session;
      });
    });
  }

  // For pages that already do their own getSession() and just want the two
  // rules applied to the session they've got. Resolves true to carry on, or
  // false once it has started navigating away - so callers read as:
  //
  //   guardSession(client, session).then(function (ok) { if (!ok) return; ... })
  //
  // Passing the session is optional; without it only the 2FA rule is checked,
  // since there's no token to read the clock from.
  function guardSession(client, session, opts) {
    opts = opts || {};
    var loginUrl = opts.loginUrl || 'index.html';

    if (session && sessionTooOld(session)) {
      return client.auth.signOut().catch(function () { /* going anyway */ }).then(function () {
        forgetMfaTime();
        window.location.href = loginUrl + '?expired=1';
        return false;
      });
    }

    return client.auth.mfa.getAuthenticatorAssuranceLevel().then(function (levels) {
      var answered = levels && !levels.error && levels.data;
      if (answered && levels.data.currentLevel !== 'aal2') {
        window.location.href = loginUrl;
        return false;
      }
      return true;
    }).catch(function () {
      return true;
    });
  }

  window.HouseagoSession = {
    MAX_SESSION_AGE_MS: MAX_SESSION_AGE_MS,
    requireSession: requireSession,
    guardSession: guardSession,
    markMfaCompleted: markMfaCompleted,
    sessionTooOld: sessionTooOld,
    forgetMfaTime: forgetMfaTime
  };
})();
