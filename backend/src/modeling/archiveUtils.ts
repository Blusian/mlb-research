import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const resolveDirectory = (directory: string): string => path.resolve(directory);

export const ensureDirectory = (directory: string): string => {
  const resolved = resolveDirectory(directory);

  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }

  return resolved;
};

const dateFilePath = (directory: string, analysisDate: string): string =>
  path.join(ensureDirectory(directory), `${analysisDate}.json`);

export const readDatedRecord = <T>(
  directory: string,
  analysisDate: string,
): T | null => {
  const filePath = dateFilePath(directory, analysisDate);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
};

export const writeDatedRecord = <T>(
  directory: string,
  analysisDate: string,
  record: T,
): string => {
  const filePath = dateFilePath(directory, analysisDate);
  writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf8');
  return filePath;
};

export const listDatedRecords = <T>(directory: string): T[] => {
  const resolvedDirectory = resolveDirectory(directory);

  if (!existsSync(resolvedDirectory)) {
    return [];
  }

  return readdirSync(resolvedDirectory)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort()
    .flatMap((fileName) => {
      try {
        const filePath = path.join(resolvedDirectory, fileName);
        return [JSON.parse(readFileSync(filePath, 'utf8')) as T];
      } catch {
        return [];
      }
    });
};
