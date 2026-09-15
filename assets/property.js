// Powers property.html: one property's Documents (general paperwork,
// compliance certificates, and insurance, all pooled into one list with a
// Type tag) and its Income & Outgoings ledger, all on one page — just two
// upload points, kept simple on purpose. Which property is entirely driven
// by the "?id=" query string — e.g. property.html?id=33-north-denes —
// matching that entity's own id, so adding a brand new property is still
// just rows in Supabase (see SETUP.md); nothing here hardcodes a
// property's name or id.
//
// Under the hood, Documents/Compliance & Tenancy/Insurance stay three
// separate database entities with their own access rows — that's what lets
// someone (the accountant, say) be granted the general Documents and
// Income & Outgoings but excluded from Compliance & Tenancy and Insurance
// entirely. Only the on-page presentation merges them into one card; a
// viewer only ever sees documents from the entities they actually have
// access to, and only ever gets a "Type" choice among those.
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

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function docIconSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  }

  // Same fixed set of certificates/assessments as SETUP.md documents, kept
  // in sync by hand with the copy in assets/auth.js (which only needs the
  // labels, for the dashboard-wide "expiring soon" banner). The first four
  // have a genuine renewal date and get the full green/amber/red tracking
  // below; the last three (deposit certificate, prescribed information,
  // inventory) are one-off paperwork issued at the start of a tenancy with
  // no fixed renewal — tagging them here just gives them their own place
  // in the Type dropdown and the status panel below shows them as "On
  // file" or "Not on file yet" rather than a real expiry countdown.
  var COMPLIANCE_TYPES = [
    { id: 'gas_safety', label: 'Gas Safety Certificate (CP12)', hint: 'renews annually' },
    { id: 'eicr', label: 'Electrical Installation Condition Report (EICR)', hint: 'renews at least every 5 years' },
    { id: 'epc', label: 'Energy Performance Certificate (EPC)', hint: 'valid for 10 years' },
    { id: 'legionella', label: 'Legionella Risk Assessment', hint: 'review at least every 2 years' },
    { id: 'deposit_certificate', label: 'Deposit Protection Certificate', hint: 'issued once per tenancy, no fixed renewal' },
    { id: 'deposit_prescribed_info', label: 'Deposit — Prescribed Information', hint: 'issued once per tenancy, no fixed renewal' },
    { id: 'inventory', label: 'Inventory / Schedule of Condition', hint: 'done at the start (and end) of each tenancy, no fixed renewal' }
  ];
  var EXPIRING_SOON_DAYS = 60;

  function daysUntil(dateStr) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var target = new Date(dateStr + 'T00:00:00');
    return Math.round((target - today) / 86400000);
  }

  function complianceStatusFor(docsForType) {
    if (!docsForType || docsForType.length === 0) return { status: 'missing' };
    var withDate = docsForType.filter(function (d) { return d.valid_until; });
    var doc = withDate.length > 0
      ? withDate.sort(function (a, b) { return b.valid_until.localeCompare(a.valid_until); })[0]
      : docsForType.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); })[0];
    if (!doc.valid_until) return { status: 'undated', doc: doc };
    var daysLeft = daysUntil(doc.valid_until);
    if (daysLeft < 0) return { status: 'expired', doc: doc, daysLeft: daysLeft };
    if (daysLeft <= EXPIRING_SOON_DAYS) return { status: 'soon', doc: doc, daysLeft: daysLeft };
    return { status: 'valid', doc: doc, daysLeft: daysLeft };
  }

  function complianceStatusHtml(type, result) {
    var text, cls;
    switch (result.status) {
      case 'expired': text = 'Expired ' + formatDate(result.doc.valid_until); cls = 'critical'; break;
      case 'soon': text = result.daysLeft === 0 ? 'Expires today' : 'Expires in ' + result.daysLeft + ' day' + (result.daysLeft === 1 ? '' : 's'); cls = 'warning'; break;
      case 'valid': text = 'Valid until ' + formatDate(result.doc.valid_until); cls = 'good'; break;
      case 'undated': text = 'On file, no expiry date given'; cls = 'neutral'; break;
      default: text = 'Not on file yet'; cls = 'missing';
    }
    return (
      '<div class="compliance-row">' +
        '<div><div class="compliance-name">' + escapeHtml(type.label) + '</div><div class="compliance-hint">' + escapeHtml(type.hint) + '</div></div>' +
        '<span class="status-pill status-' + cls + '">' + escapeHtml(text) + '</span>' +
      '</div>'
    );
  }

  function complianceTypeLabel(id) {
    var match = COMPLIANCE_TYPES.filter(function (t) { return t.id === id; })[0];
    return match ? match.label : null;
  }

  // Which underlying entity a merged Documents-card row actually came from —
  // shown as a "Type" tag so the merge doesn't hide where something lives.
  function docTypeLabel(entityId) {
    if (/-compliance-tenancy$/.test(entityId)) return 'Compliance & Tenancy';
    if (/-insurance$/.test(entityId)) return 'Insurance';
    return 'General';
  }

  // Every entity id used on this page is "<propertyId><suffix>" — strip the
  // known suffixes to get back to the property id, e.g. for reloading the
  // whole page after a delete.
  function basePropertyId(entityId) {
    return entityId.replace(/-compliance-tenancy$/, '').replace(/-insurance$/, '').replace(/-income$/, '');
  }

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var propertyId = getQueryParam('id');
    var titleEl = document.getElementById('property-title');
    var notFoundEl = document.getElementById('property-not-found');
    var sectionsEl = document.getElementById('property-sections');

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (client) { client.auth.signOut().then(function () { window.location.href = 'index.html'; }); }
        else { window.location.href = 'index.html'; }
      });
    });

    if (!propertyId) {
      titleEl.textContent = 'Property not found';
      sectionsEl.hidden = true;
      notFoundEl.hidden = false;
      return;
    }

    if (keysConfigured && !libraryLoaded) {
      sectionsEl.innerHTML = '<div class="entity-card"><p>The portal could not load just now. Please refresh the page and try again in a moment.</p></div>';
      return;
    }

    if (!client) {
      titleEl.textContent = 'Property';
      sectionsEl.innerHTML = '<div class="entity-card"><p>This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).</p></div>';
      return;
    }

    // 2FA is compulsory (see supabase-schema.sql) — a session that hasn't
    // completed a code challenge (never enrolled, or enrolled but not
    // challenged this sign-in) is sent back to index.html to sort that out
    // first, same check as dashboard.js/person.js, so reaching this page
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
        loadProperty(propertyId, session);
      });
    });

    // The three document-type entities (merged into one "Documents" card on
    // screen) plus the income ledger. Kept as separate database entities —
    // see the file header comment for why.
    var SUB_ENTITIES = [
      { suffix: '', label: 'General', kind: 'plain' },
      { suffix: '-compliance-tenancy', label: 'Compliance & Tenancy', kind: 'compliance' },
      { suffix: '-insurance', label: 'Insurance', kind: 'plain' },
      { suffix: '-income', label: 'Income & Outgoings', kind: 'income' }
    ];
    var DOC_SUBS = SUB_ENTITIES.filter(function (s) { return s.kind !== 'income'; });
    var INCOME_SUB = SUB_ENTITIES.filter(function (s) { return s.kind === 'income'; })[0];

    function loadProperty(propertyId, session) {
      var ids = SUB_ENTITIES.map(function (s) { return propertyId + s.suffix; });

      Promise.all([
        client.from('entities').select('id, name').in('id', ids),
        client.from('portal_access').select('entity_id, can_upload').in('entity_id', ids)
      ]).then(function (results) {
        var entitiesResult = results[0], accessResult = results[1];

        if (entitiesResult.error || accessResult.error || !entitiesResult.data || entitiesResult.data.length === 0) {
          titleEl.textContent = 'Property not found';
          sectionsEl.hidden = true;
          notFoundEl.hidden = false;
          return;
        }

        var namesById = {};
        entitiesResult.data.forEach(function (e) { namesById[e.id] = e.name; });

        var accessById = {};
        (accessResult.data || []).forEach(function (row) { accessById[row.entity_id] = row.can_upload; });

        var visibleSubs = SUB_ENTITIES.filter(function (s) { return accessById.hasOwnProperty(propertyId + s.suffix); });

        if (visibleSubs.length === 0) {
          titleEl.textContent = 'Property not found';
          sectionsEl.hidden = true;
          notFoundEl.hidden = false;
          return;
        }

        var baseName = namesById[propertyId] || (namesById[propertyId + '-compliance-tenancy'] || '').replace(/ - Compliance.*$/, '') || (namesById[propertyId + '-insurance'] || '').replace(/ - Insurance.*$/, '') || propertyId;
        titleEl.textContent = baseName;
        document.title = baseName + ' | Houseago Asset Management';

        var visibleDocSubs = DOC_SUBS.filter(function (s) { return accessById.hasOwnProperty(propertyId + s.suffix); });
        var incomeEntityId = propertyId + INCOME_SUB.suffix;
        var hasIncome = accessById.hasOwnProperty(incomeEntityId);

        var packHtml = taxYearPackHtml();
        var incomeHtml = hasIncome ? incomeCardHtml(incomeEntityId, !!accessById[incomeEntityId]) : '';
        var documentsHtml = visibleDocSubs.length > 0 ? documentsCardHtml(propertyId, visibleDocSubs, accessById) : '';

        // Income & Outgoings before Documents: the financial ledger sits
        // right near the top, not buried under everything else.
        sectionsEl.innerHTML = packHtml + incomeHtml + documentsHtml;

        var visibleIds = visibleSubs.map(function (s) { return propertyId + s.suffix; });
        var docEntityIds = visibleDocSubs.map(function (s) { return propertyId + s.suffix; });
        loadDocuments(visibleIds, accessById, session, propertyId, docEntityIds);

        if (hasIncome) {
          if (accessById[incomeEntityId]) {
            wireIncomeEntryForm(incomeEntityId, session, propertyId);
            wireBankStatementScan(incomeEntityId, session, propertyId);
          }
          loadIncomeChart(incomeEntityId, propertyId, session);
        }

        var uploadableDocSubs = visibleDocSubs.filter(function (s) { return accessById[propertyId + s.suffix]; });
        if (uploadableDocSubs.length > 0) wireUploadForm(propertyId, uploadableDocSubs, session);

        wireTaxYearPack(visibleIds, baseName);
      });
    }

    // --- Tax year pack -------------------------------------------------
    function taxYearPackHtml() {
      return (
        '<div class="entity-card tax-year-pack" data-pack-container>' +
          '<div class="section-head left"><h2>Tax year pack</h2></div>' +
          '<p>Bundle every document filed anywhere on this page for one year — Documents (general, compliance, and insurance) and Income &amp; Outgoings — into a single zip, ready to send to your accountant.</p>' +
          '<div class="form-grid-2">' +
            '<div><label>Year</label><select data-pack-year><option value="">Loading years&hellip;</option></select></div>' +
            '<div class="pack-download-wrap"><button type="button" class="btn btn-primary" data-pack-download disabled>Download tax year pack</button></div>' +
          '</div>' +
          '<p class="form-status" role="status" data-pack-status></p>' +
        '</div>'
      );
    }

    function wireTaxYearPack(visibleIds, baseName) {
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
            a.download = (baseName || 'Property').replace(/[^a-zA-Z0-9 _-]/g, '-') + '-' + year + '-tax-year-pack.zip';
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

    // --- Documents (merged Documents / Compliance & Tenancy / Insurance) --

    function documentsCardHtml(propertyId, visibleDocSubs, accessById) {
      var hasCompliance = visibleDocSubs.some(function (s) { return s.suffix === '-compliance-tenancy'; });
      var complianceEntityId = propertyId + '-compliance-tenancy';
      var uploadableDocSubs = visibleDocSubs.filter(function (s) { return accessById[propertyId + s.suffix]; });
      var listKey = propertyId + '-documents';
      return (
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>Documents</h2></div>' +
          '<p>Everything filed for this property in one place — the purchase contract, a mortgage statement, tenancy paperwork, compliance certificates, insurance policies, correspondence, or anything else (financial documents belong here too — it isn’t just non-financial paperwork). Records of rent live separately, in Income &amp; Outgoings above.' +
            (uploadableDocSubs.length > 1 ? ' Pick a type when you upload so it ends up in the right place.' : '') +
          '</p>' +
          (hasCompliance ? '<div class="compliance-status" data-compliance-status="' + complianceEntityId + '"></div>' : '') +
          '<div class="year-filter-row" data-year-filter="' + listKey + '" hidden>' +
            '<label for="year-select-' + listKey + '">Year</label>' +
            '<select id="year-select-' + listKey + '" data-year-select></select>' +
          '</div>' +
          '<div class="doc-list" data-doc-list="' + listKey + '"><div class="doc-row"><div class="doc-row-main"><div>Loading documents&hellip;</div></div></div></div>' +
          (uploadableDocSubs.length > 0 ? uploadFormHtml(propertyId, uploadableDocSubs) : '') +
        '</div>'
      );
    }

    function uploadFormHtml(propertyId, uploadableDocSubs) {
      var currentYear = new Date().getFullYear();
      var yearOptions = '<option value="">Not labelled</option>';
      for (var y = currentYear + 1; y >= currentYear - 8; y--) {
        yearOptions += '<option value="' + y + '">' + y + '</option>';
      }

      var hasCompliance = uploadableDocSubs.some(function (s) { return s.suffix === '-compliance-tenancy'; });
      var multipleTypes = uploadableDocSubs.length > 1;

      var typeField = multipleTypes
        ? '<div><label>Type</label><select name="doc_type" data-doc-type>' +
            uploadableDocSubs.map(function (s) { return '<option value="' + escapeHtml(s.suffix) + '">' + escapeHtml(s.label) + '</option>'; }).join('') +
          '</select></div>'
        : '<input type="hidden" name="doc_type" value="' + escapeHtml(uploadableDocSubs[0].suffix) + '">';

      var complianceField = hasCompliance
        ? '<div data-compliance-field' + (multipleTypes ? ' hidden' : '') + '><label>Is this one of the tracked certificates?</label><select name="compliance_type">' +
            '<option value="">No — general document (tenancy agreement, etc.)</option>' +
            COMPLIANCE_TYPES.map(function (t) { return '<option value="' + t.id + '">' + escapeHtml(t.label) + '</option>'; }).join('') +
          '</select></div>'
        : '';

      return (
        '<form class="form-card upload-form" data-upload-property="' + propertyId + '">' +
          '<div class="form-grid-2">' +
            '<div><label>Document name</label><input type="text" name="name" required placeholder="e.g. Company Accounts 2026"></div>' +
            '<div><label>Category (optional)</label><input type="text" name="category" placeholder="e.g. Filed 14 July 2026"></div>' +
          '</div>' +
          typeField +
          complianceField +
          '<div class="form-grid-2">' +
            '<div><label>Year (optional)</label><select name="year">' + yearOptions + '</select></div>' +
            '<div><label>Valid until (required for a tracked compliance certificate, optional otherwise)</label><input type="date" name="valid_until"></div>' +
          '</div>' +
          window.HouseagoDocScan.captureFieldHtml({ label: 'File' }) +
          '<button type="submit" class="btn btn-primary">Upload document</button>' +
          '<p class="form-status" role="status"></p>' +
        '</form>'
      );
    }

    function wireUploadForm(propertyId, uploadableDocSubs, session) {
      var form = sectionsEl.querySelector('[data-upload-property="' + propertyId + '"]');
      if (!form) return;

      var capture = window.HouseagoDocScan.wireCaptureField(form, {
        dateInput: form.querySelector('input[name="valid_until"]')
      });

      var typeSelect = form.querySelector('[data-doc-type]');
      var complianceFieldWrap = form.querySelector('[data-compliance-field]');
      function syncComplianceVisibility() {
        if (!complianceFieldWrap) return;
        var suffix = typeSelect ? typeSelect.value : uploadableDocSubs[0].suffix;
        complianceFieldWrap.hidden = suffix !== '-compliance-tenancy';
      }
      if (typeSelect) { typeSelect.addEventListener('change', syncComplianceVisibility); }
      syncComplianceVisibility();

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var file = capture.getFile();
        if (!file) { form.querySelector('.form-status').textContent = 'Please take a photo or choose a file first.'; return; }

        var suffix = form.querySelector('[name="doc_type"]').value;
        var entityId = propertyId + suffix;
        var name = form.querySelector('input[name="name"]').value.trim();
        var category = form.querySelector('input[name="category"]').value.trim();
        var year = form.querySelector('select[name="year"]').value;
        var validUntil = form.querySelector('input[name="valid_until"]').value;
        var complianceField = form.querySelector('select[name="compliance_type"]');
        var complianceType = (complianceField && suffix === '-compliance-tenancy') ? (complianceField.value || null) : null;
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
              compliance_type: complianceType,
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
              loadProperty(propertyId, session);
            });
          });
        });
      });
    }

    function renderComplianceStatus(entityId, docs) {
      var panel = sectionsEl.querySelector('[data-compliance-status="' + entityId + '"]');
      if (!panel) return;
      var byType = {};
      docs.forEach(function (doc) { if (doc.compliance_type) { (byType[doc.compliance_type] = byType[doc.compliance_type] || []).push(doc); } });
      panel.innerHTML = COMPLIANCE_TYPES.map(function (type) {
        return complianceStatusHtml(type, complianceStatusFor(byType[type.id]));
      }).join('');
    }

    function renderDocRow(doc, accessById, session, showType) {
      var entityId = doc.entity_id;
      var isIncome = /-income$/.test(entityId);
      var metaBits = [];
      if (showType) metaBits.push(docTypeLabel(entityId));
      if (doc.compliance_type) metaBits.push(complianceTypeLabel(doc.compliance_type) || doc.compliance_type);
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
              loadProperty(basePropertyId(entityId), session);
            });
          };
          if (doc.file_path) client.storage.from('owner-documents').remove([doc.file_path]).then(afterDelete);
          else afterDelete();
        });
      }
      return row;
    }

    function renderDocList(listEl, docs, selectedYear, accessById, session, showType) {
      var filtered = selectedYear ? docs.filter(function (doc) { return String(doc.year || '') === selectedYear; }) : docs;
      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>' +
          (selectedYear ? 'No documents labelled ' + escapeHtml(selectedYear) + '.' : 'No documents here yet.') +
          '</div></div></div>';
        return;
      }
      filtered.forEach(function (doc) { listEl.appendChild(renderDocRow(doc, accessById, session, showType)); });
    }

    function renderEntityDocList(listKey, docs, hadError, accessById, session, showType) {
      var listEl = sectionsEl.querySelector('[data-doc-list="' + listKey + '"]');
      if (!listEl) return;
      if (hadError) {
        listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>Could not load documents right now.</div></div></div>';
        return;
      }

      var filterRow = sectionsEl.querySelector('[data-year-filter="' + listKey + '"]');
      var yearSelect = filterRow ? filterRow.querySelector('[data-year-select]') : null;
      var years = [];
      docs.forEach(function (doc) { if (doc.year && years.indexOf(String(doc.year)) === -1) years.push(String(doc.year)); });
      years.sort(function (a, b) { return b - a; });

      if (filterRow && yearSelect) {
        if (years.length > 0) {
          filterRow.hidden = false;
          yearSelect.innerHTML = '<option value="">All years</option>' + years.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
          yearSelect.onchange = function () { renderDocList(listEl, docs, yearSelect.value, accessById, session, showType); };
        } else {
          filterRow.hidden = true;
        }
      }
      renderDocList(listEl, docs, yearSelect ? yearSelect.value : '', accessById, session, showType);
    }

    function loadDocuments(entityIds, accessById, session, propertyId, docEntityIds) {
      client.from('entity_documents').select('*').in('entity_id', entityIds).order('created_at', { ascending: false }).then(function (result) {
        var byEntity = {};
        entityIds.forEach(function (id) { byEntity[id] = []; });
        if (!result.error) (result.data || []).forEach(function (doc) { if (byEntity[doc.entity_id]) byEntity[doc.entity_id].push(doc); });

        entityIds.forEach(function (entityId) {
          if (/-compliance-tenancy$/.test(entityId)) renderComplianceStatus(entityId, byEntity[entityId] || []);
        });

        // Income & Outgoings keeps its own single-entity list.
        entityIds.filter(function (id) { return /-income$/.test(id); }).forEach(function (entityId) {
          renderEntityDocList(entityId, byEntity[entityId] || [], result.error, accessById, session, false);
        });

        // The merged Documents card pools docs from every doc-type entity
        // the viewer can see into one list, tagged with a Type badge — the
        // underlying entities (and their separate access rows) are
        // untouched; only the display is combined.
        if (docEntityIds && docEntityIds.length > 0) {
          var merged = [];
          docEntityIds.forEach(function (id) { merged = merged.concat(byEntity[id] || []); });
          merged.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
          renderEntityDocList(propertyId + '-documents', merged, result.error, accessById, session, true);
        }
      });
    }

    // --- Income & Outgoings -------------------------------------------------
    //
    // Income entries are plain data rows in entity_documents (no file), held
    // in a property's own "<id>-income" entity. Outgoings are read from
    // whatever's already been submitted on Receipts & Invoices and linked to
    // this property (the "Relates to" dropdown there, entity_documents.
    // related_entity_id) — so this doesn't duplicate expense tracking, it
    // just reuses it. Someone who can't see Receipts & Invoices simply sees
    // £0 outgoings here, since that query is RLS-scoped the same as anywhere
    // else on the site.

    function incomeCardHtml(entityId, canUpload) {
      return (
        '<div class="entity-card">' +
          '<div class="section-head left"><h2>Income &amp; Outgoings</h2></div>' +
          '<p>A running total of rent received and money spent on this property — not a place to file documents. Most entries here are just a description, an amount, and a date; nothing needs to be uploaded (outgoings come from whatever’s tagged to this property under Receipts &amp; Invoices instead).</p>' +
          '<div class="income-chart" data-income-chart="' + entityId + '"></div>' +
          '<div class="year-filter-row" data-year-filter="' + entityId + '" hidden>' +
            '<label for="year-select-' + entityId + '">Year</label>' +
            '<select id="year-select-' + entityId + '" data-year-select></select>' +
          '</div>' +
          '<div class="doc-list" data-doc-list="' + entityId + '"><div class="doc-row"><div class="doc-row-main"><div>Loading&hellip;</div></div></div></div>' +
          (canUpload ? bankStatementScanHtml(entityId) + incomeEntryFormHtml(entityId) : '') +
        '</div>'
      );
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

    function wireIncomeEntryForm(entityId, session, propertyId) {
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
          loadProperty(propertyId, session);
        });
      });
    }

    // A first pass only — bank statement layouts vary hugely between banks
    // and this is plain keyword + amount matching over whatever text pdf.js
    // (or, for a scanned/photographed statement, Tesseract OCR) can pull off
    // the page, not real column-aware parsing. Every line it finds is shown
    // for review, nothing is saved until you tick and confirm it. The
    // reading itself (OCR/PDF text + line matching) lives in
    // assets/doc-scan.js, shared with person.js's own copy of this same
    // tool for a nested property's Income & Outgoings section.

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

    function wireBankStatementScan(entityId, session, propertyId) {
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
                loadProperty(propertyId, session);
              });
            });
          });
        }).catch(function () {
          status.textContent = 'Could not read that file. You can still add entries by hand below.';
        });
      });
    }

    // Every person has their own Receipts & Invoices entity (see
    // receipts.js) — outgoings for a property are read across all three,
    // filtered to whichever submissions were linked to it. RLS quietly
    // limits this to whichever of the three the current viewer actually has
    // access to; it never errors on the ones they don't.
    var RECEIPTS_ENTITY_IDS = ['oscar-receipts-invoices', 'sally-receipts-invoices', 'iris-receipts-invoices'];

    function loadIncomeChart(entityId, propertyId, session) {
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
          chartEl.innerHTML = '<p>No income or linked outgoings recorded yet — add an entry below, or link a Receipts &amp; Invoices submission to this property, to see a running total here.</p>';
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
  });
})();
