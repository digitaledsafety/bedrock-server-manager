import { jest } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

describe('Additional Defense and Edge Cases Unit Tests', () => {
    const testTmpDir = path.join(__dirnameESM, 'fixtures', 'additional_defense_tmp');

    beforeAll(() => {
        if (!fs.existsSync(testTmpDir)) {
            fs.mkdirSync(testTmpDir, { recursive: true });
        }
    });

    afterAll(() => {
        if (fs.existsSync(testTmpDir)) {
            fs.rmSync(testTmpDir, { recursive: true, force: true });
        }
    });

    describe('getDiskUsage', () => {
        test('should return zero stats for undefined path', async () => {
            const usage = await backend.getDiskUsage(undefined);
            expect(usage).toEqual({ total: 0, available: 0 });
        });

        test('should return zero stats for non-existent path', async () => {
            const usage = await backend.getDiskUsage(path.join(testTmpDir, 'non_existent_folder_xyz'));
            expect(usage).toEqual({ total: 0, available: 0 });
        });
    });

    describe('writeServerProperties', () => {
        test('should throw an error when propertiesToWrite is null', async () => {
            await expect(backend.writeServerProperties(null)).rejects.toThrow('Invalid propertiesToWrite object provided.');
        });

        test('should throw an error when propertiesToWrite is not an object', async () => {
            await expect(backend.writeServerProperties('not-an-object')).rejects.toThrow('Invalid propertiesToWrite object provided.');
        });
    });

    describe('sendServerCommand', () => {
        test('should reject non-string commands', async () => {
            const res = await backend.sendServerCommand(12345);
            expect(res).toEqual({ success: false, message: 'Invalid command.' });
        });

        test('should reject empty commands', async () => {
            const res = await backend.sendServerCommand('');
            expect(res).toEqual({ success: false, message: 'Invalid command.' });
        });

        test('should reject commands containing newline characters', async () => {
            const res = await backend.sendServerCommand('stop\nstart');
            expect(res).toEqual({ success: false, message: 'Invalid command.' });
        });

        test('should reject commands containing control characters', async () => {
            const res = await backend.sendServerCommand('say \x07hello');
            expect(res).toEqual({ success: false, message: 'Invalid command.' });
        });
    });

    describe('uploadPack malformed JSON manifest in multi-pack zip', () => {
        const mockServerDir = path.join(testTmpDir, 'server');
        const mockWorldDir = path.join(mockServerDir, 'worlds', 'test_world');
        const zipPath = path.join(testTmpDir, 'corrupted_addon.mcaddon');

        beforeEach(() => {
            if (fs.existsSync(mockServerDir)) fs.rmSync(mockServerDir, { recursive: true, force: true });
            fs.mkdirSync(mockWorldDir, { recursive: true });
            backend.init({
                serverDirectory: mockServerDir,
                tempDirectory: testTmpDir,
                backupDirectory: testTmpDir,
                logLevel: 'DEBUG'
            });

            const zip = new AdmZip();
            // Add a valid behavior pack entry
            zip.addFile('pack1/manifest.json', Buffer.from(JSON.stringify({
                header: { uuid: 'valid-uuid-1', version: [1, 0, 0], name: 'Valid Pack' },
                modules: [{ type: 'data' }]
            })));
            // Add a corrupted manifest entry
            zip.addFile('pack2/manifest.json', Buffer.from('{ malformed json }'));
            zip.writeZip(zipPath);
        });

        test('should process valid packs and skip corrupted manifests gracefully', async () => {
            const result = await backend.uploadPack(zipPath, 'corrupted_addon.mcaddon', null, 'test_world');
            expect(result.success).toBe(false); // overallSuccess is false due to 1 skipped pack, but valid pack is extracted
            expect(result.message).toContain('Multi-pack processing complete');
            expect(result.message).toContain('1 pack(s) processed');

            // Verify valid pack was written
            const worldBehaviorPacks = JSON.parse(fs.readFileSync(path.join(mockWorldDir, 'world_behavior_packs.json'), 'utf8'));
            expect(worldBehaviorPacks).toEqual([{ pack_id: 'valid-uuid-1', version: [1, 0, 0] }]);
        });
    });

    describe('validateWorldName middleware', () => {
        test('should handle non-object or null request body gracefully', async () => {
            const res = await request(app)
                .post('/api/create-world')
                .set('Content-Type', 'application/json')
                .send('null');
            expect(res.status).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toBe('World name is required.');
        });
    });
});
