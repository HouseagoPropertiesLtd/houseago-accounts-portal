// Adds an "Inbox" link to the top bar of every signed-in page, with a count of
// invoices still waiting for review. Quiet by design: if the user has no
// access to the inbox, or the table is not set up yet, nothing is shown.
(function () {
  var bar = document.querySelector('.header-actions');
  if (!bar || typeof supabase === 'undefined' || typeof SUPABASE_URL === 'undefined') return;
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function show(count) {
    var link = document.createElement('a');
    link.href = 'inbox.html';
    link.className = 'btn btn-outline inbox-link';
    link.appendChild(document.createTextNode('Invoice Inbox'));
    if (count > 0) {
      var badge = document.createElement('span');
      badge.className = 'inbox-badge';
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.setAttribute('aria-label', count + ' invoices to review');
      link.appendChild(badge);
    }
    bar.insertBefore(link, bar.firstChild);
  }

  client.auth.getSession().then(function (r) {
    if (!r.data.session) return;
    client.from('invoice_inbox').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      .then(function (res) {
        if (res.error) return;
        show(res.count || 0);
      });
  }).catch(function () {});
})();
