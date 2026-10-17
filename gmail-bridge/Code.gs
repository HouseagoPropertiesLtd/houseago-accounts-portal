// Runs INSIDE the houseagopropertiesltd@gmail.com Google account (script.google.com).
// Looks for new invoice/receipt emails every 15 minutes and posts them to the
// portal's ingest-invoice function. It can only read that one mailbox, only
// from inside Google, and it sends nothing anywhere except your own function.
// Set two Script Properties (Project Settings): INGEST_URL and INGEST_SECRET.
// Never paste the secret into this file.
function checkInvoices() {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('INGEST_URL'), secret = p.getProperty('INGEST_SECRET');
  var label = GmailApp.getUserLabelByName('portal-sent') || GmailApp.createLabel('portal-sent');
  var threads = GmailApp.search('has:attachment (invoice OR receipt) newer_than:14d -label:portal-sent -from:me', 0, 20);
  threads.forEach(function (t) {
    var m = t.getMessages()[0], atts = [];
    m.getAttachments().forEach(function (a) {
      if (/pdf/i.test(a.getContentType()) && a.getSize() < 8 * 1024 * 1024)
        atts.push({ filename: a.getName(), content_type: 'application/pdf', content_base64: Utilities.base64Encode(a.getBytes()) });
    });
    var res = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-ingest-secret': secret },
      payload: JSON.stringify({ message_id: m.getId(), source: 'gmail', from: m.getFrom(), subject: m.getSubject(),
        date: Utilities.formatDate(m.getDate(), 'UTC', 'yyyy-MM-dd'), text: m.getPlainBody(), attachments: atts }) });
    if (res.getResponseCode() === 200) t.addLabel(label);
  });
}
