// Every upload in this portal - whether it's a photographed receipt, a
// file picked from the device, or a document added on the dashboard - ends
// up stored as a PDF, so the document store stays consistent regardless of
// what was originally supplied. A file that's already a PDF is left
// untouched; an image gets wrapped into a single-page PDF sized to match
// it. Other file types (e.g. a bank's own .docx or .xlsx statement) can't
// be converted client-side without a dedicated library for each format, so
// those are left as-is rather than blocking the upload.
window.HouseagoPdfConvert = (function () {
  function imageBlobToPdf(blob) {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) return Promise.resolve(null);

    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) { resolve(null); return; }
        try {
          // 150 "pixels per inch" keeps the PDF page a normal physical
          // size (a phone photo doesn't become a 10-foot-wide PDF page).
          var ptW = (w / 150) * 72;
          var ptH = (h / 150) * 72;

          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.92);

          var doc = new window.jspdf.jsPDF({
            orientation: ptW >= ptH ? 'landscape' : 'portrait',
            unit: 'pt',
            format: [ptW, ptH]
          });
          doc.addImage(dataUrl, 'JPEG', 0, 0, ptW, ptH);
          resolve(doc.output('blob'));
        } catch (e) {
          resolve(null);
        }
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
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

  return { toPdfIfImage: toPdfIfImage };
})();
