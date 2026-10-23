/**
 * GCS Certificate Portal - Complex Table & Schedule Data Engine
 * Handles Option B delimited text format <-> Multiline Tables <-> Formatted Schedule Blocks <-> JSON <-> HTML rendering
 */

export const tableEngine = {
  /**
   * Parse input text into a structured table or schedule block object
   */
  parseDelimited(rawText) {
    if (!rawText || typeof rawText !== 'string') return null;
    const clean = rawText.trim();
    if (!clean) return null;

    // 1. If it's already a JSON string
    if (clean.startsWith('{') && clean.endsWith('}')) {
      try {
        const obj = JSON.parse(clean);
        if (obj.textBlock) return obj;
        if (Array.isArray(obj.columns)) {
          // If columns exist but rows is empty, treat as formatted schedule block
          if (!Array.isArray(obj.rows) || obj.rows.length === 0) {
            return { textBlock: obj.columns.join(' ') };
          }
          return obj;
        }
      } catch (e) {
        // Fallback to text parsing
      }
    }

    // 2. Check for multiline table (newline delimited with | or tabs)
    let segments = [];
    if (clean.includes('\n')) {
      segments = clean.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } else if (clean.includes(';')) {
      segments = clean.split(';').map(s => s.trim()).filter(Boolean);
    } else {
      segments = [clean];
    }

    if (segments.length === 0) return null;

    // Check if the lines look like a structured table (contains | or \t)
    const hasPipesOrTabs = segments.some(s => s.includes('|') || s.includes('\t'));

    if (!hasPipesOrTabs) {
      // It's a freeform text schedule / posting block (e.g. Experience Certificate paragraph)
      return { textBlock: clean };
    }

    // Parse as table
    const splitRow = line => {
      if (line.includes('|')) return line.split('|').map(c => c.trim());
      if (line.includes('\t')) return line.split('\t').map(c => c.trim());
      return [line.trim()];
    };

    const columns = splitRow(segments[0]).filter(Boolean);
    if (columns.length === 0) return { textBlock: clean };

    const rows = [];
    for (let i = 1; i < segments.length; i++) {
      const rowItems = splitRow(segments[i]);
      while (rowItems.length < columns.length) {
        rowItems.push('');
      }
      rows.push(rowItems.slice(0, columns.length));
    }

    if (rows.length === 0) {
      // Single line entered without row separator
      return { textBlock: segments[0] };
    }

    return { columns, rows };
  },

  /**
   * Convert JSON object back to editable string for textarea
   */
  toDelimited(tableObj) {
    if (!tableObj) return '';
    if (typeof tableObj === 'string') return tableObj;
    if (tableObj.textBlock) return tableObj.textBlock;
    if (Array.isArray(tableObj.columns) && (!Array.isArray(tableObj.rows) || tableObj.rows.length === 0)) {
      return tableObj.columns.join(' | ');
    }
    if (Array.isArray(tableObj.columns) && Array.isArray(tableObj.rows)) {
      const headerStr = tableObj.columns.join(' | ');
      const rowStrs = tableObj.rows.map(r => r.join(' | '));
      return [headerStr, ...rowStrs].join(' ;\n');
    }
    return '';
  },

  /**
   * Safely stringify table object for D1 and Google Sheets storage
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
   * Render HTML for Public Verification Page or Preview
   */
  renderHtml(tableData) {
    if (!tableData) return '';
    let parsed = null;

    if (typeof tableData === 'object') {
      parsed = tableData;
    } else if (typeof tableData === 'string') {
      parsed = this.parseDelimited(tableData);
    }

    if (!parsed) return '';

    const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

    // Format A: Structured Multi-column Table
    if (Array.isArray(parsed.columns) && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
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

    // Format B: Text Schedule / Posting Details Block
    const textContent = parsed.textBlock ||
      (Array.isArray(parsed.columns) ? parsed.columns.join(' ') : '') ||
      (typeof tableData === 'string' && !tableData.startsWith('{') ? tableData : '');

    if (textContent && textContent.trim()) {
      return `
        <div class="verify-field" style="border-bottom: none; margin-top: 14px;">
          <div class="verify-label">Schedule &amp; Posting Details</div>
          <div class="neu-panel" style="margin-top: 8px; padding: 14px 16px; font-size: 13.5px; line-height: 1.6; color: var(--ink); white-space: pre-wrap; background: rgba(0, 102, 153, 0.03); border-left: 3px solid var(--brand); border-radius: 6px;">
            ${esc(textContent.trim())}
          </div>
        </div>
      `;
    }

    return '';
  }
};
