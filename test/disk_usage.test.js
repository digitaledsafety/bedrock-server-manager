import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Disk Usage', () => {
    test('getDiskUsage should return total and available space', async () => {
        const usage = await backend.getDiskUsage('.');
        expect(usage).toHaveProperty('total');
        expect(usage).toHaveProperty('available');
        expect(typeof usage.total).toBe('number');
        expect(typeof usage.available).toBe('number');
        expect(usage.total).toBeGreaterThan(0);
        expect(usage.available).toBeGreaterThanOrEqual(0);
    });

    test('getDiskUsage should return 0 for non-existent path', async () => {
        const usage = await backend.getDiskUsage('./non_existent_path_12345');
        expect(usage).toEqual({ total: 0, available: 0 });
    });
});
