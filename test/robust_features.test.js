import fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

describe('Robust Features Unit Tests', () => {
    const testDir = path.join(__dirnameESM, 'tmp_robust_test');
    const serverDir = path.join(testDir, 'server');
    const backupDir = path.join(testDir, 'backup');
    const tempDir = path.join(testDir, 'temp');

    beforeEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });

        fs.mkdirSync(path.join(serverDir, 'worlds'), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=world1\n', 'utf8');

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            tempDirectory: tempDir,
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('getDiskUsage handles empty or missing dirPath safely', async () => {
        const usage1 = await backend.getDiskUsage(null);
        expect(usage1).toEqual({ total: 0, available: 0 });

        const usage2 = await backend.getDiskUsage('');
        expect(usage2).toEqual({ total: 0, available: 0 });

        const usage3 = await backend.getDiskUsage(123);
        expect(usage3).toEqual({ total: 0, available: 0 });
    });

    test('backup operations reject control characters in backup names', async () => {
        const invalidName = 'backup\n_test';

        const exportRes = await backend.exportBackup(invalidName);
        expect(exportRes.success).toBe(false);
        expect(exportRes.message).toBe('Invalid backup name.');

        const deleteRes = await backend.deleteBackup(invalidName);
        expect(deleteRes.success).toBe(false);
        expect(deleteRes.message).toBe('Invalid backup name.');

        const restoreRes = await backend.restoreBackup(invalidName);
        expect(restoreRes.success).toBe(false);
        expect(restoreRes.message).toBe('Invalid backup name.');
    });

    test('renameWorld updates server.properties for active world', async () => {
        const oldWorldDir = path.join(serverDir, 'worlds', 'world1');
        fs.mkdirSync(oldWorldDir, { recursive: true });

        const res = await backend.renameWorld('world1', 'world2');
        expect(res.success).toBe(true);

        const newWorldDir = path.join(serverDir, 'worlds', 'world2');
        expect(fs.existsSync(newWorldDir)).toBe(true);
        expect(fs.existsSync(oldWorldDir)).toBe(false);

        const properties = await backend.readServerProperties();
        expect(properties['level-name']).toBe('world2');
    });

    test('renameWorld leaves server.properties untouched when renaming inactive world', async () => {
        const inactiveWorldDir = path.join(serverDir, 'worlds', 'world_inactive');
        fs.mkdirSync(inactiveWorldDir, { recursive: true });

        const res = await backend.renameWorld('world_inactive', 'world_renamed');
        expect(res.success).toBe(true);

        const properties = await backend.readServerProperties();
        expect(properties['level-name']).toBe('world1');
    });
});
