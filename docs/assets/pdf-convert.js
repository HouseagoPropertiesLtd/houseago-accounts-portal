// Every upload in this portal - whether it's a photographed receipt, a
// file picked from the device, or a document added on the dashboard - ends
// up stored as a PDF, so the document store stays consistent regardless of
// what was originally supplied. A file that's already a PDF is left
// untouched; an image gets wrapped into a PDF sized to match it. Other file
// types (e.g. a bank's own .docx or .xlsx statement) can't be converted
// client-side without a dedicated library for each format, so those are
// left as-is rather than blocking the upload.
//
// A document can also be photographed a page at a time (the "Add another
// page" button - see captureFieldHtml in assets/doc-scan.js), in which case
// several images are combined into one multi-page PDF here, so a four-page
// gas safety certificate is stored as one document rather than four.
window.HouseagoPdfConvert = (function () {
  // A ceiling on pages, mostly to protect the phone doing the work: each
  // page is decoded and re-encoded in turn, and an accidental run of
  // photos shouldn't be able to lock the device up building a PDF nobody
  // wanted. Comfortably more than any certificate or tenancy agreement.
  var MAX_PAGES = 20;

  function loadImage(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        resolve({ img: img, revoke: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // Turns one loaded image into the numbers and JPEG data a PDF page needs.
  function pageFromImage(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;

    // 150 "pixels per inch" keeps the PDF page a normal physical size (a
    // phone photo doesn't become a 10-foot-wide PDF page).
    var ptW = (w / 150) * 72;
    var ptH = (h / 150) * 72;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0);

    return {
      ptW: ptW,
      ptH: ptH,
      orientation: ptW >= ptH ? 'landscape' : 'portrait',
      dataUrl: canvas.toDataURL('image/jpeg', 0.92)
    };
  }

  // One or more image blobs -> a single PDF blob, one page each, every page
  // sized to its own image (so a landscape page mixed in among portrait
  // ones still comes out the right shape).
  //
  // Pages are loaded and drawn strictly one at a time rather than all up
  // front: a decoded 12-megapixel photo is a large object, and holding ten
  // of them at once is how a phone browser runs out of memory mid-upload.
  // Any page that can't be read abandons the whole document and resolves
  // null, so the caller falls back to uploading what it already had rather
  // than storing a half-built PDF.
  function imagesToPdf(blobs) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) return Promise.resolve(null);
    if (!blobs || !blobs.length) return Promise.resolve(null);

    var pages = blobs.slice(0, MAX_PAGES);
    var doc = null;

    var chain = Promise.resolve();
    pages.forEach(function (blob, index) {
      chain = chain.then(function () {
        return loadImage(blob).then(function (loaded) {
          if (!loaded) throw new Error('page ' + (index + 1) + ' could not be read');
          try {
            var page = pageFromImage(loaded.img);
            if (!page) throw new Error('page ' + (index + 1) + ' had no dimensions');
            if (index === 0) {
              doc = new window.jspdf.jsPDF({
                orientation: page.orientation,
                unit: 'pt',
                format: [page.ptW, page.ptH]
              });
            } else {
              doc.addPage([page.ptW, page.ptH], page.orientation);
            }
            doc.addImage(page.dataUrl, 'JPEG', 0, 0, page.ptW, page.ptH);
          } finally {
            loaded.revoke();
          }
        });
      });
    });

    return chain.then(function () {
      return doc ? doc.output('blob') : null;
    }).catch(function () {
      return null;
    });
  }

  function imageBlobToPdf(blob) {
    return imagesToPdf([blob]);
  }

  // Given { blob, name, type }, returns a Promise of { blob, name, type }:
  // a PDF version if the input was an image and conversion worked,
  // otherwise the original, untouched - so a missing library, an odd file,
  // or a non-image document never blocks an upload.
  function toPdfIfImage(uploadFile) {
    if (!uploadFile || !/^image\//.test(uploadFile.type || '')) return Promise.resolve(uploadFile);
    return imageBlobToPdf(uploadFile.blob).then(function (pdfBlob) {
      if (!pdfBlob) return uploadFile;
      var base = (uploadFile.name || 'document').replace(/\.[^.]+$/, '');
      return { blob: pdfBlob, name: base + '.pdf', type: 'application/pdf' };
    });
  }

  // The multi-page equivalent: an array of { blob, name, type } pages ->
  // one { blob, name, type }. One page behaves exactly like toPdfIfImage
  // above (including leaving a PDF or an unconvertible file alone), so
  // callers can use this everywhere without special-casing.
  //
  // If several pages are given but any of them isn't an image, the extra
  // pages are dropped and only the first is uploaded - the capture widget
  // doesn't allow that combination in the first place (see doc-scan.js),
  // so this is a backstop rather than a path anyone should reach.
  function toPdfFromPages(uploadFiles) {
    var pages = (uploadFiles || []).filter(Boolean);
    if (!pages.length) return Promise.resolve(null);
    if (pages.length === 1) return toPdfIfImage(pages[0]);

    var allImages = pages.every(function (p) { return /^image\//.test(p.type || ''); });
    if (!allImages) return toPdfIfImage(pages[0]);

    return imagesToPdf(pages.map(function (p) { return p.blob; })).then(function (pdfBlob) {
      if (!pdfBlob) return toPdfIfImage(pages[0]); // fall back to page one rather than failing the upload
      var base = (pages[0].name || 'document').replace(/\.[^.]+$/, '');
      return { blob: pdfBlob, name: base + '.pdf', type: 'application/pdf' };
    });
  }

  return {
    toPdfIfImage: toPdfIfImage,
    toPdfFromPages: toPdfFromPages,
    imagesToPdf: imagesToPdf,
    MAX_PAGES: MAX_PAGES
  };
})();
