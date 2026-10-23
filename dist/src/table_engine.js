/**
 * GCS Certificate Portal - Complex Table Data Engine
 * Handles Option B delimited text format <-> JSON <-> HTML rendering
 */

export const tableEngine = {
  /**
   * Parse Option B delimited text into JSON object
   * Format: "Col1 | Col2 | Col3 ; R1C1 | R1C2 | R1C3 ; R2C1 | R2C2 | R2C3"
   */
  parseDelimited(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const clean = rawText.trim();
    if (!clean) return null;

    // If it's already a JSON string, try parsing it directly
    if (clean.startsWith('{') && clean.endsWith('}')) {
      try {
        const obj = JSON.parse(clean);
        if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) return obj;
      } catch (e) {
        // Fallback to delimited parsing
      }
    }

    const segments = clean.split(';').map(s => s.trim()).filter(Boolean);
    if (segments.length === 0) return null;

    // First segment is column headers
    const columns = segments[0].split('|').map(c => c.trim()).filter(Boolean);
    if (columns.length === 0) return null;

    // Remaining segments are row items
    const rows = [];
    for (let i = 1; i < segments.length; i++) {
      const rowItems = segments[i].split('|').map(item => item.trim());
      // Ensure row has same column count (pad with empty string if short)
      while (rowItems.length < columns.length) {
        rowItems.push('');
      }
      rows.push(rowItems.slice(0, columns.length));
    }

    return {
      columns,
      rows
    };
  },

  /**
   * Convert JSON object to Option B delimited string
   */
  toDelimited(tableObj) {
    if (!tableObj || !Array.isArray(tableObj.columns) || !Array.isArray(tableObj.rows)) return '';
    const headerStr = tableObj.columns.join(' | ');
    const rowStrs = tableObj.rows.map(r => r.join(' | '));
    return [headerStr, ...rowStrs].join(' ; ');
  },

  /**
   * Safely stringify table object for Google Sheet single-cell storage
   */
  stringifyForStorage(tableInput) {
    if (!tableInput) return '';
    if (typeof tableInput === 'string') {
      const parsed = this.parseDelimited(tableInput);
      return parsed ? JSON.stringify(parsed) : '';
    }
    return JSON.stringify(tableInput);
  },

  /**
   * Render HTML Neumorphic Table for Public Verification or Preview
   */
  renderHtml(tableData) {
    if (!tableData) return '';
    let parsed = null;

    if (typeof tableData === 'object' && Array.isArray(tableData.columns)) {
      parsed = tableData;
    } else if (typeof tableData === 'string') {
      parsed = this.parseDelimited(tableData);
    }

    if (!parsed || !parsed.columns || parsed.columns.length === 0 || !parsed.rows || parsed.rows.length === 0) {
      return '';
    }

    const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

    const headerHtml = parsed.columns.map(c => `<th>${esc(c)}</th>`).join('');
    const rowsHtml = parsed.rows.map(row => {
      const cells = row.map(cell => `<td>${esc(cell)}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `
      <div class="verify-field" style="border-bottom: none; margin-top: 14px;">
        <div class="verify-label">Schedule &amp; Departmental Posting Records</div>
        <div class="neu-table-wrap" style="margin-top: 8px;">
          <table class="neu-table">
            <thead>
              <tr>${headerHtml}</tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
};
