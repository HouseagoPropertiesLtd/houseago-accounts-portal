// Powers asset-overview.html: a Xero-style, portfolio-wide summary — the
// page everyone lands on after logging in — separate from the
// document/asset pages (dashboard.html "Asset Overview", property.html,
// person.html). Nothing here lets you upload or edit anything; it only
// totals up and flags what's already been recorded elsewhere:
//
//   Financials —
//   - every property's own "-income" entity (its Income & Outgoings
//     ledger, entered on property.html — see loadIncomeChart there)
//   - Houseago Properties Ltd's own income entity (ltd-company-income),
//     which is where 3 Horning Close's rent goes, since that property is
//     owned by the Ltd company rather than any one person
//   - every Receipts & Invoices submission (Oscar's, Sally's, and Iris's),
//     which always counts as an outgoing here, same as it does on each
//     property's own page
//
//   Compliance & Tenancy —
//   - each property's own "-compliance-tenancy" entity, the same rows
//     property.html's own compliance status panel reads (see
//     complianceStatusFor there) — green/amber/red per tracked
//     certificate, worked out fresh from each one's valid_until date, so
//     it moves on its own as things approach or pass their renewal date,
//     with no separate flag to keep updated by hand.
//
// Row Level Security quietly limits every query below to whichever of
// these entities the signed-in viewer actually has access to — this file
// never has to work that out itself; a property or account someone can't
// see simply contributes nothing to the totals, with no error.
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

  function formatCurrency(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '£' + Math.abs(n).toFixed(2);
  }

  // Every property with its own Income & Outgoings ledger entity, plus the
  // Ltd company's (which is where 3 Horning Close's rent lives, since it's
  // company-owned rather than any one person's — see auth.js's
  // COMPANY_OWNED_PROPERTY_IDS / property.js's NESTED_COMPLIANCE_PROPERTIES_BY_COMPANY
  // for the same distinction made elsewhere on the site).
  var INCOME_SOURCES = [
    { entityId: '33-north-denes-income', propertyId: '33-north-denes', label: '33 North Denes' },
    { entityId: '6-chaucer-street-income', propertyId: '6-chaucer-street', label: '6 Chaucer Street' },
    { entityId: '6a-chaucer-street-income', propertyId: '6a-chaucer-street', label: '6a Chaucer Street' },
    { entityId: 'wild-thyme-income', propertyId: 'wild-thyme', label: 'Wild Thyme' },
    { entityId: 'ltd-company-income', propertyId: 'ltd-company', label: 'Houseago Properties Ltd (incl. 3 Horning Close)' }
  ];
  var INCOME_ENTITY_IDS = INCOME_SOURCES.map(function (s) { return s.entityId; });
  var LABEL_BY_PROPERTY_ID = {};
  INCOME_SOURCES.forEach(function (s) { LABEL_BY_PROPERTY_ID[s.propertyId] = s.label; });

  // Same three Receipts & Invoices entities used across property.html and
  // person.html — every submission there always counts as an outgoing.
  var RECEIPTS_ENTITY_IDS = ['oscar-receipts-invoices', 'sally-receipts-invoices', 'iris-receipts-invoices'];

  // ---- Compliance & Tenancy summary, one row per property -----------------
  // Every property that has its own Compliance & Tenancy entity — same five
  // as INCOME_SOURCES above, but keyed by that entity instead, since 3
  // Horning Close has no income entity of its own (see INCOME_SOURCES) but
  // does still have its own Compliance & Tenancy paperwork to track.
  var COMPLIANCE_PROPERTIES = [
    { id: '33-north-denes', label: '33 North Denes' },
    { id: '6-chaucer-street', label: '6 Chaucer Street' },
    { id: '6a-chaucer-street', label: '6a Chaucer Street' },
    { id: 'wild-thyme', label: 'Wild Thyme' },
    { id: '3-horning-close', label: '3 Horning Close' }
  ];
  var COMPLIANCE_TENANCY_ENTITY_IDS = COMPLIANCE_PROPERTIES.map(function (p) { return p.id + '-compliance-tenancy'; });

  // Same fixed set as property.js's own COMPLIANCE_TYPES (kept in sync by
  // hand, same as elsewhere on the site) — split into two groups for this
  // summary: the four with a genuine renewal date ("Compliance"), and the
  // three one-off tenancy documents with no fixed renewal ("Tenancy").
  var COMPLIANCE_GROUP_TYPES = ['gas_safety', 'eicr', 'epc', 'legionella'];
  var TENANCY_GROUP_TYPES = ['deposit_certificate', 'deposit_prescribed_info', 'inventory'];
  var EXPIRING_SOON_DAYS = 60;

  function daysUntil(dateStr) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var target = new Date(dateStr + 'T00:00:00');
    return Math.round((target - today) / 86400000);
  }

  // Same rule as property.js's complianceStatusFor: the most relevant
  // document for a tracked type (the one with the latest valid_until, or
  // failing that the most recently added) decides that type's status.
  function statusForType(docsForType) {
    if (!docsForType || docsForType.length === 0) return 'missing';
    var withDate = docsForType.filter(function (d) { return d.valid_until; });
    var doc = withDate.length > 0
      ? withDate.sort(function (a, b) { return b.valid_until.localeCompare(a.valid_until); })[0]
      : docsForType[0];
    if (!doc.valid_until) return 'undated';
    var daysLeft = daysUntil(doc.valid_until);
    if (daysLeft < 0) return 'expired';
    if (daysLeft <= EXPIRING_SOON_DAYS) return 'soon';
    return 'valid';
  }

  // ---- UK financial year grouping (6 April - 5 April), same rules as the
  // Receipts & Invoices chart (assets/receipts.js) so the two always agree.
  var FY_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  var MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function financialYearFor(iso) {
    if (!iso) return null;
    var parts = iso.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d) return null;
    var startYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
    return { startYear: startYear, label: startYear + '/' + pad2((startYear + 1) % 100) };
  }

  function yearOf(row) {
    if (row.doc_date) { var fy = financialYearFor(row.doc_date); if (fy) return fy; }
    if (row.year) { var y = parseInt(row.year, 10); if (y) return { startYear: y, label: y + '/' + pad2((y + 1) % 100) }; }
    return null;
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  // Same first-name heuristic as assets/auth.js (dashboard.html) — kept as
  // its own small copy here rather than shared, same as every other page.
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
    var statTilesEl = document.getElementById('fd-stat-tiles');
    var fySelect = document.getElementById('fd-fy-select');
    var categoryEl = document.getElementById('fd-category-breakdown');
    var propertyEl = document.getElementById('fd-property-breakdown');
    var trendEl = document.getElementById('fd-trend');
    var emptyEl = document.getElementById('fd-empty');
    var mainEl = document.getElementById('fd-main');
    var complianceCardEl = document.getElementById('fd-compliance-card');
    var complianceListEl = document.getElementById('fd-compliance-list');

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (client) { client.auth.signOut().then(function () { window.location.href = 'index.html'; }); }
        else { window.location.href = 'index.html'; }
      });
    });

    if (keysConfigured && !libraryLoaded) {
      if (mainEl) mainEl.innerHTML = '<div class="entity-card"><p>The portal could not load just now. Please refresh the page and try again in a moment.</p></div>';
      return;
    }

    if (!client) {
      if (mainEl) mainEl.innerHTML = '<div class="entity-card"><p>This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).</p></div>';
      return;
    }

    // 2FA is compulsory across the site (see supabase-schema.sql) — same
    // check as dashboard.html/property.html/person.html, so this page can't
    // be reached by URL alone without it either.
    function ensureAal2() {
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

    client.auth.getSession().then(function (result) {
      var session = result.data.session;
      if (!session) { window.location.href = 'index.html'; return; }
      ensureAal2().then(function (ok) {
        if (!ok) return;

        var userEmail = document.getElementById('portal-user-email');
        if (userEmail) userEmail.textContent = session.user.email;
        var firstName = firstNameFor(session.user);
        var welcomeName = document.getElementById('portal-welcome-name');
        if (welcomeName) welcomeName.textContent = firstName;
        var avatar = document.getElementById('portal-avatar');
        if (avatar) avatar.textContent = firstName.charAt(0).toUpperCase();

        loadFinancials();
        loadCompliance();
      });
    });

    function loadCompliance() {
      if (!complianceCardEl || !complianceListEl) return;
      // Same two-step shape as auth.js's loadEntities: work out which of
      // these entities the viewer actually has a portal_access row for
      // first, so a property they can't see is left off the list entirely
      // rather than shown as "needs review" with nothing to back it up —
      // and so a property they CAN see but hasn't uploaded anything for
      // yet still shows up, correctly, as missing everything.
      client.from('portal_access').select('entity_id').in('entity_id', COMPLIANCE_TENANCY_ENTITY_IDS)
        .then(function (accessResult) {
          var accessibleIds = (accessResult.data || []).map(function (row) { return row.entity_id; });
          var properties = COMPLIANCE_PROPERTIES.filter(function (p) { return accessibleIds.indexOf(p.id + '-compliance-tenancy') !== -1; });
          if (properties.length === 0) { complianceCardEl.hidden = true; return; }

          client.from('entity_documents').select('entity_id, compliance_type, valid_until')
            .in('entity_id', properties.map(function (p) { return p.id + '-compliance-tenancy'; }))
            .then(function (docsResult) {
              var docs = (docsResult.data || []).filter(function (d) { return d.compliance_type; });

              complianceListEl.innerHTML = properties.map(function (p) {
                var entityId = p.id + '-compliance-tenancy';
                var byType = {};
                docs.filter(function (d) { return d.entity_id === entityId; }).forEach(function (d) {
                  (byType[d.compliance_type] = byType[d.compliance_type] || []).push(d);
                });

                var complianceStatuses = COMPLIANCE_GROUP_TYPES.map(function (t) { return statusForType(byType[t]); });
                var tenancyStatuses = TENANCY_GROUP_TYPES.map(function (t) { return statusForType(byType[t]); });

                // "Needs review"/"needs completing" the moment anything is
                // missing, expired, or due within the same 60-day window
                // property.html's own panel uses — "on file, no date given"
                // (undated) doesn't trigger a flag, same as there, since a
                // document does exist, just with nothing to track.
                var complianceOk = complianceStatuses.every(function (s) { return s === 'valid' || s === 'undated'; });
                var tenancyOk = tenancyStatuses.every(function (s) { return s === 'valid' || s === 'undated'; });

                return (
                  '<div class="compliance-row">' +
                    '<div><div class="compliance-name">' + escapeHtml(p.label) + '</div>' +
                    '<div class="compliance-hint">Gas safety, EICR, EPC, legionella &middot; deposit protection &amp; inventory</div></div>' +
                    '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
                      '<span class="status-pill ' + (complianceOk ? 'status-good' : 'status-critical') + '">Compliance: ' + (complianceOk ? 'Fully compliant' : 'Needs review') + '</span>' +
                      '<span class="status-pill ' + (tenancyOk ? 'status-good' : 'status-warning') + '">Tenancy: ' + (tenancyOk ? 'Complete' : 'Needs completing') + '</span>' +
                    '</div>' +
                  '</div>'
                );
              }).join('');
              complianceCardEl.hidden = false;
            });
        }).catch(function () {
          complianceCardEl.hidden = true;
        });
    }

    function loadFinancials() {
      Promise.all([
        client.from('entity_documents')
          .select('amount, doc_date, year, entry_type, entity_id, expense_category')
          .in('entity_id', INCOME_ENTITY_IDS),
        client.from('entity_documents')
          .select('amount, doc_date, year, related_entity_id, expense_category')
          .in('entity_id', RECEIPTS_ENTITY_IDS)
      ]).then(function (results) {
        var ownRows = (results[0].data || []).filter(function (d) { return d.amount != null; });
        var receiptRows = (results[1].data || []).filter(function (d) { return d.amount != null; });

        // Normalise everything to one shape: { amount, type, propertyId, category, fy }
        var rows = [];
        ownRows.forEach(function (d) {
          var propertyId = d.entity_id.replace(/-income$/, '');
          rows.push({
            amount: Number(d.amount),
            type: d.entry_type === 'Outgoing' ? 'Outgoing' : 'Income',
            propertyId: propertyId,
            category: d.expense_category || null,
            fy: yearOf(d)
          });
        });
        receiptRows.forEach(function (d) {
          rows.push({
            amount: Number(d.amount),
            type: 'Outgoing',
            propertyId: d.related_entity_id || 'general',
            category: d.expense_category || null,
            fy: yearOf(d)
          });
        });

        if (rows.length === 0) {
          if (emptyEl) emptyEl.hidden = false;
          if (mainEl) mainEl.hidden = true;
          return;
        }
        if (emptyEl) emptyEl.hidden = true;
        if (mainEl) mainEl.hidden = false;

        renderPage(rows);
      }).catch(function () {
        if (mainEl) mainEl.innerHTML = '<div class="entity-card"><p>Could not load your asset summary just now. Please refresh and try again.</p></div>';
      });
    }

    function renderPage(rows) {
      // One entry per financial year that has at least one dated row.
      var byYear = {};
      rows.forEach(function (r) {
        if (!r.fy) return;
        var key = r.fy.startYear;
        if (!byYear[key]) byYear[key] = { startYear: key, label: r.fy.label, rows: [] };
        byYear[key].rows.push(r);
      });
      var years = Object.keys(byYear).map(function (k) { return byYear[k]; }).sort(function (a, b) { return b.startYear - a.startYear; });

      if (years.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        if (mainEl) mainEl.hidden = true;
        return;
      }

      fySelect.innerHTML = years.map(function (y) {
        return '<option value="' + y.startYear + '">' + escapeHtml(y.label) + '</option>';
      }).join('');
      fySelect.value = String(years[0].startYear);

      function renderForYear(startYear) {
        var yearEntry = byYear[startYear] || { rows: [] };
        var yearRows = yearEntry.rows;
        var income = yearRows.filter(function (r) { return r.type === 'Income'; }).reduce(function (s, r) { return s + r.amount; }, 0);
        var outgoing = yearRows.filter(function (r) { return r.type === 'Outgoing'; }).reduce(function (s, r) { return s + r.amount; }, 0);
        var net = income - outgoing;

        statTilesEl.innerHTML =
          '<div class="stat-tile"><div class="stat-tile-label">Total income</div><div class="stat-tile-value positive">' + escapeHtml(formatCurrency(income)) + '</div></div>' +
          '<div class="stat-tile"><div class="stat-tile-label">Total expenses</div><div class="stat-tile-value negative">' + escapeHtml(formatCurrency(outgoing)) + '</div></div>' +
          '<div class="stat-tile"><div class="stat-tile-label">Net profit</div><div class="stat-tile-value ' + (net >= 0 ? 'positive' : 'negative') + '">' + escapeHtml(formatCurrency(net)) + '</div></div>';

        // Category breakdown, outgoings only — uncategorised grouped at the end.
        var catTotals = {};
        yearRows.filter(function (r) { return r.type === 'Outgoing'; }).forEach(function (r) {
          var cat = r.category || 'Uncategorised';
          catTotals[cat] = (catTotals[cat] || 0) + r.amount;
        });
        var catRows = Object.keys(catTotals)
          .map(function (cat) { return { category: cat, total: catTotals[cat] }; })
          .sort(function (a, b) {
            if (a.category === 'Uncategorised') return 1;
            if (b.category === 'Uncategorised') return -1;
            return b.total - a.total;
          });
        categoryEl.innerHTML = catRows.length === 0 ? '<p>No expenses recorded for this financial year yet.</p>' :
          '<div class="category-breakdown-title">Expenses by category</div>' +
          catRows.map(function (r) {
            return '<div class="category-row"><span>' + escapeHtml(r.category) + '</span><span>' + escapeHtml(formatCurrency(r.total)) + '</span></div>';
          }).join('');

        // Per-property breakdown, income/outgoing/net, this financial year.
        var byProperty = {};
        yearRows.forEach(function (r) {
          var key = r.propertyId || 'general';
          if (!byProperty[key]) byProperty[key] = { income: 0, outgoing: 0 };
          if (r.type === 'Income') byProperty[key].income += r.amount;
          else byProperty[key].outgoing += r.amount;
        });
        var propertyKeys = Object.keys(byProperty).sort(function (a, b) {
          return (byProperty[b].income + byProperty[b].outgoing) - (byProperty[a].income + byProperty[a].outgoing);
        });
        propertyEl.innerHTML = propertyKeys.length === 0 ? '<p>Nothing recorded for this financial year yet.</p>' :
          propertyKeys.map(function (key) {
            var p = byProperty[key];
            var label = LABEL_BY_PROPERTY_ID[key] || (key === 'general' ? 'General / Other (not linked to a property)' : key);
            var pnet = p.income - p.outgoing;
            return (
              '<div class="income-year-row">' +
                '<div class="income-year-label">' + escapeHtml(label) + '</div>' +
                '<div class="income-year-figures">' +
                  '<span class="status-pill status-good">Income £' + p.income.toFixed(2) + '</span>' +
                  '<span class="status-pill status-warning">Outgoing £' + p.outgoing.toFixed(2) + '</span>' +
                  '<span class="status-pill ' + (pnet >= 0 ? 'status-good' : 'status-critical') + '">Net £' + pnet.toFixed(2) + '</span>' +
                '</div>' +
              '</div>'
            );
          }).join('');
      }

      renderForYear(years[0].startYear);
      fySelect.addEventListener('change', function () { renderForYear(parseInt(fySelect.value, 10)); });

      // Trend across every financial year on record, most recent first —
      // the same shape as each property's own Income & Outgoings chart
      // (property.js's loadIncomeChart), just totalled across the whole
      // portfolio rather than one property at a time.
      trendEl.innerHTML = years.map(function (y) {
        var income = y.rows.filter(function (r) { return r.type === 'Income'; }).reduce(function (s, r) { return s + r.amount; }, 0);
        var outgoing = y.rows.filter(function (r) { return r.type === 'Outgoing'; }).reduce(function (s, r) { return s + r.amount; }, 0);
        var net = income - outgoing;
        return (
          '<div class="income-year-row">' +
            '<div class="income-year-label">' + escapeHtml(y.label) + '</div>' +
            '<div class="income-year-figures">' +
              '<span class="status-pill status-good">Income £' + income.toFixed(2) + '</span>' +
              '<span class="status-pill status-warning">Outgoing £' + outgoing.toFixed(2) + '</span>' +
              '<span class="status-pill ' + (net >= 0 ? 'status-good' : 'status-critical') + '">Net £' + net.toFixed(2) + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }
  });
})();
