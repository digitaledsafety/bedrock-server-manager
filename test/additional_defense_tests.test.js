import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Additional Defense and Resilience Tests', () => {
    let testDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), `add-defense-test-${Math.random().toString(36).substring(7)}`);
        const serverDir = path.join(testDir, 'server');
        const backupDir = path.join(testDir, 'backup');
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterAll(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('isValidBackupName', () => {
        test('should return true for valid backup names', () => {
            expect(backend.isValidBackupName('backup_2026-10-26')).toBe(true);
            expect(backend.isValidBackupName('world_default_123.45')).toBe(true);
            expect(backend.isValidBackupName('backup-name-1')).toBe(true);
            expect(backend.isValidBackupName('backup:1')).toBe(true);
        });

        test('should return false for invalid or malicious backup names', () => {
            expect(backend.isValidBackupName('')).toBe(false);
            expect(backend.isValidBackupName(null)).toBe(false);
            expect(backend.isValidBackupName(123)).toBe(false);
            expect(backend.isValidBackupName('../etc/passwd')).toBe(false);
            expect(backend.isValidBackupName('..\\windows\\system32')).toBe(false);
            expect(backend.isValidBackupName('backup/file')).toBe(false);
            expect(backend.isValidBackupName('backup\\file')).toBe(false);
            expect(backend.isValidBackupName('backup\nname')).toBe(false);
            expect(backend.isValidBackupName('backup\x00null')).toBe(false);
        });
    });

    describe('getDiskUsage resilience', () => {
        test('should return zeros for undefined or non-existent paths without throwing', async () => {
            const usage1 = await backend.getDiskUsage(undefined);
            expect(usage1).toEqual({ total: 0, available: 0 });

            const usage2 = await backend.getDiskUsage('/non_existent_directory_xyz_999');
            expect(usage2).toEqual({ total: 0, available: 0 });
        });
    });

    describe('writeServerProperties validation', () => {
        test('should throw an error if propertiesToWrite is not a non-null object', async () => {
            await expect(backend.writeServerProperties(null)).rejects.toThrow('Properties to write must be a non-null object.');
            await expect(backend.writeServerProperties('string')).rejects.toThrow('Properties to write must be a non-null object.');
            await expect(backend.writeServerProperties(123)).rejects.toThrow('Properties to write must be a non-null object.');
        });
    });

    describe('sendServerCommand payload validation', () => {
        test('should reject command payloads containing control characters or non-string inputs', async () => {
            const res1 = await backend.sendServerCommand('');
            expect(res1).toEqual({ success: false, message: 'Invalid command payload.' });

            const res2 = await backend.sendServerCommand(null);
            expect(res2).toEqual({ success: false, message: 'Invalid command payload.' });

            const res3 = await backend.sendServerCommand('say Hello\nstop');
            expect(res3).toEqual({ success: false, message: 'Invalid command payload.' });

            const res4 = await backend.sendServerCommand('say Hello\r');
            expect(res4).toEqual({ success: false, message: 'Invalid command payload.' });

            const res5 = await backend.sendServerCommand('say \x00test');
            expect(res5).toEqual({ success: false, message: 'Invalid command payload.' });
        });
    });

    describe('deletePack validation', () => {
        test('should return error when packId contains control characters or is empty', async () => {
            const res1 = await backend.deletePack('world1', 'behavior', '');
            expect(res1).toEqual({ success: false, message: 'Invalid pack ID.' });

            const res2 = await backend.deletePack('world1', 'behavior', 'packId\n');
            expect(res2).toEqual({ success: false, message: 'Invalid pack ID.' });
        });
    });

    describe('backup operation validation (export, delete, restore)', () => {
        test('should reject invalid backup names in exportBackup', async () => {
            const res = await backend.exportBackup('../malicious');
            expect(res).toEqual({ success: false, message: 'Invalid backup name.' });
        });

        test('should reject invalid backup names in deleteBackup', async () => {
            const res = await backend.deleteBackup('../malicious');
            expect(res).toEqual({ success: false, message: 'Invalid backup name.' });
        });

        test('should reject invalid backup names in restoreBackup', async () => {
            const res = await backend.restoreBackup('../malicious');
            expect(res).toEqual({ success: false, message: 'Invalid backup name.' });
        });
    });
});
