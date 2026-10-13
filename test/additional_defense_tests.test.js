import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Additional Defense Tests', () => {
    let testDir;
    let serverDir;
    let backupDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), `defense-test-${Math.random().toString(36).substring(7)}`);
        serverDir = path.join(testDir, 'server');
        backupDir = path.join(testDir, 'backup');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterAll(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe('isValidBackupName', () => {
        test('should return true for valid backup names', () => {
            expect(backend.isValidBackupName('2026-10-13T00-24-07_699Z')).toBe(true);
            expect(backend.isValidBackupName('world_test_world_2026-10-13')).toBe(true);
            expect(backend.isValidBackupName('backup-1.0_final')).toBe(true);
        });

        test('should return false for path traversal attempts', () => {
            expect(backend.isValidBackupName('../backup')).toBe(false);
            expect(backend.isValidBackupName('..\\backup')).toBe(false);
            expect(backend.isValidBackupName('backup/subdir')).toBe(false);
        });

        test('should return false for control characters and newlines', () => {
            expect(backend.isValidBackupName('backup\nname')).toBe(false);
            expect(backend.isValidBackupName('backup\rname')).toBe(false);
            expect(backend.isValidBackupName('backup\x00name')).toBe(false);
        });

        test('should return false for invalid types, null, or empty string', () => {
            expect(backend.isValidBackupName('')).toBe(false);
            expect(backend.isValidBackupName(null)).toBe(false);
            expect(backend.isValidBackupName(undefined)).toBe(false);
            expect(backend.isValidBackupName(12345)).toBe(false);
        });
    });

    describe('writeServerProperties validation', () => {
        test('should throw an explicit error when propertiesToWrite is null or non-object', async () => {
            await expect(backend.writeServerProperties(null)).rejects.toThrow('Invalid propertiesToWrite format.');
            await expect(backend.writeServerProperties(undefined)).rejects.toThrow('Invalid propertiesToWrite format.');
            await expect(backend.writeServerProperties('not an object')).rejects.toThrow('Invalid propertiesToWrite format.');
        });
    });

    describe('Backup functions with invalid backup names', () => {
        test('deleteBackup should reject invalid backup names', async () => {
            const result = await backend.deleteBackup('../malicious');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });

        test('exportBackup should reject invalid backup names', async () => {
            const result = await backend.exportBackup('invalid/name\nwithnewline');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });

        test('restoreBackup should reject invalid backup names', async () => {
            const result = await backend.restoreBackup('..\\malicious');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });
    });

    describe('deletePack validation', () => {
        test('should reject invalid packType', async () => {
            const result = await backend.deletePack('test_world', 'invalid_pack_type', 'some-uuid');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid pack type. Must be behavior or resource.');
        });
    });

    describe('sendServerCommand when process not active', () => {
        test('should return graceful failure message when server process is inactive', async () => {
            const result = await backend.sendServerCommand('list');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Server console not available.');
        });
    });
});
