// Powers inbox.html: the review queue for invoices found in email. Each item
// arrives with a suggested property; nothing is filed until a person confirms.
(function () {
  var ENTITY_ID = 'oscar-receipts-invoices';
  var TARGETS = [
    ['33-north-denes', '33 North Denes'], ['6-chaucer-street', '6 Chaucer Street'],
    ['6a-chaucer-street', '6a Chaucer Street'], ['wild-thyme', 'Wild Thyme'],
    ['3-horning-close', '3 Horning Close'], ['ltd-company', 'Houseago Properties Ltd (general)']
  ];
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  var list = document.getElementById('inbox-list');
  var statusEl = document.getElementById('inbox-status');
  var session = null;

  function el(tag, text, attrs) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function card(item) {
    var c = el('div', null, { 'class': 'entity-card' });
    c.appendChild(el('h3', item.supplier || item.sender || 'Unknown sender'));
    var bits = [item.subject, item.invoice_ref && ('Ref ' + item.invoice_ref),
      item.amount != null && ('£' + Number(item.amount).toFixed(2)), item.doc_date].filter(Boolean);
    c.appendChild(el('p', bits.join(' · ')));
    if (item.suggestion_reason) c.appendChild(el('p', 'Suggestion: ' + item.suggestion_reason));

    var sel = el('select');
    sel.appendChild(el('option', 'Choose a property…', { value: '' }));
    TARGETS.forEach(function (t) {
      var o = el('option', t[1], { value: t[0] });
      if (t[0] === item.suggested_entity_id) o.selected = true;
      sel.appendChild(o);
    });
    c.appendChild(sel);

    if (item.file_path) {
      var view = el('button', 'View PDF', { 'class': 'btn btn-outline', type: 'button' });
      view.addEventListener('click', function () {
        client.storage.from('owner-documents').createSignedUrl(item.file_path, 300).then(function (r) {
          if (r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank', 'noopener');
        });
      });
      c.appendChild(view);
    }

    var file = el('button', 'File it', { 'class': 'btn', type: 'button' });
    file.addEventListener('click', function () {
      if (!sel.value) { statusEl.textContent = 'Choose a property first.'; return; }
      file.disabled = true;
      var name = (item.supplier || 'Invoice') + (item.invoice_ref ? ' ' + item.invoice_ref : '');
      client.from('entity_documents').insert({
        entity_id: ENTITY_ID, name: name, doc_date: item.doc_date,
        year: item.doc_date ? item.doc_date.slice(0, 4) : null, amount: item.amount,
        notes: 'From email: ' + (item.subject || ''), related_entity_id: sel.value,
        expense_type: sel.value === 'ltd-company' ? 'Business Expense' : 'Property Expense',
        file_path: item.file_path, uploaded_by: session.user.id
      }).select('id').single().then(function (ins) {
        if (ins.error) { file.disabled = false; statusEl.textContent = 'Could not file that one. Please try again.'; return; }
        client.from('invoice_inbox').update({ status: 'filed', filed_document_id: ins.data.id }).eq('id', item.id)
          .then(function () { c.remove(); statusEl.textContent = 'Filed.'; });
      });
    });
    c.appendChild(file);

    var skip = el('button', 'Not an invoice', { 'class': 'btn btn-outline', type: 'button' });
    skip.addEventListener('click', function () {
      client.from('invoice_inbox').update({ status: 'dismissed' }).eq('id', item.id).then(function () { c.remove(); });
    });
    c.appendChild(skip);
    return c;
  }

  client.auth.getSession().then(function (r) {
    session = r.data.session;
    if (!session) { window.location.href = 'index.html'; return; }
    window.HouseagoSession.guardSession(client, session).then(function (ok) {
      if (!ok) return;
      client.from('invoice_inbox').select('*').eq('status', 'pending').order('created_at', { ascending: false })
        .then(function (res) {
          if (res.error) { statusEl.textContent = 'Could not load the inbox.'; return; }
          if (!res.data.length) { statusEl.textContent = 'Nothing waiting.'; return; }
          res.data.forEach(function (i) { list.appendChild(card(i)); });
        });
    });
  });
})();
