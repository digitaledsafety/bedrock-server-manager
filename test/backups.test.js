import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = path.dirname(__filenameESM);

describe('Backup Management', () => {
    let testDir;
    let backupDir;
    let serverDir;

    beforeEach(() => {
        testDir = path.join(os.tmpdir(), 'backup-test-' + Math.random().toString(36).substring(7));
        backupDir = path.join(testDir, 'backups');
        serverDir = path.join(testDir, 'server');
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(serverDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            tempDirectory: path.join(testDir, 'temp'),
            logLevel: 'ERROR'
        });
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('listBackups should return sorted list of backups', async () => {
        const backup1 = path.join(backupDir, 'backup1');
        const backup2 = path.join(backupDir, 'backup2');
        fs.mkdirSync(backup1);
        fs.mkdirSync(backup2);

        // Adjust mtime to ensure order
        const now = new Date();
        const older = new Date(now.getTime() - 10000);
        fs.utimesSync(backup1, older, older);
        fs.utimesSync(backup2, now, now);

        const backups = await backend.listBackups();
        expect(backups.length).toBe(2);
        expect(backups[0].name).toBe('backup2');
        expect(backups[1].name).toBe('backup1');
    });

    test('deleteBackup should delete a backup folder', async () => {
        const backupName = 'test-backup';
        const backupPath = path.join(backupDir, backupName);
        fs.mkdirSync(backupPath);
        expect(fs.existsSync(backupPath)).toBe(true);

        const result = await backend.deleteBackup(backupName);
        expect(result.success).toBe(true);
        expect(fs.existsSync(backupPath)).toBe(false);
    });

    test('deleteBackup should prevent path traversal', async () => {
        const result = await backend.deleteBackup('../something');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid backup folder name.');
    });
});
