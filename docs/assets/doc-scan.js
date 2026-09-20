// Shared document-scanning engine, used by every file-upload point on the
// site: the Ltd company, sole trader and Iris Houseago Finances uploads on
// the dashboard (assets/auth.js); a property's Documents, Compliance &
// Tenancy and Insurance uploads plus its "scan a bank statement for rent"
// tool (assets/property.js); a person's own submission points (General
// Documents, Bank Statements, Investment & Dividend Returns, Employment/
// Payslips) plus their nested properties' Documents and income-scan
// (assets/person.js); and Receipts & Invoices (assets/receipts.js).
//
// None of this is a real document reader. It is OCR (via Tesseract, for
// photographed/scanned images) or a PDF's own text layer (via pdf.js), fed
// through plain keyword and pattern matching to guess a date, an amount, or
// (for a bank statement) lines that look like rent. Every guess is shown
// for a person to check, edit, or discard - nothing is saved automatically,
// and nothing about the file itself is stored anywhere, only whatever
// fields a person chooses to keep.
//
// Pages that use this must load pdf.js and Tesseract.js before this file -
// see the <script> order in receipts.html, property.html, person.html and
// dashboard.html.

(function () {
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }

  function normaliseYear(y) {
    y = parseInt(y, 10);
    if (y < 100) y += (y < 50 ? 2000 : 1900);
    return y;
  }

  function isValidYmd(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
    if (y < 2000 || y > (new Date().getFullYear() + 1)) return false;
    var dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  function toIso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  var MONTH_NAMES = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
    sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  // Finds the best candidate in `text` among everything `patterns` matched,
  // preferring one that sits shortly after a label from `keywordRegex` (and,
  // among labels, a longer/more specific one over a generic one) - falling
  // back to `fallbackCompare` (default: reading order) when no label helps.
  function pickBestCandidate(candidates, text, keywordRegex, opts) {
    opts = opts || {};
    if (candidates.length === 0) return null;

    var keywordSpans = [];
    var km;
    keywordRegex.lastIndex = 0;
    while ((km = keywordRegex.exec(text))) {
      if (opts.keywordFilter && !opts.keywordFilter(text, km)) continue;
      keywordSpans.push({ end: km.index + km[0].length, len: km[0].length });
    }

    if (keywordSpans.length > 0) {
      var best = null, bestScore = Infinity;
      candidates.forEach(function (c) {
        keywordSpans.forEach(function (span) {
          var dist = c.index - span.end;
          if (dist < 0 || dist >= 40) return;
          var score = dist - span.len;
          if (score < bestScore) { bestScore = score; best = c; }
        });
      });
      if (best) return best;
    }

    var sorted = candidates.slice();
    sorted.sort(opts.fallbackCompare || function (a, b) { return a.index - b.index; });
    return sorted[0];
  }

  var DATE_PATTERNS = [
    // 2026-08-14 or 2026/08/14
    { re: /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/g, extract: function (m) {
        var y = +m[1], mo = +m[2], d = +m[3];
        return isValidYmd(y, mo, d) ? toIso(y, mo, d) : null;
      } },
    // 14 August 2026 / 14th Aug 2026
    { re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/g, extract: function (m) {
        var mon = MONTH_NAMES[m[2].toLowerCase()];
        if (!mon) return null;
        var y = normaliseYear(m[3]);
        return isValidYmd(y, mon, +m[1]) ? toIso(y, mon, +m[1]) : null;
      } },
    // August 14, 2026
    { re: /\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})\b/g, extract: function (m) {
        var mon = MONTH_NAMES[m[1].toLowerCase()];
        if (!mon) return null;
        var y = normaliseYear(m[3]);
        return isValidYmd(y, mon, +m[2]) ? toIso(y, mon, +m[2]) : null;
      } },
    // 14/08/2026, 14-08-2026, 14.08.2026 (day first, UK convention)
    { re: /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/g, extract: function (m) {
        var d = +m[1], mo = +m[2], y = normaliseYear(m[3]);
        return isValidYmd(y, mo, d) ? toIso(y, mo, d) : null;
      } }
  ];

  var DATE_KEYWORDS = /(invoice date|date of invoice|tax point|date issued|receipt date|transaction date|date paid|valid until|expiry date|expires|renewal date|date)/ig;

  function parseDateFromText(text) {
    if (!text) return null;
    var candidates = [];
    DATE_PATTERNS.forEach(function (p) {
      var re = new RegExp(p.re.source, p.re.flags);
      var m;
      while ((m = re.exec(text))) {
        var iso = p.extract(m);
        if (iso) candidates.push({ index: m.index, iso: iso });
        if (re.lastIndex === m.index) re.lastIndex++;
      }
    });
    var best = pickBestCandidate(candidates, text, DATE_KEYWORDS);
    return best ? best.iso : null;
  }

  var AMOUNT_PATTERN = /[£$]?\s?(\d{1,3}(?:,\d{3})*\.\d{2})\b/g;
  var AMOUNT_KEYWORDS = /(grand total|total due|total to pay|amount due|balance due|amount paid|total amount|sub ?total|total)/ig;

  function amountKeywordFilter(text, m) {
    var word = m[0].toLowerCase().replace(/\s+/g, '');
    if (word === 'subtotal') return false; // never treat "subtotal" as the total
    if (word === 'total') {
      // exclude a bare "total" that's really part of "sub total" / "subtotal"
      var before = text.slice(Math.max(0, m.index - 5), m.index).toLowerCase();
      if (/sub[\s-]*$/.test(before)) return false;
    }
    return true;
  }

  function parseAmountFromText(text) {
    if (!text) return null;
    var candidates = [];
    var re = new RegExp(AMOUNT_PATTERN.source, AMOUNT_PATTERN.flags);
    var m;
    while ((m = re.exec(text))) {
      var value = parseFloat(m[1].replace(/,/g, ''));
      if (!isNaN(value) && value > 0 && value < 100000) candidates.push({ index: m.index, value: value });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    var best = pickBestCandidate(candidates, text, AMOUNT_KEYWORDS, {
      keywordFilter: amountKeywordFilter,
      // No label found near any figure? On a simple document the total is
      // usually the largest amount printed, so fall back to that rather
      // than just the first number (often a smaller line item).
      fallbackCompare: function (a, b) { return b.value - a.value; }
    });
    return best ? best.value : null;
  }

  // ---- Year extraction ----------------------------------------------------
  // Prefers whatever year the date scan already found (the common case);
  // otherwise looks for a standalone year, favouring one that sits near a
  // label like "tax year" or "year ended" over the first 4-digit number on
  // the page.
  var YEAR_KEYWORDS = /(tax year|year ended|year ending|financial year|accounting period|period ended|period ending)/ig;
  var YEAR_PATTERN = /\b(20\d{2})\b/g;

  function parseYearFromText(text) {
    if (!text) return null;
    var candidates = [];
    var re = new RegExp(YEAR_PATTERN.source, YEAR_PATTERN.flags);
    var m;
    var maxYear = new Date().getFullYear() + 1;
    while ((m = re.exec(text))) {
      var y = parseInt(m[1], 10);
      if (y >= 2000 && y <= maxYear) candidates.push({ index: m.index, year: y });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    var best = pickBestCandidate(candidates, text, YEAR_KEYWORDS);
    return best ? String(best.year) : null;
  }

  // ---- Expense categories & document-type guessing -------------------------
  // A fixed pick-list rather than free text, kept short and roughly matching
  // how a UK property tax return groups expenses - shared by every upload
  // point on the site so "Repairs & maintenance" means the same thing
  // wherever it's picked.
  var EXPENSE_CATEGORIES = [
    'Repairs & maintenance',
    'Insurance',
    'Letting & management fees',
    'Legal & professional fees',
    'Ground rent & service charges',
    'Mortgage / loan interest',
    'Utilities',
    'Cleaning & gardening',
    'Other'
  ];

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function categoryOptionsHtml(placeholder) {
    return '<option value="">' + escapeAttr(placeholder || 'Uncategorised') + '</option>' +
      EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + escapeAttr(c) + '">' + escapeAttr(c) + '</option>'; }).join('');
  }

  // categoryFieldHtml(opts) -> a ready-to-insert "Expense category" field,
  // for forms that don't build their own <select>.
  function categoryFieldHtml(opts) {
    opts = opts || {};
    var label = opts.label || 'Expense category (optional)';
    return '<div><label>' + escapeAttr(label) + '</label><select name="expense_category" data-scan-category>' + categoryOptionsHtml() + '</select></div>';
  }

  function populateCategorySelect(selectEl, opts) {
    if (!selectEl) return;
    opts = opts || {};
    selectEl.innerHTML = categoryOptionsHtml(opts.placeholder);
  }

  // Keyword -> best-guess document title + expense category, checked in
  // order so a more specific match (e.g. "gas safety") wins over a vaguer
  // one further down the list. Every guess here is only ever a starting
  // point - shown for a person to check, edit, or clear, exactly like the
  // date/amount guesses above; nothing is ever assumed to be right.
  var DOC_TYPE_RULES = [
    { re: /garden|landscap|lawn|hedge/i, title: 'Garden Maintenance', category: 'Cleaning & gardening' },
    { re: /clean(?:er|ing)?/i, title: 'Cleaning', category: 'Cleaning & gardening' },
    { re: /letting agent|estate agent|managing agent|property management|management fee/i, title: 'Estate Agent Management', category: 'Letting & management fees' },
    { re: /gas safety|landlord'?s? gas|\bcp ?12\b/i, title: 'Gas Safety Certificate', category: 'Repairs & maintenance' },
    { re: /\beicr\b|electrical installation condition/i, title: 'EICR', category: 'Repairs & maintenance' },
    { re: /\bepc\b|energy performance certificate/i, title: 'EPC', category: 'Repairs & maintenance' },
    { re: /legionella/i, title: 'Legionella Risk Assessment', category: 'Repairs & maintenance' },
    { re: /deposit protection|tenancy deposit/i, title: 'Deposit Protection', category: 'Letting & management fees' },
    { re: /inventory (?:report|check-?in|check-?out)/i, title: 'Inventory Report', category: 'Letting & management fees' },
    { re: /boiler|plumb(?:er|ing)|heating engineer|gas engineer/i, title: 'Plumbing & Heating', category: 'Repairs & maintenance' },
    { re: /electrician|electrical repair/i, title: 'Electrical Repairs', category: 'Repairs & maintenance' },
    { re: /roofer|roofing/i, title: 'Roofing', category: 'Repairs & maintenance' },
    { re: /locksmith/i, title: 'Locksmith', category: 'Repairs & maintenance' },
    { re: /pest control/i, title: 'Pest Control', category: 'Repairs & maintenance' },
    { re: /insurance/i, title: 'Insurance', category: 'Insurance' },
    { re: /mortgage|loan interest/i, title: 'Mortgage Statement', category: 'Mortgage / loan interest' },
    { re: /solicitor|conveyanc|legal fee/i, title: 'Legal Fees', category: 'Legal & professional fees' },
    { re: /accountant|bookkeep/i, title: 'Accountancy Fees', category: 'Legal & professional fees' },
    { re: /ground rent/i, title: 'Ground Rent', category: 'Ground rent & service charges' },
    { re: /service charge/i, title: 'Service Charge', category: 'Ground rent & service charges' },
    { re: /council tax/i, title: 'Council Tax', category: 'Utilities' },
    { re: /water (?:bill|rates|board)/i, title: 'Water Bill', category: 'Utilities' },
    { re: /electricity bill|energy bill|gas bill/i, title: 'Utility Bill', category: 'Utilities' },
    { re: /broadband|internet (?:bill|provider)/i, title: 'Broadband', category: 'Utilities' }
  ];

  function guessDocType(text) {
    if (!text) return null;
    for (var i = 0; i < DOC_TYPE_RULES.length; i++) {
      if (DOC_TYPE_RULES[i].re.test(text)) return { title: DOC_TYPE_RULES[i].title, category: DOC_TYPE_RULES[i].category };
    }
    return null;
  }

  // ---- Income vs outgoing guessing (the ledger on a property/person's own
  // "Income & Outgoings" section) -------------------------------------------
  // A hand-typed ledger entry, or one with a receipt attached, can be
  // either money coming in (rent) or money going out (a gardener, an
  // insurance renewal) - this is only ever a starting guess for the
  // "Income or outgoing" field, always left changeable.
  var INCOME_TYPE_KEYWORDS = /\brent\b|rental income|tenant payment|deposit received/i;

  function guessEntryType(text) {
    if (!text) return null;
    if (INCOME_TYPE_KEYWORDS.test(text)) return 'Income';
    if (guessDocType(text)) return 'Outgoing';
    return null;
  }

  // A phone photo of a receipt is almost never as clean as a proper scan -
  // uneven lighting, a shadow across half the page, a slightly grey
  // "white" background - and Tesseract (like most OCR) reads noticeably
  // worse on that than on a flat, high-contrast image. This redraws the
  // photo in grayscale with its contrast stretched so the darkest pixel in
  // the shot becomes black and the lightest becomes white, before handing
  // it to Tesseract - a standard, well-understood preprocessing step for
  // OCR-on-photos (as opposed to OCR-on-scans) that costs a fraction of a
  // second and measurably improves read rates on uneven lighting, without
  // ever risking making a fine image worse in a way that matters (a
  // photo that was already high-contrast is stretched to essentially
  // itself). Never blocks OCR: any failure here just falls back to
  // running Tesseract on the original, untouched file.
  function preprocessForOcr(imageSource) {
    if (!(imageSource instanceof Blob)) return Promise.resolve(imageSource);
    return loadImageFromBlob(imageSource).then(function (loaded) {
      var img = loaded.img;
      var w = img.naturalWidth, h = img.naturalHeight;
      URL.revokeObjectURL(loaded.url);
      if (!w || !h) return imageSource;

      // Cap the working size - OCR accuracy doesn't keep improving much
      // past ~1800px on the long edge, and a modern phone photo can
      // easily be 3-4x that, which just makes Tesseract slower for no
      // benefit.
      var scale = Math.min(1, 1800 / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);

      var imgData;
      try {
        imgData = ctx.getImageData(0, 0, cw, ch);
      } catch (e) {
        return imageSource; // can't read pixels back - just OCR the original
      }
      var data = imgData.data;

      var n = cw * ch;
      var gray = new Uint8ClampedArray(n);
      var lo = 255, hi = 0;
      for (var i = 0, p = 0; i < data.length; i += 4, p++) {
        var g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        gray[p] = g;
        if (g < lo) lo = g;
        if (g > hi) hi = g;
      }
      var range = hi - lo;
      if (range < 10) return imageSource; // already flat/blank - stretching would just amplify noise

      var factor = 255 / range;
      for (var p2 = 0, di = 0; p2 < n; p2++, di += 4) {
        var v = Math.round((gray[p2] - lo) * factor);
        data[di] = data[di + 1] = data[di + 2] = v;
      }
      ctx.putImageData(imgData, 0, 0);

      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob || imageSource); }, 'image/jpeg', 0.95);
      });
    }).catch(function () { return imageSource; });
  }

  function loadImageFromBlob(blob) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('image load failed')); };
      img.src = url;
    });
  }

  function ocrText(imageSource) {
    if (typeof Tesseract === 'undefined') return Promise.resolve('');
    return preprocessForOcr(imageSource).then(function (prepared) {
      return Tesseract.recognize(prepared, 'eng');
    }).then(function (result) { return (result && result.data && result.data.text) || ''; })
      .catch(function () { return ''; });
  }

  // Multi-page text layer extraction (falls back to page-1 canvas OCR only
  // when there's no text layer at all - a scanned image-only PDF beyond
  // page 1 isn't OCR'd, to keep this fast; the "nothing usable found"
  // outcome just means falling back to filling fields in by hand).
  function extractTextFromPdf(file) {
    if (typeof pdfjsLib === 'undefined') return Promise.resolve('');
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@2.16.105/build/pdf.worker.min.js';
    } catch (e) { /* ignore */ }

    return file.arrayBuffer().then(function (buf) {
      return pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pageTexts = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (pageNum) {
          chain = chain.then(function () {
            return pdf.getPage(pageNum).then(function (page) {
              return page.getTextContent().then(function (content) {
                pageTexts.push((content.items || []).map(function (it) { return it.str; }).join(' '));
              });
            });
          });
        })(i);
      }
      return chain.then(function () {
        var joined = pageTexts.join('\n');
        if (joined.trim().length > 20) return joined;

        // Likely a scanned/image-only PDF with no text layer - render just
        // the first page to a canvas and OCR that as a first pass.
        return pdf.getPage(1).then(function (page) {
          var viewport = page.getViewport({ scale: 2 });
          var canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          var ctx = canvas.getContext('2d');
          return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
            return new Promise(function (resolve) {
              canvas.toBlob(function (blob) {
                if (!blob) { resolve(''); return; }
                ocrText(blob).then(resolve);
              });
            });
          });
        });
      });
    }).catch(function () { return ''; });
  }

  function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  }

  function isImageFile(file) {
    return /^image\//.test(file.type || '') || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name || '');
  }

  function extractTextFromFile(file) {
    if (!file) return Promise.resolve('');
    if (isPdfFile(file)) return extractTextFromPdf(file);
    if (isImageFile(file)) return ocrText(file);
    return Promise.resolve('');
  }

  // Reads whichever fields it can off a file in one pass of text: a date,
  // an amount, a guessed document title + expense category, and a year
  // (preferring the date's own year, falling back to one found in the
  // text) - all mined from the same extracted text.
  function scanFileForFields(file) {
    return extractTextFromFile(file).then(function (text) {
      var date = parseDateFromText(text);
      var docType = guessDocType(text);
      return {
        date: date,
        amount: parseAmountFromText(text),
        year: date ? date.slice(0, 4) : parseYearFromText(text),
        title: docType ? docType.title : null,
        category: docType ? docType.category : null,
        entryType: guessEntryType(text),
        text: text
      };
    }).catch(function () { return { date: null, amount: null, year: null, title: null, category: null, entryType: null, text: '' }; });
  }

  // ---- Azure-backed receipt scan (Receipts & Invoices only) --------------
  // The generic scanFileForFields above (keyword/pattern matching over raw
  // OCR text) is used everywhere on the site - compliance certificates,
  // insurance policies, bank statements, payslips - and stays exactly as it
  // is for all of that. A proper receipt has a much more regular shape
  // (merchant name, a total, a date, line items), so for Receipts &
  // Invoices specifically we first try the supabase/functions/scan-receipt
  // Edge Function, which hands the file to Azure AI Document Intelligence's
  // purpose-built receipt model and gets back already-parsed fields instead
  // of raw text to guess over.
  //
  // This is entirely optional infrastructure: until AZURE_DOC_INTEL_ENDPOINT
  // and AZURE_DOC_INTEL_KEY are set as secrets on that function (see
  // SETUP.md), it replies { error: 'not_configured' } and
  // scanFileForReceiptFields below falls straight back to the same free,
  // fully client-side scan every other upload point on the site already
  // uses - so receipts scanning keeps working, Azure configured or not.
  // The same fallback applies to any other failure (offline, a timeout, an
  // Azure error) - a person submitting a receipt should never see this
  // fail outright just because the upgraded path had a bad moment.
  var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // The scan-receipt function itself gives up on Azure after 45s server-side,
  // but a browser fetch with no timeout of its own can still hang far longer
  // than that if the network or the function is having a bad moment (a
  // dropped connection can sit "pending" for minutes). This bounds how long
  // a receipt submission will ever wait on Azure before giving up and
  // falling back to the free scan - comfortably longer than a normal Azure
  // round trip, short enough that nobody submitting a receipt is left
  // watching "reading..." for an unreasonable amount of time.
  var AZURE_SCAN_TIMEOUT_MS = 30000;

  function postFileToScanReceiptFunction(file, accessToken) {
    var keysConfigured =
      typeof SUPABASE_URL !== 'undefined' &&
      typeof SUPABASE_ANON_KEY !== 'undefined' &&
      SUPABASE_URL.indexOf('YOUR_SUPABASE') !== 0;
    // Azure scanning is reserved for a real, signed-in portal session - the
    // function itself checks this server-side, but there's no point making
    // the round trip at all without a real session token on hand (sample-
    // preview mode, or a call that raced ahead of the session loading).
    // The anon key is NOT a substitute here: it's meant to be public (see
    // SETUP.md), so it isn't proof anyone signed in.
    if (!keysConfigured || !accessToken) return Promise.resolve(null);

    try {
      var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, AZURE_SCAN_TIMEOUT_MS) : null;

      return fetch(SUPABASE_URL + '/functions/v1/scan-receipt', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + accessToken,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file,
        signal: controller ? controller.signal : undefined
      }).then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) return null; // includes the normal "not configured yet" case (501)
        return res.json().catch(function () { return null; });
      }).catch(function () {
        if (timer) clearTimeout(timer);
        return null; // offline, CORS, a timed-out abort, ... - never blocks the fallback below
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // Turns Azure's already-structured result into the same shape
  // scanFileForFields returns, so callers (receipts.js) don't need to know
  // which path actually answered. Line items become a small synthetic
  // "text" block (one "<description>  <amount>" line each) so the existing
  // guessReceiptName/extractPurchasedItems/category fallbacks in
  // receipts.js still have something to work with on the (rare) receipt
  // where Azure found line items but no merchant name.
  function mapAzureReceiptResult(azureResult) {
    if (!azureResult || (!azureResult.merchant && !azureResult.date && azureResult.total == null)) return null;

    var items = azureResult.items || [];
    var itemsText = items
      .filter(function (i) { return i && i.description; })
      .map(function (i) { return i.description + (i.amount != null ? '  ' + i.amount.toFixed(2) : ''); })
      .join('\n');
    var scanText = (azureResult.merchant || '') + '\n' + itemsText;

    var date = (typeof azureResult.date === 'string' && ISO_DATE_RE.test(azureResult.date)) ? azureResult.date : null;
    var docType = guessDocType(scanText);

    return {
      date: date,
      amount: (typeof azureResult.total === 'number') ? Math.round(azureResult.total * 100) / 100 : null,
      year: date ? date.slice(0, 4) : null,
      title: azureResult.merchant || (docType ? docType.title : null),
      category: docType ? docType.category : null,
      entryType: guessEntryType(scanText),
      text: scanText
    };
  }

  // The entry point receipts.js uses in place of scanFileForFields: Azure
  // first (images/PDFs only - Azure's receipt model has nothing useful to
  // do with anything else), the existing free OCR/text-layer scan whenever
  // Azure isn't configured, fails, or comes back with nothing usable.
  function scanFileForReceiptFields(file, accessToken) {
    var eligible = file && (isImageFile(file) || isPdfFile(file));
    if (!eligible) return scanFileForFields(file);

    return postFileToScanReceiptFunction(file, accessToken).then(function (azureResult) {
      var mapped = mapAzureReceiptResult(azureResult);
      if (mapped) return mapped;
      return scanFileForFields(file);
    }).catch(function () { return scanFileForFields(file); });
  }

  // ---- Bank-statement rent scan (property/person Income sections) -------
  var INCOME_KEYWORDS = ['rent', 'rental'];
  var LINE_AMOUNT_RE = /£?\s?(\d{1,3}(?:,\d{3})*\.\d{2})\b/;
  var LINE_DATE_RE = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;

  function extractLikelyIncomeLines(text) {
    var lines = (text || '').split(/\r?\n/);
    var found = [];
    lines.forEach(function (line) {
      var lower = line.toLowerCase();
      var hasKeyword = INCOME_KEYWORDS.some(function (k) { return lower.indexOf(k) !== -1; });
      if (!hasKeyword) return;
      var amountMatch = line.match(LINE_AMOUNT_RE);
      if (!amountMatch) return;
      var dateMatch = line.match(LINE_DATE_RE);
      found.push({
        description: line.trim().slice(0, 140),
        amount: parseFloat(amountMatch[1].replace(/,/g, '')),
        date: dateMatch ? dateMatch[1] : ''
      });
    });
    return found;
  }

  function parseLooseDate(str) {
    if (!str) return null;
    var m = str.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      var yr = m[3].length === 2 ? '20' + m[3] : m[3];
      return yr + '-' + pad2(m[2]) + '-' + pad2(m[1]);
    }
    var parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  // ---- Duplicate detection --------------------------------------------
  // A SHA-256 of the file's own bytes, stored alongside each upload
  // (entity_documents.file_hash) so the exact same file picked again later
  // - the same photo re-imported, the same PDF dragged in twice - can be
  // flagged rather than silently saved a second time. This only ever
  // catches a byte-for-byte match: a rescan, a re-export, or a photo taken
  // a second time of the same receipt will have a different hash and
  // won't be caught, same as any other checksum-based check.
  function hashFile(file) {
    if (!file || !window.crypto || !window.crypto.subtle) return Promise.resolve(null);
    return file.arrayBuffer().then(function (buf) {
      return window.crypto.subtle.digest('SHA-256', buf);
    }).then(function (digest) {
      var bytes = new Uint8Array(digest);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        hex += h.length < 2 ? '0' + h : h;
      }
      return hex;
    }).catch(function () { return null; });
  }

  // Looks for an existing document on this same entity with the same file
  // hash - null if there's no match, hashing failed, or the lookup itself
  // failed (never blocks an upload just because the check couldn't run).
  function findDuplicateByHash(client, entityId, hash) {
    if (!client || !hash) return Promise.resolve(null);
    return client.from('entity_documents')
      .select('id, name, created_at')
      .eq('entity_id', entityId)
      .eq('file_hash', hash)
      .limit(1)
      .then(function (result) { return (result.data && result.data[0]) || null; })
      .catch(function () { return null; });
  }

  // ---- Bulk upload: several files at once, each becoming its own document
  // Used wherever a "Choose a file" button allows multiple (see
  // captureFieldHtml's { multiple: true }) - one file at a time (parallel
  // OCR/uploads are slower and flakier, and a running "3 of 12" count is
  // easier to follow than several finishing out of order), each scanned,
  // checked against this entity's other documents by file hash, and
  // uploaded on its own, so nobody has to fill in and submit the same form
  // over and over for a stack of documents.
  //
  // bulkUploadFiles(files, opts) -> Promise<{ uploaded, duplicates, skipped, failed }>
  // opts:
  //   client, entityId, session, bucket (default 'owner-documents')
  //   scanFn(file, accessToken) -> Promise<fields> - which scan engine to
  //     use for each file, defaulting to the generic scanFileForFields
  //     (which ignores the second argument). receipts.js passes
  //     scanFileForReceiptFields here so a bulk batch of receipts gets the
  //     same Azure-backed scan (with the same automatic fallback) as a
  //     single receipt submission - accessToken (opts.session's own token)
  //     is what proves to the scan-receipt function that this is a real
  //     signed-in user, not just anyone holding the public anon key; every
  //     other bulk-upload point on the site (property/person/auth) leaves
  //     scanFn unset and keeps using the generic scan, unaffected.
  //   buildRow(fields, file) -> the columns this file's row should have
  //     beyond entity_id/file_path/file_hash/uploaded_by (which this
  //     function always sets itself) - return a falsy value to skip the
  //     file entirely without uploading it (e.g. the ledger skips a file
  //     with no detectable amount rather than create a blank entry).
  //   onProgress(done, total, file, outcome) - outcome is 'uploaded',
  //     'duplicate', 'skipped', or 'failed'.
  function bulkUploadFiles(files, opts) {
    opts = opts || {};
    var client = opts.client;
    var entityId = opts.entityId;
    var bucket = opts.bucket || 'owner-documents';
    var scanFn = opts.scanFn || scanFileForFields;
    var uploadedBy = (opts.session && opts.session.user) ? opts.session.user.id : null;
    var accessToken = opts.session ? opts.session.access_token : null;
    var results = { uploaded: [], duplicates: [], skipped: [], failed: [] };

    function report(outcome, entry) {
      results[outcome].push(entry);
      if (opts.onProgress) {
        var done = results.uploaded.length + results.duplicates.length + results.skipped.length + results.failed.length;
        opts.onProgress(done, files.length, entry.file, outcome);
      }
    }

    function uploadOne(file) {
      return hashFile(file).then(function (hash) {
        return findDuplicateByHash(client, entityId, hash).then(function (existing) {
          if (existing) { report('duplicates', { file: file, existing: existing }); return; }

          return scanFn(file, accessToken).then(function (fields) {
            var extra = opts.buildRow ? opts.buildRow(fields, file) : {};
            if (!extra) { report('skipped', { file: file, fields: fields }); return; }

            return window.HouseagoPdfConvert.toPdfIfImage({ blob: file, name: file.name, type: file.type }).then(function (finalUpload) {
              var safeFileName = finalUpload.name.replace(/[^a-zA-Z0-9._-]/g, '-');
              // A random suffix alongside the timestamp, since several
              // files in one bulk batch can otherwise land in the same
              // millisecond and collide on the same storage path.
              var path = entityId + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + safeFileName;

              return client.storage.from(bucket).upload(path, finalUpload.blob, { contentType: finalUpload.type || undefined }).then(function (uploadResult) {
                if (uploadResult.error) { report('failed', { file: file }); return; }

                var row = {};
                for (var k in extra) row[k] = extra[k];
                row.entity_id = entityId;
                row.file_path = path;
                row.file_hash = hash;
                row.uploaded_by = uploadedBy;

                return client.from('entity_documents').insert(row).then(function (insertResult) {
                  if (insertResult.error) { report('failed', { file: file }); return; }
                  report('uploaded', { file: file, fields: fields });
                });
              });
            });
          });
        });
      }).catch(function () { report('failed', { file: file }); });
    }

    var chain = Promise.resolve();
    files.forEach(function (file) { chain = chain.then(function () { return uploadOne(file); }); });
    return chain.then(function () { return results; });
  }

  // One-line summary of a bulkUploadFiles() result, for the status line
  // under a form after a batch finishes - e.g. "4 uploaded, 1 already
  // uploaded before (skipped), 2 skipped (nothing usable found)."
  function summarizeBulkResults(results) {
    var bits = [];
    if (results.uploaded.length) bits.push(results.uploaded.length + ' uploaded');
    if (results.duplicates.length) bits.push(results.duplicates.length + ' already uploaded before (skipped)');
    if (results.skipped.length) bits.push(results.skipped.length + ' skipped (nothing usable found)');
    if (results.failed.length) bits.push(results.failed.length + ' failed');
    return bits.length ? bits.join(', ') + '.' : 'Nothing to upload.';
  }

  // ---- Reusable "Take a photo / Choose a file" capture widget -----------
  // Drops into any upload form in place of a plain <input type="file">.
  // Once a file's picked, it's scanned in the background and - only for
  // whichever fields the caller actually points at, and only if they're
  // still empty - the date and/or amount found are filled in for the
  // person to check, never overwriting something they've already typed.
  //
  // Pass { multiple: true } to also let "Choose a file" pick several files
  // at once (a camera photo is always one file at a time, so that button
  // is unaffected) - see wireCaptureField's onMultipleFiles for what
  // happens when more than one file actually gets picked.
  function captureFieldHtml(opts) {
    opts = opts || {};
    var label = opts.label || 'Document';
    var accept = opts.accept || 'image/*,application/pdf';
    var chooseLabel = opts.multiple ? 'Choose file(s)' : 'Choose a file';
    var statusText = opts.multiple ? 'No file chosen yet. You can select more than one at once.' : 'No file chosen yet.';
    return (
      '<div>' +
        '<label>' + label + '</label>' +
        '<div class="capture-row">' +
          '<button type="button" class="btn btn-outline" data-scan-capture-btn>Take a photo</button>' +
          '<button type="button" class="btn btn-outline" data-scan-choose-btn>' + chooseLabel + '</button>' +
          '<button type="button" class="btn-text" data-scan-clear-btn hidden>Clear</button>' +
        '</div>' +
        '<input type="file" data-scan-camera accept="image/*" capture="environment" hidden>' +
        '<input type="file" data-scan-picker accept="' + accept + '"' + (opts.multiple ? ' multiple' : '') + ' hidden>' +
        '<p class="form-status" role="status" data-scan-status>' + statusText + '</p>' +
      '</div>'
    );
  }

  // Finds the option on a year <select> matching a plain "YYYY" guess -
  // either exactly, or as the start of a tax-year label like "2025/26".
  function findYearOption(selectEl, year) {
    if (!selectEl || !year) return null;
    var opts = selectEl.options, i;
    for (i = 0; i < opts.length; i++) if (opts[i].value === String(year)) return opts[i].value;
    for (i = 0; i < opts.length; i++) if (opts[i].value.indexOf(String(year)) === 0) return opts[i].value;
    return null;
  }

  function selectHasOption(selectEl, value) {
    if (!selectEl || value == null) return false;
    for (var i = 0; i < selectEl.options.length; i++) if (selectEl.options[i].value === String(value)) return true;
    return false;
  }

  // wireCaptureField(form, { dateInput, amountInput, nameInput, categorySelect, yearSelect, entryTypeSelect, entryTypeOverridable, onMultipleFiles })
  // -> { getFile, reset }
  //
  // Every field named here is filled in automatically from whatever the
  // scan finds - but only while it's still empty, so nothing a person has
  // already typed is ever overwritten. A "Clear" button appears once a
  // file's picked, for the case where it turns out to be the wrong
  // document: it drops the file and undoes exactly the fields this scan
  // filled in, as long as they haven't since been changed by hand.
  //
  // entryTypeSelect is the one exception to "only while empty": the
  // document itself is a better source for Income-vs-Outgoing than a
  // live-typed guess from the description alone, so the caller can pass
  // entryTypeOverridable (a function returning true/false) to let a scan
  // result overwrite that earlier guess - auto-guessed from the document
  // takes priority over auto-guessed from typing, but neither one is ever
  // allowed to overwrite something the person actually chose by hand.
  //
  // onMultipleFiles(files) is how a caller opts into bulk uploads: when
  // "Choose a file" was rendered with { multiple: true } (see
  // captureFieldHtml) and more than one file actually gets picked, this
  // widget doesn't try to scan-and-prefill the single set of form fields
  // (which wouldn't make sense for several different documents at once) -
  // it just hands the whole file list to onMultipleFiles and leaves
  // scanning and uploading each one to the caller, since only the caller
  // knows how to save a document (property.js/person.js/auth.js each do
  // this the same way - see their wireUploadForm's uploadFilesInBulk).
  // Picking exactly one file, even with multiple allowed, still goes
  // through the normal single-file flow below.
  function wireCaptureField(form, opts) {
    opts = opts || {};
    var cameraInput = form.querySelector('[data-scan-camera]');
    var pickerInput = form.querySelector('[data-scan-picker]');
    var captureBtn = form.querySelector('[data-scan-capture-btn]');
    var chooseBtn = form.querySelector('[data-scan-choose-btn]');
    var clearBtn = form.querySelector('[data-scan-clear-btn]');
    var status = form.querySelector('[data-scan-status]');
    var currentFile = null;
    var autofilled = [];
    // Bumped every time a file is picked or cleared, so a slow scan for a
    // file that's since been replaced (or cleared) never lands its result
    // into fields that now belong to a different file - see the fuller
    // explanation in receipts.js's captureGen, which has the same guard for
    // its own separate capture/crop/scan flow.
    var gen = 0;

    if (captureBtn && cameraInput) captureBtn.addEventListener('click', function () { cameraInput.click(); });
    if (chooseBtn && pickerInput) chooseBtn.addEventListener('click', function () { pickerInput.click(); });

    function tryFill(el, value, message, bits, overridable) {
      if (!el || value == null || value === '') return;
      if (el.value && !(overridable && overridable())) return;
      el.value = value;
      autofilled.push({ el: el, value: String(value) });
      bits.push(message);
    }

    function handle(file) {
      if (!file) return;
      currentFile = file;
      autofilled = [];
      gen++;
      var myGen = gen;
      if (status) status.textContent = file.name + ' - reading…';
      if (clearBtn) clearBtn.hidden = false;
      scanFileForFields(file).then(function (fields) {
        if (myGen !== gen) return; // a different file has been picked (or Clear was pressed) since this scan started
        var bits = [file.name];
        tryFill(opts.dateInput, fields.date, 'date auto-filled, check it’s right', bits);
        tryFill(opts.amountInput, fields.amount, 'amount auto-filled, check it’s right', bits);
        tryFill(opts.nameInput, fields.title, 'title guessed, check it’s right', bits);
        if (opts.categorySelect && fields.category && selectHasOption(opts.categorySelect, fields.category)) {
          tryFill(opts.categorySelect, fields.category, 'category guessed, check it’s right', bits);
        }
        if (opts.entryTypeSelect && fields.entryType && selectHasOption(opts.entryTypeSelect, fields.entryType)) {
          // The document itself is a better source than a live-typed
          // guess from the description alone, so it's allowed to
          // override that guess - but never something the person
          // actually chose by hand (see entryTypeOverridable, set by
          // the caller in property.js/person.js).
          tryFill(opts.entryTypeSelect, fields.entryType, 'income/outgoing guessed, check it’s right', bits, opts.entryTypeOverridable);
        }
        if (opts.yearSelect) {
          var yearVal = findYearOption(opts.yearSelect, fields.year);
          if (yearVal) tryFill(opts.yearSelect, yearVal, 'year auto-filled, check it’s right', bits);
        }
        if (status) status.textContent = bits.join(' - ');
        // For a caller that needs to react to a field this scan just set -
        // property.js/person.js use this to re-run their Income/Outgoing ->
        // expense-category visibility toggle, since a plain .value = ...
        // assignment above never fires a 'change' event on its own.
        if (opts.onScanned) opts.onScanned(fields);
      }).catch(function () {
        if (myGen !== gen) return;
        if (status) status.textContent = file.name + ' - could not read it automatically, fill in the fields by hand.';
      });
    }

    if (cameraInput) cameraInput.addEventListener('change', function () { handle(cameraInput.files[0]); });
    if (pickerInput) {
      pickerInput.addEventListener('change', function () {
        var files = pickerInput.files;
        if (files.length > 1 && opts.onMultipleFiles) {
          opts.onMultipleFiles(Array.prototype.slice.call(files));
          pickerInput.value = '';
          return;
        }
        handle(files[0]);
      });
    }

    function doReset() {
      currentFile = null;
      gen++;
      if (cameraInput) cameraInput.value = '';
      if (pickerInput) pickerInput.value = '';
      if (status) status.textContent = 'No file chosen yet.';
      if (clearBtn) clearBtn.hidden = true;
      autofilled.forEach(function (a) { if (String(a.el.value) === a.value) a.el.value = ''; });
      autofilled = [];
    }

    if (clearBtn) clearBtn.addEventListener('click', doReset);

    return {
      getFile: function () { return currentFile; },
      reset: doReset
    };
  }

  window.HouseagoDocScan = {
    scanFileForFields: scanFileForFields,
    scanFileForReceiptFields: scanFileForReceiptFields,
    extractTextFromFile: extractTextFromFile,
    extractLikelyIncomeLines: extractLikelyIncomeLines,
    parseLooseDate: parseLooseDate,
    captureFieldHtml: captureFieldHtml,
    wireCaptureField: wireCaptureField,
    EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    categoryFieldHtml: categoryFieldHtml,
    populateCategorySelect: populateCategorySelect,
    guessDocType: guessDocType,
    guessEntryType: guessEntryType,
    hashFile: hashFile,
    findDuplicateByHash: findDuplicateByHash,
    bulkUploadFiles: bulkUploadFiles,
    summarizeBulkResults: summarizeBulkResults
  };
})();
