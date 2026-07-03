/**
 * BOM-tolerant JSON read. PowerShell's Out-File/Set-Content write UTF-8 with a
 * BOM, which naive JSON.parse rejects — every JSON file in this project must be
 * read through here.
 */
export declare function readJsonFile<T = unknown>(path: string): T;
//# sourceMappingURL=json.d.ts.map