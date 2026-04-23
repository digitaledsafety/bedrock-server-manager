import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

describe('Backup Listing Tests', () => {
    let testDir;
    let backupDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), 'backup-test-' + Math.random().toString(36).substring(7));
        backupDir = path.join(testDir, 'backups');
        fs.mkdirSync(backupDir, { recursive: true });

        backend.init({
            serverDirectory: path.join(testDir, 'server'),
            tempDirectory: path.join(testDir, 'temp'),
            backupDirectory: backupDir
        });
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('listBackups should return an empty array if no backups exist', async () => {
        const backups = await backend.listBackups();
        expect(backups).toEqual([]);
    });

    test('listBackups should return a list of backups when they exist', async () => {
        const backup1 = path.join(backupDir, '2023-01-01T10-00-00Z');
        const backup2 = path.join(backupDir, '2023-01-01T11-00-00Z');
        fs.mkdirSync(backup1);
        fs.mkdirSync(backup2);

        const backups = await backend.listBackups();
        expect(backups).toHaveLength(2);
        expect(backups.map(b => b.name)).toContain('2023-01-01T10-00-00Z');
        expect(backups.map(b => b.name)).toContain('2023-01-01T11-00-00Z');
    });

    test('listBackups should be sorted by date descending', async () => {
        // We need to set mtime explicitly to ensure order if they were created too fast
        const now = new Date();
        const past = new Date(now.getTime() - 10000);

        const backupRecent = path.join(backupDir, 'recent');
        const backupOld = path.join(backupDir, 'old');

        if (!fs.existsSync(backupRecent)) fs.mkdirSync(backupRecent);
        if (!fs.existsSync(backupOld)) fs.mkdirSync(backupOld);

        fs.utimesSync(backupRecent, now, now);
        fs.utimesSync(backupOld, past, past);

        const backups = await backend.listBackups();
        const recentIndex = backups.findIndex(b => b.name === 'recent');
        const oldIndex = backups.findIndex(b => b.name === 'old');

        expect(recentIndex).toBeLessThan(oldIndex);
    });
});
