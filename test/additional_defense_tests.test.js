import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path from 'path';
import os from 'os';

describe('Additional Defense Unit Tests', () => {
    let tempDir;
    let serverDir;
    let backupDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'defense-test-'));
        serverDir = path.join(tempDir, 'server');
        backupDir = path.join(tempDir, 'backup');
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(tempDir, 'temp'),
            backupDirectory: backupDir,
            logLevel: 'ERROR'
        });
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('isValidBackupName helper', () => {
        test('validates safe backup names', () => {
            expect(backend.isValidBackupName('backup_2026-10-19')).toBe(true);
            expect(backend.isValidBackupName('world_default_12345')).toBe(true);
            expect(backend.isValidBackupName('test-backup-name')).toBe(true);
        });

        test('rejects unsafe backup names', () => {
            expect(backend.isValidBackupName(null)).toBe(false);
            expect(backend.isValidBackupName('')).toBe(false);
            expect(backend.isValidBackupName(12345)).toBe(false);
            expect(backend.isValidBackupName('../traversal')).toBe(false);
            expect(backend.isValidBackupName('folder/file')).toBe(false);
            expect(backend.isValidBackupName('folder\\file')).toBe(false);
            expect(backend.isValidBackupName('backup\0null')).toBe(false);
            expect(backend.isValidBackupName('backup\nnewline')).toBe(false);
            expect(backend.isValidBackupName('backup;rm')).toBe(false);
        });
    });

    describe('writeServerProperties validation', () => {
        test('throws error on invalid properties object', async () => {
            await expect(backend.writeServerProperties(null)).rejects.toThrow('Invalid server properties data provided.');
            await expect(backend.writeServerProperties('not an object')).rejects.toThrow('Invalid server properties data provided.');
            await expect(backend.writeServerProperties(['array'])).rejects.toThrow('Invalid server properties data provided.');
        });
    });

    describe('deleteBackup, exportBackup, and restoreBackup with invalid backup names', () => {
        test('deleteBackup rejects invalid backup name', async () => {
            const res = await backend.deleteBackup('../invalid');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });

        test('exportBackup rejects invalid backup name', async () => {
            const res = await backend.exportBackup('../invalid');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });

        test('restoreBackup rejects invalid backup name', async () => {
            const res = await backend.restoreBackup('../invalid');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });
    });

    describe('getDiskUsage resilience', () => {
        test('handles undefined/null dirPath gracefully', async () => {
            const res1 = await backend.getDiskUsage(null);
            expect(res1).toEqual({ total: 0, available: 0 });

            const res2 = await backend.getDiskUsage(undefined);
            expect(res2).toEqual({ total: 0, available: 0 });
        });

        test('handles non-existent dirPath gracefully', async () => {
            const res = await backend.getDiskUsage(path.join(tempDir, 'does-not-exist'));
            expect(res).toEqual({ total: 0, available: 0 });
        });
    });

    describe('deletePack validation', () => {
        test('rejects invalid packId', async () => {
            const resNull = await backend.deletePack('world_test', 'behavior', null);
            expect(resNull.success).toBe(false);
            expect(resNull.message).toBe('Invalid pack ID.');

            const resSlash = await backend.deletePack('world_test', 'behavior', '../packId');
            expect(resSlash.success).toBe(false);
            expect(resSlash.message).toBe('Invalid pack ID.');

            const resControl = await backend.deletePack('world_test', 'behavior', 'pack\nId');
            expect(resControl.success).toBe(false);
            expect(resControl.message).toBe('Invalid pack ID.');
        });
    });

    describe('sendServerCommand validation', () => {
        test('rejects non-string or newline-containing commands', async () => {
            const resNull = await backend.sendServerCommand(null);
            expect(resNull.success).toBe(false);
            expect(resNull.message).toBe('Invalid command.');

            const resNewline = await backend.sendServerCommand('list\nstop');
            expect(resNewline.success).toBe(false);
            expect(resNewline.message).toBe('Invalid command.');
        });
    });
});
