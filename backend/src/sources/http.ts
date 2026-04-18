export const fetchJson = async <T>(url: string, timeoutMs: number): Promise<T> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.json() as Promise<T>;
};

export const fetchText = async (url: string, timeoutMs: number): Promise<string> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Request failed for ${url} with status ${response.status}`);
  }

  return response.text();
};

const parseCsvRecord = (record: string): string[] => {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    const nextCharacter = record[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  values.push(current);
  return values;
};

export const parseCsvRows = (input: string): string[][] => {
  const text = input.replace(/^\uFEFF/, '').trim();

  if (!text) {
    return [];
  }

  const rows: string[][] = [];
  let currentRecord = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentRecord += '""';
        index += 1;
      } else {
        inQuotes = !inQuotes;
        currentRecord += character;
      }

      continue;
    }

    if ((character === '\n' || character === '\r') && !inQuotes) {
      if (currentRecord.trim().length > 0) {
        rows.push(parseCsvRecord(currentRecord.replace(/\r$/, '')));
      }

      currentRecord = '';

      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }

      continue;
    }

    currentRecord += character;
  }

  if (currentRecord.trim().length > 0) {
    rows.push(parseCsvRecord(currentRecord));
  }

  return rows;
};
