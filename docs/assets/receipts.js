// Powers receipts.html: submitting and browsing one person's Receipts &
// Invoices. This is a separate, focused page rather than a section on the
// main dashboard or a person's own page, because unlike other sections
// this one is meant to be submitted to often and just needs a place to
// land. Each person (Oscar, Sally, Iris) has their own Receipts &
// Invoices entity - "<key>-receipts-invoices" - linked from their own
// page (person.html?id=<key>); which one this page shows is driven by
// its own "?owner=" query string, the same way property.html and
// person.html are driven by "?id=".
//
// Each submission can optionally be "linked" to one of the core
// accounts/properties via related_entity_id - this is descriptive only
// (for filtering/organising later), not an access control mechanism:
// everyone with access to this Receipts & Invoices entity sees every
// submission in it, regardless of what it's linked to. A property's own
// Income & Outgoings section (see property.js) totals up outgoings by
// reading across all three people's Receipts & Invoices entities for
// whichever ones link to that property - so it doesn't matter which
// person a receipt was submitted under, only what it's linked to.

(function () {
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  var PEOPLE = [
    { key: 'oscar', label: 'Oscar' },
    { key: 'sally', label: 'Sally' },
    { key: 'iris', label: 'Iris' }
  ];

  var ownerKey = getQueryParam('owner');
  var owner = PEOPLE.filter(function (p) { return p.key === ownerKey; })[0];
  var ENTITY_ID = owner ? owner.key + '-receipts-invoices' : null;

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

  // escapeHtml alone is only safe for text content - it doesn't touch quote
  // characters, so a value from an untrusted source can still break out of
  // a double-quoted HTML attribute like value="..." even after escapeHtml.
  // Use this instead wherever a value lands inside an attribute.
  function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Safety net for the photo-capture/scan flow below: several steps in it
  // (decoding the image, auto-cropping, Azure, the free local OCR) each try
  // to guard against hanging forever on their own, but this is a last
  // line of defence so a genuinely unforeseen stall on some device/browser
  // still recovers within a bounded time - "reading..." is never left on
  // screen indefinitely with no way forward. On timeout, whatever's true so
  // far (the photo is already attached either way) just falls through to
  // manual entry, exactly like a normal "couldn't read it" outcome.
  var SCAN_SAFETY_TIMEOUT_MS = 40000;

  function withSafetyTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('timed out'));
      }, ms);
      promise.then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function formatCurrency(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return '£' + v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function receiptIconSvg() {
    return '<svg viewBox="0 0 24 24"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/></svg>';
  }

  // ---- Automatic date/amount detection from an uploaded receipt/invoice --
  // Submission date and transaction date aren't the same thing, and typing
  // the total out by hand is a chore, so rather than always asking for both
  // we try to read them straight off the document: OCR for images (and
  // scanned PDFs), the text layer for PDFs that have one. If a field can't
  // be found, we fall back to asking the user, same as before. The actual
  // OCR/PDF-text reading and date/amount pattern matching lives in
  // assets/doc-scan.js, shared with every other upload point on the site.

  // Reads whichever fields it can off a file. This goes through
  // window.HouseagoDocScan.scanFileForReceiptFields, which tries the
  // Azure-backed receipt scan first (see assets/doc-scan.js) and falls back
  // to the same free OCR/text-layer scan every other upload point on the
  // site uses whenever Azure isn't configured or the attempt fails for any
  // reason - so this page keeps working exactly as before either way.
  // Adapts the result to the {date, amount, title, category, text} shape
  // this page uses, keeping the raw text too so guessReceiptName (below)
  // has something to work with when the category guess comes up empty.
  function scanFileForReceiptFields(fileOrBlob, isPdf, isImage) {
    if (!fileOrBlob || (!isPdf && !isImage)) return Promise.resolve({ date: null, amount: null, title: null, category: null, text: '' });
    // The real signed-in session's own token, not the public anon key - see
    // assets/doc-scan.js's postFileToScanReceiptFunction for why that
    // distinction matters. currentSession may still be null this early
    // (the page's own getSession() call hasn't resolved yet) - Azure is
    // simply skipped in that case and the free scan below handles it.
    var accessToken = currentSession ? currentSession.access_token : null;
    return window.HouseagoDocScan.scanFileForReceiptFields(fileOrBlob, accessToken)
      .then(function (fields) { return { date: fields.date, amount: fields.amount, title: fields.title, category: fields.category, text: fields.text }; })
      .catch(function () { return { date: null, amount: null, title: null, category: null, text: '' }; });
  }

  // ---- Guessing a name for the receipt itself -----------------------------
  // The shared title guess (guessDocType, in doc-scan.js) is a fixed list of
  // property-expense keywords - "boiler", "insurance", "gas safety" - built
  // for compliance and expense documents, not for reading the shop or
  // business name printed on an ordinary receipt or invoice, which it will
  // usually have nothing to say about. A receipt/invoice's own name is
  // almost always the business name, printed across the first line or two,
  // so when the category guess finds nothing, fall back to the first line
  // of the document's own text that looks like a name rather than a
  // barcode, a date, or a lone total - not blank, not just digits and
  // punctuation, and a plausible length for a business name.
  function guessReceiptName(text) {
    if (!text) return null;
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+/g, ' ').trim();
      if (line.length < 3 || line.length > 60) continue;
      if (/^[\d\s.,£$€\-\/:*#]+$/.test(line)) continue; // just numbers/date/amount/punctuation
      return line;
    }
    return null;
  }

  // ---- Falling back to the products purchased, when nothing else names it
  // Neither the category guess nor a plausible first line always finds
  // something - a faded till receipt, a logo instead of a printed store
  // name, or a first line that OCR simply couldn't read. When that
  // happens, the itemised list is usually still there and still readable,
  // so read it: a line that looks like "<product name> ... <price>" is a
  // purchased item, unless it's actually a subtotal/tax/change/tender line
  // that happens to have the same shape. What was actually bought is a
  // genuinely useful name and description on its own, and can also point
  // at a category the whole-document keyword match missed.
  var LINE_ITEM_RE = /^(.{2,40}?)\s+£?\s?(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/;
  var LINE_ITEM_EXCLUDE = /^(sub ?total|total|amount due|balance|change|cash|card|tender(ed)?|vat|tax|gratuity|tip|discount|saving|loyalty|points)/i;

  function extractPurchasedItems(text) {
    if (!text) return [];
    var items = [];
    text.split(/\r?\n/).forEach(function (line) {
      var trimmed = line.replace(/\s+/g, ' ').trim();
      if (!trimmed) return;
      var m = trimmed.match(LINE_ITEM_RE);
      if (!m) return;
      var name = m[1].trim();
      if (name.length < 2 || LINE_ITEM_EXCLUDE.test(name)) return;
      items.push({ name: name, amount: parseFloat(m[2].replace(/,/g, '')) });
    });
    return items;
  }

  // Joins item names in descending price order - the priciest item first,
  // as usually the one worth naming the receipt after - stopping once
  // adding the next name would push past maxLen, rather than cutting a
  // name off mid-word.
  function joinItemNames(names, maxLen) {
    var result = names[0];
    for (var i = 1; i < names.length; i++) {
      var next = result + ', ' + names[i];
      if (next.length > maxLen) break;
      result = next;
    }
    return result;
  }

  // The single place both the single-submission and bulk-upload paths go
  // for a name/description: the category guess and the first-line guess
  // first, and only once both of those have nothing to say, the products
  // actually purchased - a short join for the Name field, a longer one for
  // Description when it says more than the name alone already does.
  function guessNameAndDescription(fields) {
    if (fields.title) return { name: fields.title, description: null };
    var firstLine = guessReceiptName(fields.text);
    if (firstLine) return { name: firstLine, description: null };
    var items = extractPurchasedItems(fields.text);
    if (items.length === 0) return { name: null, description: null };
    items.sort(function (a, b) { return b.amount - a.amount; });
    var names = items.map(function (i) { return i.name; });
    var shortName = joinItemNames(names, 60);
    var fullDescription = joinItemNames(names, 200);
    return { name: shortName, description: fullDescription !== shortName ? fullDescription : null };
  }

  // A second, narrower attempt at a category once the whole-document
  // keyword match (guessDocType, run over everything OCR/the text layer
  // found) has come back empty: the same keyword list, run just over the
  // purchased-item names, in case that whole-document pass missed a match
  // buried in noisy OCR text.
  function guessCategoryFromItems(text) {
    var items = extractPurchasedItems(text);
    if (items.length === 0) return null;
    var joined = items.map(function (i) { return i.name; }).join(' ');
    var docType = window.HouseagoDocScan.guessDocType(joined);
    return docType ? docType.category : null;
  }

  // ---- Automatic crop: find roughly where the receipt is in a photo -----
  // This is a plain contrast/edge heuristic, not full document-scanner
  // perspective correction - it finds the largest contiguous band of high
  // local contrast (printed text, receipt edges) in each direction and
  // crops to that, which works well for a receipt photographed on a plain,
  // contrasting surface. It never touches the original file: the person can
  // always fall back to the untouched photo with one tap.

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  // Finds where most of the content actually is along one axis, by
  // trimming the faintest ~4% of total contrast energy off each end and
  // keeping what's left. This is a cumulative-mass trim rather than a
  // "longest unbroken run above a threshold" - printed text has blank gaps
  // between lines (a run-based approach only ever finds one line at a
  // time), but the *energy* is still overwhelmingly concentrated within
  // the receipt's true bounds, gaps and all, so trimming by mass finds the
  // right span even when the content inside it isn't contiguous.
  function boundsFromScore(score) {
    var n = score.length;
    var total = 0;
    for (var i = 0; i < n; i++) total += score[i];
    if (total <= 0) return null;

    var trim = total * 0.04;
    var cum = 0, start = 0;
    for (var i = 0; i < n; i++) {
      cum += score[i];
      if (cum > trim) { start = i; break; }
    }
    cum = 0;
    var end = n;
    for (var i = n - 1; i >= 0; i--) {
      cum += score[i];
      if (cum > trim) { end = i + 1; break; }
    }
    if (end <= start || (end - start) < n * 0.05) return null;
    return { start: start, end: end };
  }

  function autoCropImageFile(file) {
    return loadImageFromFile(file).then(function (loaded) {
      var img = loaded.img;
      var fullW = img.naturalWidth, fullH = img.naturalHeight;
      URL.revokeObjectURL(loaded.url);
      if (!fullW || !fullH) return null;

      var workW = Math.min(400, fullW);
      var scale = workW / fullW;
      var workH = Math.max(1, Math.round(fullH * scale));

      var workCanvas = document.createElement('canvas');
      workCanvas.width = workW;
      workCanvas.height = workH;
      var wctx = workCanvas.getContext('2d');
      wctx.drawImage(img, 0, 0, workW, workH);

      var imgData;
      try {
        imgData = wctx.getImageData(0, 0, workW, workH);
      } catch (e) {
        return null; // can't read pixels - skip cropping, keep the original
      }
      var data = imgData.data;

      var gray = new Float32Array(workW * workH);
      for (var i = 0, p = 0; i < data.length; i += 4, p++) {
        gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }

      var colScore = new Float64Array(workW);
      var rowScore = new Float64Array(workH);
      for (var y = 1; y < workH - 1; y++) {
        for (var x = 1; x < workW - 1; x++) {
          var idx = y * workW + x;
          var g = Math.abs(gray[idx + 1] - gray[idx - 1]) + Math.abs(gray[idx + workW] - gray[idx - workW]);
          colScore[x] += g;
          rowScore[y] += g;
        }
      }

      var colBox = boundsFromScore(colScore);
      var rowBox = boundsFromScore(rowScore);
      if (!colBox || !rowBox) return null;

      var padX = Math.round((colBox.end - colBox.start) * 0.04) + 4;
      var padY = Math.round((rowBox.end - rowBox.start) * 0.04) + 4;
      var x0 = Math.max(0, colBox.start - padX);
      var x1 = Math.min(workW, colBox.end + padX);
      var y0 = Math.max(0, rowBox.start - padY);
      var y1 = Math.min(workH, rowBox.end + padY);

      var areaFrac = ((x1 - x0) * (y1 - y0)) / (workW * workH);
      if (areaFrac > 0.99 || areaFrac < 0.05) return null; // nothing worth cropping to

      var fx0 = Math.round(x0 / scale), fy0 = Math.round(y0 / scale);
      var fx1 = Math.round(x1 / scale), fy1 = Math.round(y1 / scale);
      var cropW = fx1 - fx0, cropH = fy1 - fy0;

      var outCanvas = document.createElement('canvas');
      outCanvas.width = cropW;
      outCanvas.height = cropH;
      var octx = outCanvas.getContext('2d');
      octx.drawImage(img, fx0, fy0, cropW, cropH, 0, 0, cropW, cropH);

      return new Promise(function (resolve) {
        outCanvas.toBlob(function (blob) { resolve(blob ? { blob: blob, width: cropW, height: cropH } : null); }, 'image/jpeg', 0.92);
      });
    }).catch(function () { return null; });
  }

  // ---- Expense categories --------------------------------------------------
  // A fixed pick-list rather than free text, kept short and roughly matching
  // how a UK property tax return groups expenses - good enough for a
  // running breakdown without turning submission into data entry.
  // The category list itself now lives in assets/doc-scan.js, shared with
  // every other upload point on the site - this just keeps the same name
  // available here since the rest of this file already refers to it.
  var EXPENSE_CATEGORIES = window.HouseagoDocScan.EXPENSE_CATEGORIES;

  function populateCategorySelect(selectEl) {
    window.HouseagoDocScan.populateCategorySelect(selectEl);
  }

  // ---- Expenses by month, within a financial year ------------------------
  // UK financial year: 6 April to 5 April. "2025/26" means 6 Apr 2025–5 Apr 2026.
  // These grouping functions are the single source of truth for both the
  // on-page chart and the Excel export below, so the two always agree.

  var FY_MONTH_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
  var MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function financialYearFor(iso) {
    if (!iso) return null;
    var parts = iso.split('-');
    var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10), d = parseInt(parts[2], 10);
    if (!y || !m || !d) return null;
    var startYear = (m > 4 || (m === 4 && d >= 6)) ? y : y - 1;
    return { startYear: startYear, label: startYear + '/' + pad2((startYear + 1) % 100) };
  }

  // { startYear: { startYear, label, total, docs: [...] } }, one entry per
  // financial year that has at least one dated, priced submission.
  function groupByFinancialYear(docs) {
    var byYear = {};
    (docs || []).forEach(function (doc) {
      if (doc.amount == null || !doc.doc_date) return;
      var fy = financialYearFor(doc.doc_date);
      if (!fy) return;
      if (!byYear[fy.startYear]) byYear[fy.startYear] = { startYear: fy.startYear, label: fy.label, total: 0, docs: [] };
      byYear[fy.startYear].total += Number(doc.amount) || 0;
      byYear[fy.startYear].docs.push(doc);
    });
    return byYear;
  }

  // Always 12 entries, April through March, even for months with nothing
  // submitted - so a gap reads as "nothing that month", not a missing bar.
  function monthlyTotalsForYear(yearEntry) {
    var totals = {};
    (yearEntry.docs || []).forEach(function (doc) {
      var m = parseInt(doc.doc_date.split('-')[1], 10);
      totals[m] = (totals[m] || 0) + (Number(doc.amount) || 0);
    });
    return FY_MONTH_ORDER.map(function (m) {
      var calYear = m >= 4 ? yearEntry.startYear : yearEntry.startYear + 1;
      return { month: m, label: MONTH_ABBR[m], fullLabel: MONTH_FULL[m], calYear: calYear, total: totals[m] || 0 };
    });
  }

  // Category totals for one financial year, largest first. Uncategorised
  // submissions are grouped together at the end rather than dropped, so the
  // list still accounts for the full year's total.
  function categoryTotalsForYear(yearEntry) {
    var totals = {};
    (yearEntry.docs || []).forEach(function (doc) {
      var cat = doc.expense_category || 'Uncategorised';
      totals[cat] = (totals[cat] || 0) + (Number(doc.amount) || 0);
    });
    return Object.keys(totals)
      .map(function (cat) { return { category: cat, total: totals[cat] }; })
      .sort(function (a, b) {
        if (a.category === 'Uncategorised') return 1;
        if (b.category === 'Uncategorised') return -1;
        return b.total - a.total;
      });
  }

  function renderCategoryBreakdown(yearEntry) {
    var el = document.getElementById('receipts-category-breakdown');
    if (!el) return;
    var rows = categoryTotalsForYear(yearEntry);
    if (rows.length === 0) { el.innerHTML = ''; return; }
    el.innerHTML =
      '<div class="category-breakdown-title">By category</div>' +
      rows.map(function (r) {
        return '<div class="category-row"><span>' + escapeHtml(r.category) + '</span><span>' + escapeHtml(formatCurrency(r.total)) + '</span></div>';
      }).join('');
  }

  function renderExpenseChart(docs) {
    var chartCard = document.getElementById('receipts-chart-card');
    var chartEl = document.getElementById('receipts-chart');
    var fySelect = document.getElementById('receipts-chart-fy-select');
    var fyTotalEl = document.getElementById('receipts-chart-fy-total');
    if (!chartCard || !chartEl || !fySelect) return;

    var byYear = groupByFinancialYear(docs);
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return b - a; }); // most recent first

    if (years.length === 0) {
      chartCard.hidden = true;
      chartEl.innerHTML = '';
      fySelect.innerHTML = '';
      var breakdownEl = document.getElementById('receipts-category-breakdown');
      if (breakdownEl) breakdownEl.innerHTML = '';
      return;
    }
    chartCard.hidden = false;

    var previousSelection = Number(fySelect.value);
    var selectedYear = years.indexOf(previousSelection) !== -1 ? previousSelection : years[0];

    fySelect.innerHTML = years.map(function (y) {
      return '<option value="' + y + '">' + escapeHtml(byYear[y].label) + '</option>';
    }).join('');
    fySelect.value = String(selectedYear);
    fySelect.onchange = function () {
      var entry = byYear[Number(fySelect.value)];
      renderMonthlyBars(entry);
      renderCategoryBreakdown(entry);
    };

    renderMonthlyBars(byYear[selectedYear]);
    renderCategoryBreakdown(byYear[selectedYear]);

    function renderMonthlyBars(yearEntry) {
      fyTotalEl.textContent = 'Total: ' + formatCurrency(yearEntry.total);
      var monthly = monthlyTotalsForYear(yearEntry);
      var maxTotal = Math.max.apply(null, monthly.map(function (m) { return m.total; }));
      var maxHeight = 180;

      // With up to 12 narrow columns, an inline "£X.XX" label on every bar
      // overlaps its neighbours - so only the tallest bar (the one worth
      // calling out) is labelled directly. Every bar's exact figure is still
      // available via its tooltip (tap or hover).
      var html = '<div class="chart-wrap">';
      monthly.forEach(function (m) {
        var hasValue = m.total > 0;
        var heightPx = hasValue && maxTotal > 0 ? Math.max(4, Math.round((m.total / maxTotal) * maxHeight)) : 0;
        var amountLabel = formatCurrency(m.total);
        var isPeak = hasValue && maxTotal > 0 && m.total === maxTotal;
        html +=
          '<div class="chart-bar-col">' +
            '<div class="chart-bar-track">' +
              (isPeak ? '<div class="chart-bar-value">' + escapeHtml(amountLabel) + '</div>' : '') +
              '<div class="chart-bar" tabindex="0" style="height:' + heightPx + 'px;">' +
                '<span class="chart-bar-tooltip">' + escapeHtml(m.fullLabel) + ' ' + m.calYear + ': ' + escapeHtml(amountLabel) + '</span>' +
              '</div>' +
            '</div>' +
            '<div class="chart-bar-label">' + escapeHtml(m.label) + '</div>' +
          '</div>';
      });
      html += '</div><div class="chart-baseline"></div>';
      chartEl.innerHTML = html;
    }
  }

  // ---- Excel export: each financial year analysed, not just dumped ------

  function roundMoney(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function buildReceiptsWorkbook(docs, namesById) {
    var byYear = groupByFinancialYear(docs);
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; }); // oldest first

    var wb = XLSX.utils.book_new();

    var summaryRows = [
      ['Houseago Asset Management - Receipts & Invoices summary'],
      ['Generated ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })],
      [],
      ['Financial year', 'Total (£)', 'Submissions']
    ];
    years.forEach(function (y) {
      summaryRows.push([byYear[y].label, roundMoney(byYear[y].total), byYear[y].docs.length]);
    });
    summaryRows.push([]);
    summaryRows.push(['Monthly breakdown (£)']);
    summaryRows.push(['Financial year'].concat(FY_MONTH_ORDER.map(function (m) { return MONTH_ABBR[m]; })));
    years.forEach(function (y) {
      var monthly = monthlyTotalsForYear(byYear[y]);
      summaryRows.push([byYear[y].label].concat(monthly.map(function (m) { return roundMoney(m.total); })));
    });

    var summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet['!cols'] = [{ wch: 16 }, { wch: 12 }].concat(new Array(11).fill({ wch: 9 }));
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');

    years.forEach(function (y) {
      var entry = byYear[y];
      var rows = [
        ['Financial year ' + entry.label],
        ['Total', roundMoney(entry.total)],
        [],
        ['Monthly breakdown'],
        ['Month', 'Total (£)']
      ];
      monthlyTotalsForYear(entry).forEach(function (m) {
        rows.push([m.fullLabel + ' ' + m.calYear, roundMoney(m.total)]);
      });
      rows.push([]);
      rows.push(['By category']);
      rows.push(['Category', 'Total (£)']);
      categoryTotalsForYear(entry).forEach(function (c) {
        rows.push([c.category, roundMoney(c.total)]);
      });
      rows.push([]);
      rows.push(['Date', 'Type', 'Name', 'Category', 'Amount (£)', 'Description', 'Relates to']);

      entry.docs
        .slice()
        .sort(function (a, b) { return (a.doc_date || '').localeCompare(b.doc_date || ''); })
        .forEach(function (doc) {
          var related = (doc.related_entity_id && namesById[doc.related_entity_id]) ? namesById[doc.related_entity_id] : 'General / Other';
          rows.push([doc.doc_date, doc.expense_type || '', doc.name || '', doc.expense_category || 'Uncategorised', roundMoney(doc.amount), doc.notes || '', related]);
        });

      rows.push([]);
      rows.push(['', '', '', 'Year total', roundMoney(entry.total), '', '']);

      var sheet = XLSX.utils.aoa_to_sheet(rows);
      sheet['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 28 }, { wch: 24 }, { wch: 12 }, { wch: 34 }, { wch: 20 }];
      var sheetName = ('FY ' + entry.label).replace(/[\/\\?*\[\]:]/g, '-').slice(0, 31);
      XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    });

    return wb;
  }

  function exportReceiptsExcel(docs, namesById) {
    if (typeof XLSX === 'undefined') {
      alert('The Excel export could not load just now. Please refresh and try again in a moment.');
      return;
    }
    if (!docs || docs.length === 0) {
      alert('Nothing to export yet - submit a dated, priced receipt or invoice first.');
      return;
    }
    var wb = buildReceiptsWorkbook(docs, namesById || {});
    var today = new Date().toISOString().slice(0, 10);
    var ownerPart = owner ? '-' + owner.label : '';
    XLSX.writeFile(wb, 'Houseago-Receipts' + ownerPart + '-' + today + '.xlsx');
  }

  document.addEventListener('DOMContentLoaded', function () {
    var accessNote = document.getElementById('receipts-access-note');
    var titleEl = document.getElementById('receipts-title');
    var backLink = document.getElementById('receipts-back-link');

    if (!owner) {
      if (titleEl) titleEl.textContent = 'Not found';
      accessNote.hidden = false;
      accessNote.querySelector('p').textContent = 'This page needs a person to show Receipts & Invoices for - open it from Oscar, Sally, or Iris’s own page rather than linking to it directly.';
      return;
    }
    if (titleEl) titleEl.textContent = owner.label + '’s receipts, invoices, and evidence';
    if (backLink) { backLink.href = 'person.html?id=' + owner.key; backLink.textContent = '← Back to ' + owner.label; }

    var uploadCard = document.getElementById('receipts-upload-card');
    var listCard = document.getElementById('receipts-list-card');
    var listEl = document.getElementById('receipts-list');
    var relatedSelect = document.getElementById('receipt-related');
    var categorySelect = document.getElementById('receipt-category');
    var expenseTypeSelect = document.getElementById('receipt-expense-type');
    populateCategorySelect(categorySelect);
    var form = document.getElementById('receipt-upload-form');
    var yearFilterRow = document.getElementById('receipts-year-filter');
    var yearSelect = document.getElementById('receipts-year-select');

    var captureBtn = document.getElementById('receipt-capture-btn');
    var chooseBtn = document.getElementById('receipt-choose-btn');
    var clearBtn = document.getElementById('receipt-clear-btn');
    var cameraInput = document.getElementById('receipt-file-camera');
    var pickerInput = document.getElementById('receipt-file-picker');
    var fileStatus = document.getElementById('receipt-file-status');
    var previewCard = document.getElementById('receipt-preview-card');
    var previewImg = document.getElementById('receipt-preview-img');
    var useCropCheckbox = document.getElementById('receipt-use-crop');
    var nameInput = document.getElementById('receipt-name');
    var descInput = document.getElementById('receipt-description');
    var dateInput = document.getElementById('receipt-date');
    var dateStatus = document.getElementById('receipt-date-status');
    var amountInput = document.getElementById('receipt-amount');
    var amountStatus = document.getElementById('receipt-amount-status');
    var exportBtn = document.getElementById('receipts-export-btn');

    // Fields the scan itself filled in, so "Clear" can undo exactly those -
    // never something typed by hand - the same rule as every other upload
    // point on the site (see assets/doc-scan.js).
    var scanAutofilled = [];
    function trackAutofill(el, value) { if (el) scanAutofilled.push({ el: el, value: String(value) }); }
    function revertAutofills() {
      scanAutofilled.forEach(function (a) { if (String(a.el.value) === a.value) a.el.value = ''; });
      scanAutofilled = [];
    }

    var latestReceiptDocs = [];
    var latestNamesById = {};
    var currentSession = null; // set once we have a real session, for bulk uploads (see handleBulkFiles)

    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        if (!client) {
          alert('This is a sample preview, so there is nothing real to export yet. Once Supabase is connected, this button will export your actual submissions.');
          return;
        }
        exportReceiptsExcel(latestReceiptDocs, latestNamesById);
      });
    }

    // ---- Capture/choose/crop/scan: all pure client-side, so it works the
    // same whether or not Supabase is configured yet. Only the final
    // "Submit" is gated on a real backend (further down). ----

    var originalFile = null;   // the File the person picked or photographed
    var originalUrl = null;    // object URL for the preview of that file
    var croppedBlob = null;    // the auto-cropped version, once/if computed
    var croppedUrl = null;     // object URL for the crop preview

    // Auto-crop and OCR both run in the background after a photo's taken,
    // and on a phone either one can take several seconds - long enough for
    // someone to retake the photo (tap "Take a photo" again) or hit "Clear"
    // before the first attempt has finished. Without a guard, that first,
    // now-stale attempt finishing late would still write its result
    // (a crop, or scanned fields) into whatever is now on screen - silently
    // replacing a newer photo with an old one, or reviving fields after
    // "Clear" was pressed. captureGen is bumped every time the photo
    // changes; every async callback below checks it's still the generation
    // it started with before touching anything, and simply drops its result
    // otherwise.
    var captureGen = 0;

    function resetCaptureState() {
      captureGen++;
      if (originalUrl) URL.revokeObjectURL(originalUrl);
      if (croppedUrl) URL.revokeObjectURL(croppedUrl);
      originalFile = null; originalUrl = null; croppedBlob = null; croppedUrl = null;
      previewCard.hidden = true;
      useCropCheckbox.checked = true;
      useCropCheckbox.parentElement.hidden = true;
    }

    // What should actually be uploaded right now.
    function currentUploadFile() {
      if (croppedBlob && useCropCheckbox.checked) {
        return { blob: croppedBlob, name: 'receipt-cropped.jpg', type: 'image/jpeg' };
      }
      if (originalFile) return { blob: originalFile, name: originalFile.name, type: originalFile.type };
      return null;
    }

    function updatePreviewImage() {
      if (croppedBlob && useCropCheckbox.checked) {
        if (!croppedUrl) croppedUrl = URL.createObjectURL(croppedBlob);
        previewImg.src = croppedUrl;
      } else if (originalUrl) {
        previewImg.src = originalUrl;
      }
    }

    if (useCropCheckbox) {
      useCropCheckbox.addEventListener('change', updatePreviewImage);
    }

    function handleFileChosen(file) {
      if (!file) return;
      resetCaptureState();
      revertAutofills();
      var myGen = captureGen; // resetCaptureState() above already bumped this
      originalFile = file;
      originalUrl = URL.createObjectURL(file);
      if (clearBtn) clearBtn.hidden = false;

      var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
      var isImage = /^image\//.test(file.type || '');

      fileStatus.textContent = file.name + (isPdf ? ' (PDF)' : '');
      dateInput.value = '';
      amountInput.value = '';
      dateStatus.textContent = 'Reading the document for a date…';
      amountStatus.textContent = '';

      // Whatever happens in the scan below - found something, found
      // nothing, or errored out - the photo itself is already attached
      // (originalFile/originalUrl are set above) and every field remains
      // free to fill in by hand; this only ever adds detected values on
      // top, never removes the photo or blocks manual entry.
      if (isImage) {
        previewCard.hidden = false;
        previewImg.src = originalUrl;

        withSafetyTimeout(autoCropImageFile(file).then(function (result) {
          if (myGen !== captureGen) return; // a newer photo (or Clear) has since taken over - drop this stale result
          if (result && result.blob) {
            croppedBlob = result.blob;
            useCropCheckbox.parentElement.hidden = false;
            useCropCheckbox.checked = true;
            updatePreviewImage();
          }
          // Scan whichever version will actually be uploaded - the crop,
          // once available, since it's tighter and usually reads better.
          var upload = currentUploadFile();
          return scanFileForReceiptFields(upload ? upload.blob : file, false, true).then(function (fields) {
            if (myGen !== captureGen) return; // stale - a newer capture/clear has already replaced this one
            applyScanResult(fields);
          });
        }), SCAN_SAFETY_TIMEOUT_MS).catch(function () {
          if (myGen !== captureGen) return;
          dateStatus.textContent = "Could not read that document automatically - the photo is still attached, please enter the date by hand.";
          amountStatus.textContent = 'You can enter the amount by hand if known.';
        });
      } else if (isPdf) {
        withSafetyTimeout(scanFileForReceiptFields(file, true, false), SCAN_SAFETY_TIMEOUT_MS).then(function (fields) {
          if (myGen !== captureGen) return;
          applyScanResult(fields);
        }).catch(function () {
          if (myGen !== captureGen) return;
          dateStatus.textContent = "Could not read that document automatically - the file is still attached, please enter the date by hand.";
          amountStatus.textContent = 'You can enter the amount by hand if known.';
        });
      } else {
        dateStatus.textContent = "Choose a file above and we'll try to read its date automatically.";
      }
    }

    // Runs the same auto-crop used for a single photo (see autoCropImageFile
    // above) on one file from a bulk batch, before it goes anywhere near
    // scanning or uploading - a bulk batch gets exactly the same crop and
    // OCR/text-detection treatment a single receipt does, just without a
    // preview to check each one against (there's no one image to show a
    // crop toggle for across a whole batch, so each crop is applied
    // automatically rather than offered as a choice). Non-image files
    // (PDFs) pass through untouched - auto-crop is an image-only heuristic.
    // Keeps the original filename, so a fallback title built from it still
    // reads sensibly, and falls back to the original file untouched if
    // cropping finds nothing worth cropping to or fails outright.
    function cropIfImage(file) {
      var isImage = /^image\//.test(file.type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || '');
      if (!isImage) return Promise.resolve(file);
      return autoCropImageFile(file).then(function (result) {
        if (result && result.blob) return new File([result.blob], file.name, { type: 'image/jpeg' });
        return file;
      }).catch(function () { return file; });
    }

    // Picking several files at once (via "Choose a file", which now allows
    // multiple) skips the single-file capture flow above - there's no one
    // set of fields to prefill for several different documents at once -
    // and instead uploads each one as its own submission: each image is
    // auto-cropped first (see cropIfImage), then scanned and uploaded
    // through the shared engine every other upload point on the site uses
    // for this (window.HouseagoDocScan.bulkUploadFiles), which also
    // handles the per-file duplicate check, on the cropped version so
    // detection reads off the same tighter image a single upload would.
    // "Type" and "Relates to" apply to the whole batch (there's nowhere to
    // set them per file), so they're required up front, same as "Type"
    // already is for a single submission.
    function handleBulkFiles(files) {
      if (!client || !currentSession) {
        fileStatus.textContent = 'This is a sample preview, so there is nothing real to upload yet.';
        return;
      }
      if (!expenseTypeSelect.value) {
        fileStatus.textContent = 'Please choose a Type below first - it applies to the whole batch - then choose your files again.';
        return;
      }
      var relatedEntityId = relatedSelect.value || null;
      var expenseCategoryChosen = categorySelect.value || null;
      var expenseType = expenseTypeSelect.value;
      var thisYear = String(new Date().getFullYear());

      fileStatus.textContent = 'Preparing ' + files.length + ' files…';
      Promise.all(files.map(cropIfImage)).then(function (preparedFiles) {
        fileStatus.textContent = 'Uploading ' + preparedFiles.length + ' files…';
        return window.HouseagoDocScan.bulkUploadFiles(preparedFiles, {
          client: client,
          entityId: ENTITY_ID,
          session: currentSession,
          scanFn: window.HouseagoDocScan.scanFileForReceiptFields,
          onProgress: function (done, total) { fileStatus.textContent = 'Uploading ' + done + ' of ' + total + '…'; },
          buildRow: function (fields, file) {
            var guess = guessNameAndDescription(fields);
            return {
              name: guess.name || file.name.replace(/\.[^.]+$/, ''),
              year: fields.year || thisYear,
              doc_date: fields.date || null,
              amount: fields.amount != null ? Math.round(fields.amount * 100) / 100 : null,
              notes: guess.description || null,
              related_entity_id: relatedEntityId,
              expense_category: expenseCategoryChosen || fields.category || guessCategoryFromItems(fields.text),
              expense_type: expenseType
            };
          }
        });
      }).then(function (results) {
        fileStatus.textContent = window.HouseagoDocScan.summarizeBulkResults(results);
        loadReceipts(true);
      });
    }

    function applyScanResult(fields) {
      if (fields.date) {
        dateInput.value = fields.date;
        trackAutofill(dateInput, fields.date);
        dateStatus.textContent = 'Date detected automatically from the document. Please check it is correct.';
      } else {
        dateStatus.textContent = "Could not detect a date automatically - the photo is still attached, please enter the date below.";
      }
      if (fields.amount != null) {
        amountInput.value = fields.amount.toFixed(2);
        trackAutofill(amountInput, fields.amount.toFixed(2));
        amountStatus.textContent = 'Amount detected automatically. Please check it is correct.';
      } else {
        amountStatus.textContent = "Could not detect an amount automatically - please enter it below if known.";
      }
      var guess = guessNameAndDescription(fields);
      if (guess.name && nameInput && !nameInput.value) {
        nameInput.value = guess.name;
        trackAutofill(nameInput, guess.name);
      }
      if (guess.description && descInput && !descInput.value) {
        descInput.value = guess.description;
        trackAutofill(descInput, guess.description);
      }
      var category = fields.category || guessCategoryFromItems(fields.text);
      if (category && categorySelect && !categorySelect.value) {
        var hasOption = Array.prototype.some.call(categorySelect.options, function (o) { return o.value === category; });
        if (hasOption) { categorySelect.value = category; trackAutofill(categorySelect, category); }
      }
    }

    if (captureBtn && cameraInput) {
      captureBtn.addEventListener('click', function () { cameraInput.click(); });
      cameraInput.addEventListener('change', function () { handleFileChosen(cameraInput.files[0]); });
    }
    if (chooseBtn && pickerInput) {
      chooseBtn.addEventListener('click', function () { pickerInput.click(); });
      pickerInput.addEventListener('change', function () {
        var files = pickerInput.files;
        if (files.length > 1) {
          handleBulkFiles(Array.prototype.slice.call(files));
          pickerInput.value = '';
          return;
        }
        handleFileChosen(files[0]);
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        resetCaptureState();
        revertAutofills();
        if (cameraInput) cameraInput.value = '';
        if (pickerInput) pickerInput.value = '';
        fileStatus.textContent = 'No file chosen yet. You can select more than one at once with "Choose a file".';
        dateStatus.textContent = "Choose a file above and we'll try to read its date automatically.";
        amountStatus.textContent = '';
        clearBtn.hidden = true;
      });
    }

    document.querySelectorAll('[data-portal-logout]').forEach(function (link) {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        if (client) {
          client.auth.signOut().then(function () { window.location.href = 'index.html'; });
        } else {
          window.location.href = 'index.html';
        }
      });
    });

    // ---- Configured, but the Supabase library itself failed to load ----
    if (keysConfigured && !libraryLoaded) {
      listCard.hidden = false;
      listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>This page could not load just now. Please refresh and try again in a moment.</div></div></div>';
      return;
    }

    // ---- Not configured yet: sample preview ----
    if (!client) {
      listCard.hidden = false;
      uploadCard.hidden = false;
      relatedSelect.innerHTML =
        '<option value="">General / Other</option>' +
        '<option>Houseago Properties Ltd</option>' +
        '<option>33 North Denes</option>' +
        '<option>6 Chaucer Street</option>' +
        '<option>6a Chaucer Street</option>';
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        alert('This is a sample preview. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).');
      });
      var sample = [
        { name: 'Boiler repair', doc_date: '2026-08-14', notes: 'Emergency callout, paid by card', related: '33 North Denes', amount: 145 },
        { name: 'Letting agent fee', doc_date: '2026-08-02', notes: 'Re-let fee for the new tenancy', related: '6 Chaucer Street', amount: 240 },
        { name: 'Boiler service', doc_date: '2025-11-20', notes: 'Annual service and safety check', related: '33 North Denes', amount: 95 }
      ];
      listEl.innerHTML = sample.map(function (row) {
        return (
          '<div class="doc-row"><div class="doc-row-main"><div class="doc-icon">' + receiptIconSvg() + '</div><div>' +
            '<div class="doc-name">' + row.name + '</div>' +
            '<div class="doc-meta">' + formatDate(row.doc_date) + ' · ' + formatCurrency(row.amount) + ' · ' + row.notes + ' · ' + row.related + '</div>' +
          '</div></div><a href="#" class="btn btn-outline">Download</a></div>'
        );
      }).join('');
      listEl.querySelectorAll('a[href="#"]').forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          alert('This is a sample submission. Add your Supabase project details to assets/supabase-config.js to make this real (see SETUP.md).');
        });
      });
      renderExpenseChart(sample);
      return;
    }

    client.auth.getSession().then(function (result) {
      var session = result.data.session;
      if (!session) {
        window.location.href = 'index.html';
        return;
      }
      currentSession = session;

      client
        .from('portal_access')
        .select('can_upload')
        .eq('entity_id', ENTITY_ID)
        .maybeSingle()
        .then(function (accessResult) {
          if (accessResult.error || !accessResult.data) {
            accessNote.hidden = false;
            return;
          }

          var canUpload = !!accessResult.data.can_upload;
          listCard.hidden = false;

          if (canUpload) {
            uploadCard.hidden = false;
            loadRelatedOptions();
            wireUploadForm(session);
          }

          loadReceipts(canUpload);
        });
    });

    function loadRelatedOptions() {
      client
        .from('entities')
        .select('id, name, sort_order')
        .then(function (result) {
          if (result.error) return;
          // Only entities that make sense as a "relates to" target - the Ltd
          // company, a sole trader/finances account, or a property - not a
          // property's own Compliance & Tenancy/Insurance/Income sub-section,
          // anyone's Bank Statements/Investment/Employment/Receipts
          // sub-entity, or this page's own entity.
          var excludedSuffixes = ['-insurance', '-compliance-tenancy', '-income', '-bank-statements', '-investment-dividends', '-employment-payslips', '-receipts-invoices'];
          var options = (result.data || [])
            .filter(function (e) {
              if (e.id === ENTITY_ID) return false;
              return !excludedSuffixes.some(function (suf) { return e.id.indexOf(suf) !== -1; });
            })
            .sort(function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

          relatedSelect.innerHTML = '<option value="">General / Other</option>' +
            options.map(function (e) { return '<option value="' + escapeAttr(e.id) + '">' + escapeHtml(e.name) + '</option>'; }).join('');
        });
    }

    function renderReceiptRow(doc, canUpload, namesById) {
      var metaBits = [];
      if (doc.doc_date) metaBits.push(formatDate(doc.doc_date));
      if (doc.amount != null) metaBits.push(formatCurrency(doc.amount));
      if (doc.expense_type) metaBits.push(doc.expense_type);
      if (doc.expense_category) metaBits.push(doc.expense_category);
      if (doc.notes) metaBits.push(doc.notes);
      if (doc.related_entity_id && namesById[doc.related_entity_id]) metaBits.push(namesById[doc.related_entity_id]);
      else if (!doc.related_entity_id) metaBits.push('General / Other');

      var row = document.createElement('div');
      row.className = 'doc-row';
      row.innerHTML =
        '<div class="doc-row-main">' +
          '<div class="doc-icon">' + receiptIconSvg() + '</div>' +
          '<div>' +
            '<div class="doc-name">' + escapeHtml(doc.name || 'Receipt') + '</div>' +
            '<div class="doc-meta">' + escapeHtml(metaBits.join(' · ')) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="doc-row-actions">' +
          (canUpload ? '<button type="button" class="btn-text" data-delete>Delete</button>' : '') +
          '<a href="#" class="btn btn-outline">Download</a>' +
        '</div>';

      row.querySelector('a').addEventListener('click', function (e) {
        e.preventDefault();
        client.storage
          .from('owner-documents')
          .createSignedUrl(doc.file_path, 300)
          .then(function (signedResult) {
            if (signedResult.error || !signedResult.data) {
              alert('This file could not be opened. Please try again.');
              return;
            }
            window.open(signedResult.data.signedUrl, '_blank', 'noopener');
          });
      });

      var deleteBtn = row.querySelector('[data-delete]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', function () {
          if (!window.confirm('Delete "' + doc.name + '"? This cannot be undone.')) return;
          client.storage.from('owner-documents').remove([doc.file_path]).then(function () {
            client.from('entity_documents').delete().eq('id', doc.id).then(function () {
              loadReceipts(canUpload);
            });
          });
        });
      }

      return row;
    }

    function renderReceiptList(docs, selectedYear, canUpload, namesById) {
      var filtered = selectedYear
        ? docs.filter(function (doc) { return String(doc.year || '') === selectedYear; })
        : docs;

      listEl.innerHTML = '';
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>' +
          (selectedYear ? 'Nothing submitted for ' + escapeHtml(selectedYear) + '.' : 'Nothing submitted yet.') +
          '</div></div></div>';
        return;
      }
      filtered.forEach(function (doc) {
        listEl.appendChild(renderReceiptRow(doc, canUpload, namesById));
      });
    }

    function loadReceipts(canUpload) {
      // Fetch every entity too, purely to label a submission's related_entity_id
      // with a readable name in the list below.
      client.from('entities').select('id, name').then(function (entitiesResult) {
        var namesById = {};
        (entitiesResult.data || []).forEach(function (e) { namesById[e.id] = e.name; });

        client
          .from('entity_documents')
          .select('*')
          .eq('entity_id', ENTITY_ID)
          .order('doc_date', { ascending: false, nullsFirst: false })
          .then(function (result) {
            if (result.error) {
              listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>Could not load these right now. Please try again shortly.</div></div></div>';
              return;
            }

            var docs = result.data || [];
            latestReceiptDocs = docs;
            latestNamesById = namesById;
            renderExpenseChart(docs);

            if (docs.length === 0) {
              yearFilterRow.hidden = true;
              listEl.innerHTML = '<div class="doc-row"><div class="doc-row-main"><div>Nothing submitted yet.</div></div></div>';
              return;
            }

            var years = [];
            docs.forEach(function (doc) {
              if (doc.year && years.indexOf(String(doc.year)) === -1) years.push(String(doc.year));
            });
            years.sort(function (a, b) { return b - a; });

            if (years.length > 0) {
              yearFilterRow.hidden = false;
              yearSelect.innerHTML = '<option value="">All years</option>' +
                years.map(function (y) { return '<option value="' + escapeAttr(y) + '">' + escapeHtml(y) + '</option>'; }).join('');
              yearSelect.onchange = function () {
                renderReceiptList(docs, yearSelect.value, canUpload, namesById);
              };
            } else {
              yearFilterRow.hidden = true;
            }

            renderReceiptList(docs, yearSelect.value, canUpload, namesById);
          });
      });
    }

    function wireUploadForm(session) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!form.checkValidity()) { form.reportValidity(); return; }
        var upload = currentUploadFile();
        if (!upload) { fileStatus.textContent = 'Please take a photo or choose a file first.'; return; }

        var name = nameInput.value.trim();
        var date = dateInput.value;
        var amountRaw = amountInput.value;
        var amount = amountRaw !== '' ? Math.round(parseFloat(amountRaw) * 100) / 100 : null;
        var description = descInput.value.trim();
        var relatedEntityId = relatedSelect.value || null;
        var expenseCategory = categorySelect.value || null;
        var expenseType = expenseTypeSelect ? (expenseTypeSelect.value || null) : null;
        var status = document.getElementById('receipt-upload-status');
        var submitBtn = form.querySelector('button[type="submit"]');

        function doSubmit(hash) {
          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting…';
          status.textContent = '';

          window.HouseagoPdfConvert.toPdfIfImage(upload).then(function (finalUpload) {
            var safeFileName = finalUpload.name.replace(/[^a-zA-Z0-9._-]/g, '-');
            var path = ENTITY_ID + '/' + Date.now() + '-' + safeFileName;

            client.storage.from('owner-documents').upload(path, finalUpload.blob, { contentType: finalUpload.type || undefined }).then(function (uploadResult) {
              if (uploadResult.error) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
                status.textContent = 'Could not upload that file. Please try again.';
                return;
              }

              client.from('entity_documents').insert({
                entity_id: ENTITY_ID,
                name: name,
                year: date ? date.slice(0, 4) : null,
                doc_date: date || null,
                amount: (amount != null && !isNaN(amount)) ? amount : null,
                notes: description || null,
                related_entity_id: relatedEntityId,
                expense_category: expenseCategory,
                expense_type: expenseType,
                file_path: path,
                file_hash: hash || null,
                uploaded_by: session.user.id
              }).then(function (insertResult) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit';
                if (insertResult.error) {
                  status.textContent = 'The file uploaded, but could not be saved. Please try again.';
                  return;
                }
                status.textContent = 'Submitted.';
                form.reset();
                resetCaptureState();
                scanAutofilled = [];
                if (clearBtn) clearBtn.hidden = true;
                loadReceipts(true);
              });
            });
          });
        }

        // Flag re-submitting the exact same file, same as every other
        // upload point on the site - the file's own bytes are hashed and
        // checked against what's already on this Receipts & Invoices
        // entity, so a receipt photographed or picked twice by mistake
        // gets a confirmation rather than a silent duplicate.
        window.HouseagoDocScan.hashFile(upload.blob).then(function (hash) {
          window.HouseagoDocScan.findDuplicateByHash(client, ENTITY_ID, hash).then(function (existing) {
            if (existing && !window.confirm('This exact file looks like it’s already been submitted (as "' + existing.name + '"). Submit it again anyway?')) {
              status.textContent = 'Not submitted - already on file.';
              return;
            }
            doSubmit(hash);
          });
        });
      });
    }
  });
})();
