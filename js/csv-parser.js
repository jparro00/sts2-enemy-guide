// ══════════════════════════════════════════
// CSV PARSER
// ══════════════════════════════════════════

function parseCSV(text) {
  // Split into logical lines, respecting quoted fields that span multiple lines
  function splitLogicalLines(text) {
    const lines = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        current += ch;
        if (ch === '"' && text[i + 1] === '"') {
          current += text[i + 1];
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          current += ch;
        } else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          if (current.trim()) lines.push(current);
          current = '';
          continue;
        } else {
          current += ch;
        }
      }
    }
    if (current.trim()) lines.push(current);
    return lines;
  }

  function parseLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          fields.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
    }
    fields.push(current.trim());
    return fields;
  }

  const lines = splitLogicalLines(text);
  if (lines.length === 0) return [];

  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}
