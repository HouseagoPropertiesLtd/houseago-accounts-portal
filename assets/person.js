// Powers person.html: one person's General Documents, Bank Statements (by
// tax year), Investment & Dividend Returns, Employment (Payslips), and
// their own Receipts & Invoices, plus — for someone who can't see a
// property's Compliance & Tenancy or Insurance (the accountant today) —
// that property's Documents and Income & Outgoings, grouped in here
// instead of getting their own card on the dashboard (see PROPERTY_OWNERS
// below and the matching table in assets/auth.js, kept in sync by hand).
// Which person is driven by the "?id=" query string, matching one of the
// three keys in PEOPLE below — this table (unlike properties) is small and
// fixed on purpose, since a person's existing "finances" entity id (see
// baseEntityId) predates this page and isn't uniform enough to derive the
// others from automatically.
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

  var PEOPLE = [
    { key: 'oscar', label: 'Oscar', baseEntityId: 'oscar-sole-trader' },
    { key: 'sally', label: 'Sally', baseEntityId: 'sally-sole-trader' },
    { key: 'iris', label: 'Iris', baseEntityId: 'iris-houseago-finances' }
  ];

  // Which properties group under this person for someone who can't see
  // their Compliance & Tenancy or Insurance sections — kept in sync by
  // hand with the same table in assets/auth.js.
  var PROPERTIES_BY_PERSON = {
    oscar: ['3-horning-close', '33-north-denes'],
    sally: ['33-north-denes', 'wild-thyme'],
    iris: ['6-chaucer-street', '6a-chaucer-street']
  };

  // Every person has their own Receipts & Invoices entity — outgoings for
  // a nested property's Income & Outgoings are read across all three,
  // filtered to whichever submissions were linked to it (same idea as
  // property.js's own income chart).
  var RECEIPTS_ENTITY_IDS = ['oscar-receipts-invoices', 'sally-receipts-invoices', 'iris-receipts-invoices'];

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : str;
    return div.innerHTML;
  }

  function docIconSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  // UK tax year runs 6 April to 5 April, same cycle used for the financial
  // year on receipts.html — so "2025/26" here means 6 Apr 2025-5 Apr 2026.
  function currentTaxYearStart() {
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    return (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function taxYearOptionsHtml() {
    var startYear = currentTaxYearStart();
    var html = '<option value="">Not labelled</option>';
    for (var y = startYear + 1; y >= startYear - 7; y--) {
      var label = y + '/' + pad2((y + 1) % 100);
      html += '<option value="' + escapeHtml(label) + '">' + escapeHtml(label) + '</option>';
    }
    return html;
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var personKey = getQueryParam('id');
    var titleEl = document.getElementById('person-title');
    var notFoundEl = document.getElementById('person-not-found');
    var sectionsEl = document.getElementById('person-sections');

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (client) { client.auth.signOut().then(function () { window.location.href = 'index.html'; }); }
        else { window.location.href = 'index.html'; }
      });
    });

    var person = PEOPLE.filter(function (p) { return p.key === personKey; })[0];

    if (!person) {
      titleEl.textContent = 'Not found';
      sectionsEl.hidden = true;
      notFoundEl.hidden = false;
      return;
    }

    titleEl.textContent = person.label;
    document.title = person.label + ' | Houseago Asset Management';

    if (keysConfigured && !libraryLoaded) {
      sectionsEl.innerHTML = '<div class="entity-card"><p>The portal could not load just now. Please refresh the page and try again in a moment.</p></div>';
      return;
    }

    if (!client) {
      sectionsEl.innerHTML = '<div class="entity-card"><p>This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).</p></div>';
      return;
    }

    // 2FA is compulsory (see supabase-schema.sql) — a session that hasn't
    // completed a code challenge (never enrolled, or enrolled but not
    // challenged this sign-in) is sent back to index.html to sort that out
    // first, same check as dashboard.js/property.js, so reaching this page
    // directly with an old session can't skip it.
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
        loadPerson(person, session);
      });
    });

    function subEntitiesFor(person) {
      return [
        { id: person.baseEntityId, label: 'General Documents', taxYear: false, desc: 'Anything that doesn’t belong in one of the specific sections below — Self Assessment returns, sole trader accounts, and other financial documents included, not just non-financial paperwork.' },
        { id: person.key + '-bank-statements', label: 'Bank Statements', taxYear: true },
        { id: person.key + '-investment-dividends', label: 'Investment & Dividend Returns', taxYear: false },
        { id: person.key + '-employment-payslips', label: 'Employment (Payslips)', taxYear: false }
      ];
    }

    function loadPerson(person, session) {
      var subs = subEntitiesFor(person);
      var receiptsId = person.key + '-receipts-invoices';
      var ownedPropertyIds = PROPERTIES_BY_PERSON[person.key] || [];
      var propertyEntityIds = [];
      ownedPropertyIds.forEach(function (pid) { propertyEntityIds.push(pid, pid + '-income'); });

      var allIds = subs.map(function (s) { return s.id; }).concat([receiptsId]).concat(propertyEntityIds);

      Promise.all([
        client.from('entities').select('id, name').in('id', allIds),
        client.from('portal_access').select('entity_id, can_upload').in('entity_id', allIds)
      ]).then(function (results) {
        var entitiesResult = results[0], accessResult = results[1];

        if (accessResult.error) {
          titleEl.textContent = 'Not found';
          sectionsEl.hidden = true;
          notFoundEl.hidden = false;
          return;
        }

        var namesById = {};
        (entitiesResult.data || []).forEach(function (e) { namesById[e.id] = e.name; });

        var accessById = {};
        (accessResult.data || []).forEach(function (row) { accessById[row.entity_id] = row.can_upload; });

        var visibleSubs = subs.filter(function (s) { return accessById.hasOwnProperty(s.id); });
        var receiptsVisible = accessById.hasOwnProperty(receiptsId);
        var visibleProperties = ownedPropertyIds.filter(function (pid) {
          return accessById.hasOwnProperty(pid) || accessById.hasOwnProperty(pid + '-income');
        });

        if (visibleSubs.length === 0 && !receiptsVisible && visibleProperties.length === 0) {
          titleEl.textContent = 'Not found';
          sectionsEl.hidden = true;
          notFoundEl.hidden = false;
          return;
        }

        var personalHtml = visibleSubs.map(function (sub) {
          var canUpload = !!accessById[sub.id];
          var uploadBlock = canUpload ? uploadFormHtml(sub) : '';
          return (
            '<div class="entity-card">' +
              '<div class="section-head left"><h2>' + escapeHtml(sub.label) + '</h2></div>' +
              (sub.desc ? '<p>' + sub.desc + '</p>' : '') +
              (sub.taxYear ? '<p>Each submission can be labelled with the tax year it belongs to (6 April &ndash; 5 April), so a full year is easy to find later.</p>' : '') +
              '<div class="year-filter-row" data-year-filter="' + sub.id + '" hidden>' +
                '<label for="year-select-' + sub.id + '">' + (sub.taxYear ? 'Tax year' : 'Year') + '</label>' +
                '<select id="year-select-' + sub.id + '" data-year-select></select>' +
              '</div>' +
              '<div class="doc-list" data-doc-list="' + sub.id + '"><div class="doc-row"><div class="doc-row-main"><div>Loading documents&hellip;</div></div></div></div>' +
              uploadBlock +
            '</div>'
          );
        }).join('');

        var receiptsHtml = receiptsVisible ? personReceiptsCardHtml(person, !!accessById[receiptsId]) : '';

        var propertiesHtml = visibleProperties.map(function (pid) {
          return nestedPropertyHtml(pid, namesById, accessById);
        }).join('');

        sectionsEl.innerHTML = taxYearPackHtml() + personalHtml + receiptsHtml + propertiesHtml;

        var visibleIds = visibleSubs.map(function (s) { return s.id; });
        var propertyDocIds = visibleProperties.filter(function (pid) { return accessById.hasOwnProperty(pid); });
        var propertyIncomeIds = visibleProperties.filter(function (pid) { return accessById.hasOwnProperty(pid + '-income'); });
        var propertyIncomeEntityIds = propertyIncomeIds.map(function (pid) { return pid + '-income'; });

        loadDocuments(visibleIds.concat(propertyDocIds).concat(propertyIncomeEntityIds), accessById, session);

        visibleSubs.forEach(function (sub) {
          if (accessById[sub.id]) wireUploadForm(sub, session, person);
        });
        propertyDocIds.forEach(function (pid) {
          if (accessById[pid]) wireUploadForm({ id: pid, taxYear: false }, session, person);
        });
        propertyIncomeIds.forEach(function (pid) {
          var incomeId = pid + '-income';
          loadIncomeChart(incomeId, pid);
          if (accessById[incomeId]) {
            wireBankStatementScan(incomeId, session, person);
            wireIncomeEntryForm(incomeId, session, person);
          }
        });

        var packIds = visibleIds.concat(receiptsVisible ? [receiptsId] : []).concat(propertyDocIds).concat(propertyIncomeEntityIds);
        wireTaxYearPack(packIds, person.label);
      });
    }

    function personReceiptsCardHtml(person, canUpload) {
      var copy = canUpload
        ? 'Submit a receipt, invoice, or other piece of evidence, and optionally link it to a property or account. Everything submitted here is stored on its own page.'
        : 'Receipts, invoices, and other evidence submitted under ' + escapeHtml(person.label) + ', optionally linked to a property or account.';
      return (
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>Receipts &amp; Invoices</h2></div>' +
          '<p>' + copy + '</p>' +
          '<a href="receipts.html?owner=' + person.key + '" class="btn btn-primary">Open Receipts &amp; Invoices</a>' +
        '</div>'
      );
    }

    // --- Nested properties (Documents + Income & Outgoings only — no
    // Compliance & Tenancy or Insurance ever renders here; someone who can
    // see those gets the property's own page from the dashboard instead,
    // see assets/auth.js) -------------------------------------------------
    function nestedPropertyHtml(pid, namesById, accessById) {
      var name = namesById[pid] || namesById[pid + '-income'] || pid;
      var hasDocs = accessById.hasOwnProperty(pid);
      var hasIncome = accessById.hasOwnProperty(pid + '-income');
      var html = '';
      // Income & Outgoings first, so the financial ledger sits near the top —
      // same ordering as a property's own standalone page (property.js).
      if (hasIncome) {
        var incomeId = pid + '-income';
        var canAddIncome = !!accessById[incomeId];
        html +=
          '<div class="entity-card">' +
            '<div class="section-head left"><h2>' + escapeHtml(name) + ' &mdash; Income &amp; Outgoings</h2></div>' +
            '<p>A running total of rent received and money spent on this property — not a place to file documents. Most entries here are just a description, an amount, and a date.</p>' +
            '<div class="income-chart" data-income-chart="' + incomeId + '"></div>' +
            '<div class="year-filter-row" data-year-filter="' + incomeId + '" hidden>' +
              '<label for="year-select-' + incomeId + '">Year</label>' +
              '<select id="year-select-' + incomeId + '" data-year-select></select>' +
            '</div>' +
            '<div class="doc-list" data-doc-list="' + incomeId + '"><div class="doc-row"><div class="doc-row-main"><div>Loading&hellip;</div></div></div></div>' +
            (canAddIncome ? (bankStatementScanHtml(incomeId) + incomeEntryFormHtml(incomeId)) : '') +
          '</div>';
      }
      if (hasDocs) {
        var canUpload = !!accessById[pid];
        html +=
          '<div class="entity-card">' +
            '<div class="section-head left"><h2>' + escapeHtml(name) + ' &mdash; Documents</h2></div>' +
            '<p>General paperwork for this property — financial documents included, not just non-financial paperwork. For rent and other income, see Income &amp; Outgoings above.</p>' +
            '<div class="year-filter-row" data-year-filter="' + pid + '" hidden>' +
              '<label for="year-select-' + pid + '">Year</label>' +
              '<select id="year-select-' + pid + '" data-year-select></select>' +
            '</div>' +
            '<div class="doc-list" data-doc-list="' + pid + '"><div class="doc-row"><div class="doc-row-main"><div>Loading documents&hellip;</div></div></div></div>' +
            (canUpload ? uploadFormHtml({ id: pid, taxYear: false }) : '') +
          '</div>';
      }
      return html;
    }

    function incomeEntryFormHtml(entityId) {
      var currentYear = new Date().getFullYear();
      var yearOptions = '<option value="">Not labelled</option>';
      for (var y = currentYear + 1; y >= currentYear - 8; y--) yearOptions += '<option value="' + y + '">' + y + '</option>';
      return (
        '<form class="form-card income-form" data-income-entity="' + entityId + '">' +
          '<div class="section-subhead">Add an income entry by hand</div>' +
          '<div class="form-grid-2">' +
            '<div><label>Description</label><input type="text" name="name" required placeholder="e.g. Rent - Flat 2, March 2026"></div>' +
            '<div><label>Amount (£)</label><input type="number" step="0.01" min="0" name="amount" required></div>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div><label>Date</label><input type="date" name="doc_date"></div>' +
            '<div><label>Year (optional)</label><select name="year">' + yearOptions + '</select></div>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary">Add income entry</button>' +
          '<p class="form-status" role="status"></p>' +
        '</form>'
      );
    }

    function wireIncomeEntryForm(entityId, session, person) {
      var form = sectionsEl.querySelector('[data-income-entity="' + entityId + '"]');
      if (!form) return;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var name = form.querySelector('input[name="name"]').value.trim();
        var amount = parseFloat(form.querySelector('input[name="amount"]').value);
        var docDate = form.querySelector('input[name="doc_date"]').value;
        var year = form.querySelector('select[name="year"]').value;
        var status = form.querySelector('.form-status');
        if (!name || isNaN(amount)) return;

        client.from('entity_documents').insert({
          entity_id: entityId,
          name: name,
          amount: amount,
          doc_date: docDate || null,
          year: year || null,
          file_path: null,
          uploaded_by: session.user.id
        }).then(function (insertResult) {
          if (insertResult.error) { status.textContent = 'Could not add that entry. Please try again.'; return; }
          status.textContent = 'Added.';
          form.reset();
          loadPerson(person, session);
        });
      });
    }

    // Same first-pass bank statement scan as property.html's own Income &
    // Outgoings section (see assets/property.js) — the actual OCR/PDF text
    // reading and rent-line matching lives in assets/doc-scan.js, shared by
    // both, so a nested property here gets exactly the same tool a
    // full-access owner gets on that property's own page.
    function bankStatementScanHtml(entityId) {
      return (
        '<div class="form-card statement-scan" data-statement-scan="' + entityId + '">' +
          '<div class="section-subhead">Or scan a bank statement for rent payments</div>' +
          '<p>Upload a bank statement (PDF or photo) and this looks for lines mentioning &ldquo;rent&rdquo; alongside an amount, so you can add them as income entries without retyping every line. It is a first pass, not a real bank-statement reader — every suggestion is shown for you to check, edit, or discard before anything is saved, and nothing here reads or stores the statement itself, only what you choose to add below.</p>' +
          '<input type="file" accept="application/pdf,image/*" data-scan-file>' +
          '<p class="form-status" role="status" data-scan-status></p>' +
          '<div data-scan-results></div>' +
        '</div>'
      );
    }

    function wireBankStatementScan(entityId, session, person) {
      var panel = sectionsEl.querySelector('[data-statement-scan="' + entityId + '"]');
      if (!panel) return;
      var fileInput = panel.querySelector('[data-scan-file]');
      var status = panel.querySelector('[data-scan-status]');
      var results = panel.querySelector('[data-scan-results]');

      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        results.innerHTML = '';
        status.textContent = 'Reading statement…';

        window.HouseagoDocScan.extractTextFromFile(file).then(function (text) {
          var candidates = window.HouseagoDocScan.extractLikelyIncomeLines(text);
          if (candidates.length === 0) {
            status.textContent = 'No likely rent lines found — you can still add entries by hand below, or try a clearer copy of the statement.';
            return;
          }
          status.textContent = 'Found ' + candidates.length + ' possible rent line' + (candidates.length === 1 ? '' : 's') + ' — check each one, then add what looks right.';
          results.innerHTML = candidates.map(function (c, i) {
            return (
              '<div class="scan-candidate" data-candidate="' + i + '">' +
                '<input type="text" data-cand-desc value="' + escapeHtml(c.description) + '">' +
                '<input type="number" step="0.01" data-cand-amount value="' + c.amount + '">' +
                '<input type="text" data-cand-date placeholder="dd/mm/yyyy" value="' + escapeHtml(c.date) + '">' +
                '<button type="button" class="btn btn-outline" data-cand-add>Add as income</button>' +
              '</div>'
            );
          }).join('');

          results.querySelectorAll('[data-cand-add]').forEach(function (btn) {
            btn.addEventListener('click', function () {
              var row = btn.closest('[data-candidate]');
              var desc = row.querySelector('[data-cand-desc]').value.trim();
              var amount = parseFloat(row.querySelector('[data-cand-amount]').value);
              var dateStr = row.querySelector('[data-cand-date]').value.trim();
              if (!desc || isNaN(amount)) return;
              btn.disabled = true;
              btn.textContent = 'Adding…';
              client.from('entity_documents').insert({
                entity_id: entityId,
                name: desc,
                amount: amount,
                doc_date: window.HouseagoDocScan.parseLooseDate(dateStr),
                file_path: null,
                uploaded_by: session.user.id
              }).then(function (insertResult) {
                if (insertResult.error) { btn.disabled = false; btn.textContent = 'Add as income'; return; }
                row.remove();
                loadPerson(person, session);
              });
            });
          });
        }).catch(function () {
          status.textContent = 'Could not read that file. You can still add entries by hand below.';
        });
      });
    }

    function loadIncomeChart(entityId, propertyId) {
      var chartEl = sectionsEl.querySelector('[data-income-chart="' + entityId + '"]');
      if (!chartEl) return;
      Promise.all([
        client.from('entity_documents').select('amount, doc_date, year').eq('entity_id', entityId),
        client.from('entity_documents').select('amount, doc_date, year').in('entity_id', RECEIPTS_ENTITY_IDS).eq('related_entity_id', propertyId)
      ]).then(function (results) {
        var income = (results[0].data || []).filter(function (d) { return d.amount != null; });
        var outgoing = (results[1].data || []).filter(function (d) { return d.amount != null; });

        function yearOf(d) { return d.year || (d.doc_date ? d.doc_date.slice(0, 4) : null); }
        var years = {};
        income.concat(outgoing).forEach(function (d) { var y = yearOf(d); if (y) years[y] = true; });
        var yearList = Object.keys(years).sort().reverse();

        if (yearList.length === 0) {
          chartEl.innerHTML = '<p>No income or linked outgoings recorded yet.</p>';
          return;
        }

        chartEl.innerHTML = yearList.map(function (y) {
          var incomeTotal = income.filter(function (d) { return yearOf(d) === y; }).reduce(function (s, d) { return s + Number(d.amount); }, 0);
          var outgoingTotal = outgoing.filter(function (d) { return yearOf(d) === y; }).reduce(function (s, d) { return s + Number(d.amount); }, 0);
          var net = incomeTotal - outgoingTotal;
          return (
            '<div class="income-year-row">' +
              '<div class="income-year-label">' + escapeHtml(y) + '</div>' +
              '<div class="income-year-figures">' +
                '<span class="status-pill status-good">Income £' + incomeTotal.toFixed(2) + '</span>' +
                '<span class="status-pill status-warning">Outgoing £' + outgoingTotal.toFixed(2) + '</span>' +
                '<span class="status-pill ' + (net >= 0 ? 'status-good' : 'status-critical') + '">Net £' + net.toFixed(2) + '</span>' +
              '</div>' +
            '</div>'
          );
        }).join('');
      });
    }

    // --- Tax year pack -------------------------------------------------
    // Note: a Bank Statement's Year is a tax year label like "2025/26" while
    // every other section here uses a plain calendar year like "2026" — the
    // pack's Year dropdown lists whichever labels actually exist and bundles
    // an exact match, so picking "2025/26" only pulls in Bank Statements
    // (the only section that uses that label), and picking "2026" pulls in
    // everything else labelled that calendar year. Pick both if you want a
    // full tax year including bank statements.
    function taxYearPackHtml() {
      return (
        '<div class="entity-card tax-year-pack" data-pack-container>' +
          '<div class="section-head left"><h2>Tax year pack</h2></div>' +
          '<p>Bundle every document filed anywhere on this page under one year label into a single zip, ready to send to your accountant. Bank Statements are labelled by tax year (e.g. &ldquo;2025/26&rdquo;); everything else by calendar year — pick both if you need a full tax year including statements.</p>' +
          '<div class="form-grid-2">' +
            '<div><label>Year</label><select data-pack-year><option value="">Loading years&hellip;</option></select></div>' +
            '<div class="pack-download-wrap"><button type="button" class="btn btn-primary" data-pack-download disabled>Download tax year pack</button></div>' +
          '</div>' +
          '<p class="form-status" role="status" data-pack-status></p>' +
        '</div>'
      );
    }

    function wireTaxYearPack(visibleIds, personLabel) {
      var container = sectionsEl.querySelector('[data-pack-container]');
      if (!container) return;
      var yearSelect = container.querySelector('[data-pack-year]');
      var status = container.querySelector('[data-pack-status]');
      var downloadBtn = container.querySelector('[data-pack-download]');

      client.from('entity_documents').select('year').in('entity_id', visibleIds).then(function (result) {
        var years = [];
        (result.data || []).forEach(function (d) { if (d.year && years.indexOf(String(d.year)) === -1) years.push(String(d.year)); });
        years.sort().reverse();
        if (years.length === 0) {
          yearSelect.innerHTML = '<option value="">No labelled years yet</option>';
          return;
        }
        yearSelect.innerHTML = years.map(function (y) { return '<option value="' + escapeHtml(y) + '">' + escapeHtml(y) + '</option>'; }).join('');
        downloadBtn.disabled = false;
      });

      downloadBtn.addEventListener('click', function () {
        var year = yearSelect.value;
        if (!year) { status.textContent = 'Pick a year first.'; return; }
        if (typeof JSZip === 'undefined') { status.textContent = 'Could not build the pack right now — please refresh and try again.'; return; }

        downloadBtn.disabled = true;
        status.textContent = 'Building pack…';

        client.from('entity_documents').select('*').in('entity_id', visibleIds).eq('year', year).then(function (result) {
          var docs = (result.data || []).filter(function (d) { return d.file_path; });
          if (docs.length === 0) {
            status.textContent = 'No documents with a file are labelled ' + year + '.';
            downloadBtn.disabled = false;
            return;
          }

          var zip = new JSZip();
          Promise.all(docs.map(function (doc) {
            return client.storage.from('owner-documents').createSignedUrl(doc.file_path, 300).then(function (signedResult) {
              if (signedResult.error || !signedResult.data) return;
              return fetch(signedResult.data.signedUrl).then(function (r) { return r.blob(); }).then(function (blob) {
                var ext = (doc.file_path.match(/\.[a-zA-Z0-9]+$/) || [''])[0];
                var safeName = (doc.name || 'document').replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'document';
                zip.file(safeName + '-' + String(doc.id).slice(0, 8) + ext, blob);
              });
            });
          })).then(function () {
            return zip.generateAsync({ type: 'blob' });
          }).then(function (zipBlob) {
            var url = URL.createObjectURL(zipBlob);
            var a = document.createElement('a');
            a.href = url;
            a.download = (personLabel || 'Person').replace(/[^a-zA-Z0-9 _-]/g, '-') + '-' + year.replace('/', '-') + '-tax-year-pack.zip';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
            status.textContent = 'Downloaded ' + docs.length + ' document' + (docs.length === 1 ? '' : 's') + '.';
            downloadBtn.disabled = false;
          }).catch(function () {
            status.textContent = 'Something went wrong building the pack. Please try again.';
            downloadBtn.disabled = false;
          });
        });
      });
    }

    function uploadFormHtml(sub) {
      var yearOptions = sub.taxYear ? taxYearOptionsHtml() : plainYearOptionsHtml();
      var yearLabel = sub.taxYear ? 'Tax year (optional)' : 'Year (optional)';
      var namePlaceholder = sub.taxYear ? 'e.g. Current account - March 2026' : 'e.g. Dividend voucher - Q2 2026';
      return (
        '<form class="form-card upload-form" data-upload-entity="' + sub.id + '">' +
          '<div class="form-grid-2">' +
            '<div><label>Document name</label><input type="text" name="name" required placeholder="' + escapeHtml(namePlaceholder) + '"></div>' +
            '<div><label>Category (optional)</label><input type="text" name="category" placeholder="e.g. Filed 14 July 2026"></div>' +
          '</div>' +
          '<div class="form-grid-2">' +
            '<div><label>' + yearLabel + '</label><select name="year">' + yearOptions + '</select></div>' +
            '<div><label>Valid until (optional)</label><input type="date" name="valid_until"></div>' +
          '</div>' +
          window.HouseagoDocScan.captureFieldHtml({ label: 'File' }) +
          '<button type="submit" class="btn btn-primary">Upload document</button>' +
          '<p class="form-status" role="status"></p>' +
        '</form>'
      );
    }

    function plainYearOptionsHtml() {
      var currentYear = new Date().getFullYear();
      var html = '<option value="">Not labelled</option>';
      for (var y = currentYear + 1; y >= currentYear - 8; y--) html += '<option value="' + y + '">' + y + '</option>';
      return html;
    }

    function renderDocRow(doc, entityId, accessById, entityIds, session) {
      var isIncome = /-income$/.test(entityId);
      var metaBits = [];
      if (doc.category) metaBits.push(doc.category);
      if (isIncome && doc.amount != null) metaBits.push('£' + Number(doc.amount).toFixed(2));
      if (isIncome && doc.doc_date) metaBits.push(formatDate(doc.doc_date));
      if (doc.year) metaBits.push(doc.year);
      if (doc.valid_until) metaBits.push('Valid until ' + doc.valid_until);

      var row = document.createElement('div');
      row.className = 'doc-row';
      row.innerHTML =
        '<div class="doc-row-main">' +
          '<div class="doc-icon">' + docIconSvg() + '</div>' +
          '<div>' +
            '<div class="doc-name">' + escapeHtml(doc.name || 'Document') + '</div>' +
            '<div class="doc-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="doc-row-actions">' +
          (accessById[entityId] ? '<button type="button" class="btn-text" data-delete>Delete</button>' : '') +
          (doc.file_path ? '<a href="#" class="btn btn-outline">Download</a>' : '') +
        '</div>';

      var downloadLink = row.querySelector('a');
      if (downloadLink) {
        downloadLink.addEventListener('click', function (e) {
          e.preventDefault();
          client.storage.from('owner-documents').createSignedUrl(doc.file_path, 300).then(function (signedResult) {
            if (signedResult.error || !signedResult.data) { alert('This file could not be opened. Please try again.'); return; }
            window.open(signedResult.data.signedUrl, '_blank', 'noopener');
          });
        });
      }

      var deleteBtn = row.querySelector('[data-delete]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
          if (!window.confirm('Delete "' + doc.name + '"? This cannot be undone.')) return;
          var afterDelete = function () {
            client.from('entity_documents').delete().eq('id', doc.id).then(function () {
              loadDocuments(entityIds, accessById, session);
              if (isIncome) loadIncomeChart(entityId, entityId.replace(/-income$/, ''));
            });
          };
          if (doc.file_path) client.storage.from('owner-documents').remove([doc.file_path]).then(afterDelete);
          else afterDelete();
        });
      }
      return row;
    }

    function renderDocList(listEl, docs, selectedYear, entityId, accessById, entityIds, session) {
      var filtered = selectedYear ? docs.filter(function (doc) { return String(doc.year || '') === selectedYear; }) : docs;
      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>' +
          (selectedYear ? 'No documents labelled ' + escapeHtml(selectedYear) + '.' : 'No documents here yet.') +
          '</div></div></div>';
        return;
      }
      filtered.forEach(function (doc) { listEl.appendChild(renderDocRow(doc, entityId, accessById, entityIds, session)); });
    }

    function loadDocuments(entityIds, accessById, session) {
      client.from('entity_documents').select('*').in('entity_id', entityIds).order('created_at', { ascending: false }).then(function (result) {
        var byEntity = {};
        entityIds.forEach(function (id) { byEntity[id] = []; });
        if (!result.error) (result.data || []).forEach(function (doc) { if (byEntity[doc.entity_id]) byEntity[doc.entity_id].push(doc); });

        entityIds.forEach(function (entityId) {
          var listEl = sectionsEl.querySelector('[data-doc-list="' + entityId + '"]');
          if (!listEl) return;
          if (result.error) {
            listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>Could not load documents right now.</div></div></div>';
            return;
          }

          var docs = byEntity[entityId];
          var filterRow = sectionsEl.querySelector('[data-year-filter="' + entityId + '"]');
          var yearSelect = filterRow ? filterRow.querySelector('[data-year-select]') : null;
          var years = [];
          docs.forEach(function (doc) { if (doc.year && years.indexOf(String(doc.year)) === -1) years.push(String(doc.year)); });
          years.sort(function (a, b) { return b < a ? -1 : (b > a ? 1 : 0); });

          if (filterRow && yearSelect) {
            if (years.length > 0) {
              filterRow.hidden = false;
              yearSelect.innerHTML = '<option value="">All years</option>' + years.map(function (y) { return '<option value="' + escapeHtml(y) + '">' + escapeHtml(y) + '</option>'; }).join('');
              yearSelect.onchange = function () { renderDocList(listEl, docs, yearSelect.value, entityId, accessById, entityIds, session); };
            } else {
              filterRow.hidden = true;
            }
          }
          renderDocList(listEl, docs, yearSelect ? yearSelect.value : '', entityId, accessById, entityIds, session);
        });
      });
    }

    function wireUploadForm(sub, session, person) {
      var entityId = sub.id;
      var form = sectionsEl.querySelector('[data-upload-entity="' + entityId + '"]');
      if (!form) return;

      var capture = window.HouseagoDocScan.wireCaptureField(form, {
        dateInput: form.querySelector('input[name="valid_until"]')
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var file = capture.getFile();
        if (!file) { form.querySelector('.form-status').textContent = 'Please take a photo or choose a file first.'; return; }

        var name = form.querySelector('input[name="name"]').value.trim();
        var category = form.querySelector('input[name="category"]').value.trim();
        var year = form.querySelector('select[name="year"]').value;
        var validUntil = form.querySelector('input[name="valid_until"]').value;
        var status = form.querySelector('.form-status');
        var submitBtn = form.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        submitBtn.textContent = 'Uploading…';
        status.textContent = '';

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
              year: year || null,
              valid_until: validUntil || null,
              file_path: path,
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
              loadPerson(person, session);
            });
          });
        });
      });
    }
  });
})();
