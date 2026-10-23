/**
 * GCS Certificate Portal - QR Code Canvas & Packaging Engine
 * Renders QR with "Scan to Verify" label, supports 1-click clipboard copy, PNG download, and Batch ZIP packaging
 */

export const qrEngine = {
  /**
   * Generates a 14-character unique Certificate ID
   * Formula: 2-digit Year Prefix (e.g. "26") + 12 uppercase alphanumeric chars
   */
  generateId(yearPrefix) {
    const yr = String(yearPrefix || new Date().getFullYear()).slice(-2);
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = '';
    const randomVals = new Uint8Array(12);
    window.crypto.getRandomValues(randomVals);
    for (let i = 0; i < 12; i++) {
      code += chars[randomVals[i] % chars.length];
    }
    return yr + code;
  },

  /**
   * Render a high-resolution QR canvas with embedded bottom text
   * Returns a Canvas element
   */
  async renderQrCanvas(url, id, options = {}) {
    const size = options.size || 280;
    const padding = 16;
    const textGap = 12;
    const textHeight = 44; // Height for "Scan to Verify" + ID label
    const totalHeight = size + padding * 2 + textHeight;
    const totalWidth = size + padding * 2;

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth * 2; // 2x for sharp retina rendering
    canvas.height = totalHeight * 2;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);

    // Background fill
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Render QR matrix using QRCode library
    const tempDiv = document.createElement('div');
    new window.QRCode(tempDiv, {
      text: url,
      width: size,
      height: size,
      colorDark: '#000000',
      colorLight: '#FFFFFF',
      correctLevel: window.QRCode.CorrectLevel.H
    });

    // Wait for internal image/canvas to settle
    await new Promise(r => setTimeout(r, 60));
    const qrImg = tempDiv.querySelector('canvas') || tempDiv.querySelector('img');

    if (qrImg) {
      ctx.drawImage(qrImg, padding, padding, size, size);
    }

    // Institutional text: "Scan to Verify"
    ctx.fillStyle = '#1A365D';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '1px';
    ctx.fillText('Scan to Verify', totalWidth / 2, size + padding + textGap + 6);

    // Certificate ID label
    ctx.fillStyle = '#4A5568';
    ctx.font = '500 11px "JetBrains Mono", monospace';
    ctx.letterSpacing = '0.5px';
    ctx.fillText(`ID: ${id}`, totalWidth / 2, size + padding + textGap + 24);

    return canvas;
  },

  /**
   * Convert Canvas to Blob
   */
  canvasToBlob(canvas) {
    return new Promise(resolve => {
      canvas.toBlob(blob => resolve(blob), 'image/png');
    });
  },

  /**
   * 1-Click Copy QR image to Clipboard for Word document pasting
   */
  async copyToClipboard(canvas) {
    try {
      const blob = await this.canvasToBlob(canvas);
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        return { success: true, message: 'QR Code image copied to clipboard! Paste it into Word (Ctrl+V).' };
      } else {
        throw new Error('Clipboard API not supported in this browser.');
      }
    } catch (err) {
      // Fallback: trigger download
      this.downloadCanvas(canvas, 'QRCode.png');
      return { success: false, message: 'Could not write to clipboard automatically. Downloaded PNG instead.' };
    }
  },

  /**
   * Download Canvas as PNG file
   */
  downloadCanvas(canvas, filename) {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename || 'QRCode.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },

  /**
   * Batch Generate 150+ QR codes and package into ZIP with Mapped CSV
   */
  async packageBatchZip(certificates, prefixUrl, onProgress) {
    if (!window.JSZip) {
      throw new Error('JSZip library is not loaded.');
    }

    const zip = new window.JSZip();
    const qrFolder = zip.folder('QR_Codes');
    const mappedRows = [
      ['Certificate_ID', 'Recipient_Name', 'Certificate_Type', 'Date_Issued', 'QR_File_Name', 'Verification_URL']
    ];

    const total = certificates.length;

    for (let i = 0; i < total; i++) {
      const cert = certificates[i];
      const certUrl = `${prefixUrl}${encodeURIComponent(cert.id)}`;
      const canvas = await this.renderQrCanvas(certUrl, cert.id);
      const blob = await this.canvasToBlob(canvas);

      // Clean filename
      const safeName = (cert.recipientName || 'Candidate').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${cert.id}_${safeName}.png`;

      qrFolder.file(filename, blob);
      mappedRows.push([
        cert.id,
        cert.recipientName || '',
        cert.certificateType || '',
        cert.dateIssued || '',
        filename,
        certUrl
      ]);

      if (onProgress) {
        onProgress(i + 1, total);
      }

      // Small tick to prevent UI locking
      if (i % 10 === 0) {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    // Generate Mapped CSV
    const csvContent = mappedRows.map(row =>
      row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(',')
    ).join('\r\n');

    zip.file('Certificate_Mapping_Index.csv', csvContent);

    // Generate ZIP
    const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
      if (onProgress && metadata.percent) {
        // Zip compression progress
      }
    });

    // Trigger download
    const zipUrl = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = zipUrl;
    a.download = `GCS_Certificates_Batch_${new Date().getFullYear()}_(${total}_records).zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(zipUrl);

    return { success: true, count: total };
  }
};
