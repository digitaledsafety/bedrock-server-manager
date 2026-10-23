import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock dgram at the top level
const mockCreateSocket = jest.fn();
jest.unstable_mockModule('dgram', () => ({
  default: {
    createSocket: mockCreateSocket,
  },
  createSocket: mockCreateSocket,
}));

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Additional Defense and Validation Tests', () => {
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
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('isValidBackupName helper', () => {
        it('should validate valid backup names', () => {
            expect(backend.isValidBackupName('backup_2026-10-23T00-00-00')).toBe(true);
            expect(backend.isValidBackupName('world_test_world_2026-10-23')).toBe(true);
            expect(backend.isValidBackupName('backup-1.0.0')).toBe(true);
        });

        it('should reject invalid backup names and path traversal attempts', () => {
            expect(backend.isValidBackupName(null)).toBe(false);
            expect(backend.isValidBackupName(123)).toBe(false);
            expect(backend.isValidBackupName('')).toBe(false);
            expect(backend.isValidBackupName('../traversal')).toBe(false);
            expect(backend.isValidBackupName('folder/file')).toBe(false);
            expect(backend.isValidBackupName('folder\\file')).toBe(false);
            expect(backend.isValidBackupName('backup; rm -rf /')).toBe(false);
        });
    });

    describe('writeServerProperties error resilience', () => {
        it('should throw an error if server directory is not set', async () => {
            backend.init({
                serverDirectory: null,
                tempDirectory: path.join(tempDir, 'temp'),
                backupDirectory: backupDir,
                logLevel: 'ERROR'
            });

            await expect(backend.writeServerProperties({ 'server-name': 'Test' }))
                .rejects.toThrow('Server directory not configured.');
        });
    });

    describe('deletePack validation', () => {
        it('should reject invalid packType', async () => {
            const result = await backend.deletePack('test_world', 'invalid_type', 'uuid-123');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid pack type');
        });
    });

    describe('sendServerCommand when process is not running', () => {
        it('should return failure message if activeServerProcess is not available', async () => {
            const result = await backend.sendServerCommand('list');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Server console not available');
        });
    });

    describe('getDiskUsage handling non-existent paths', () => {
        it('should return total: 0 and available: 0 for invalid path gracefully', async () => {
            const usage = await backend.getDiskUsage(path.join(tempDir, 'non_existent_folder_xyz'));
            expect(usage).toEqual({ total: 0, available: 0 });
        });
    });
});
