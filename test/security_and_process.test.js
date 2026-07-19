import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

// Mock dgram at the top level
const mockCreateSocket = jest.fn();
jest.unstable_mockModule('dgram', () => ({
  default: {
    createSocket: mockCreateSocket,
  },
  createSocket: mockCreateSocket,
}));

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Security and Process Management', () => {
    let tempDir;
    let serverDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-test-'));
        serverDir = path.join(tempDir, 'server');
        fs.mkdirSync(serverDir);

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: path.join(tempDir, 'temp'),
            backupDirectory: path.join(tempDir, 'backup'),
            logLevel: 'ERROR'
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe('isProcessRunning with EPERM', () => {
        it('should return true if process.kill throws EPERM', async () => {
            const pidFile = path.join(serverDir, 'server.pid');
            fs.writeFileSync(pidFile, '1234');

            const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
                if (signal === 0) {
                    const err = new Error('operation not permitted');
                    err.code = 'EPERM';
                    throw err;
                }
            });

            const isRunning = await backend.isProcessRunning();
            expect(isRunning).toBe(true);
            expect(killSpy).toHaveBeenCalledWith(1234, 0);
        });
    });

    describe('Zip Slip protection in extractFiles', () => {
        it('should prevent extraction outside the target directory', async () => {
            const zip = new AdmZip();
            zip.addFile('../malicious.txt', Buffer.from('malicious content'));
            const zipPath = path.join(tempDir, 'test.zip');
            zip.writeZip(zipPath);

            const extractPath = path.join(serverDir, 'extract');
            fs.mkdirSync(extractPath);

            try {
                await backend.extractFiles(zipPath, extractPath);
            } catch (e) {
                // It might throw or just skip
            }

            const maliciousFile = path.resolve(extractPath, '..', 'malicious.txt');
            expect(fs.existsSync(maliciousFile)).toBe(false);
        });
    });

    describe('changeOwnership validation', () => {
        it('should throw an error if user or group contains invalid characters', async () => {
            // Mock platform to non-win32 to test non-win32 paths
            const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux');

            await expect(backend.changeOwnership(serverDir, 'user; rm -rf /', 'group'))
                .rejects.toThrow('Invalid user or group for changeOwnership');

            await expect(backend.changeOwnership(serverDir, 'user', 'group\nsh'))
                .rejects.toThrow('Invalid user or group for changeOwnership');

            platformSpy.mockRestore();
        });
    });

    describe('Backup Path Traversal Protection', () => {
        it('should reject backup path traversal in deleteBackup', async () => {
            const result = await backend.deleteBackup('../traversal');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });

        it('should reject backup path traversal in restoreBackup', async () => {
            const result = await backend.restoreBackup('../traversal');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });

        it('should reject backup path traversal in exportBackup', async () => {
            const result = await backend.exportBackup('../traversal');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });

        it('should reject target path equaling backup directory in deleteBackup', async () => {
            const result = await backend.deleteBackup('.');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });

        it('should reject target path equaling backup directory in restoreBackup', async () => {
            const result = await backend.restoreBackup('.');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });

        it('should reject target path equaling backup directory in exportBackup', async () => {
            const result = await backend.exportBackup('.');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid backup name');
        });
    });

    describe('isUDPPortAvailable socket bind synchronous error leak prevention', () => {
        it('should catch synchronous bind errors and close the socket without leaking', async () => {
            // Set log level to DEBUG so we can see what is happening
            backend.init({
                serverDirectory: serverDir,
                tempDirectory: path.join(tempDir, 'temp'),
                backupDirectory: path.join(tempDir, 'backup'),
                logLevel: 'DEBUG'
            });

            // Create a dummy executable file so existsSync passes naturally on disk without hacking ESM imports
            const dummyExePath = path.join(serverDir, backend.getServerExeName());
            fs.writeFileSync(dummyExePath, 'dummy executable content');

            const mockSocket = {
                once: jest.fn(),
                bind: jest.fn().mockImplementation(() => {
                    throw new Error('Sync bind exception');
                }),
                close: jest.fn()
            };
            mockCreateSocket.mockReturnValue(mockSocket);

            // Mock process.kill to throw ESRCH to ensure that startServer doesn't think a stale PID is running
            const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
                const err = new Error('process not found');
                err.code = 'ESRCH';
                throw err;
            });

            try {
                await backend.startServer();
            } catch (e) {
                // Ignore expected startup error since we blocked bind
            }

            // Verify that createSocket was called and closed
            expect(mockCreateSocket).toHaveBeenCalled();
            expect(mockSocket.close).toHaveBeenCalled();

            killSpy.mockRestore();
        });
    });
});
