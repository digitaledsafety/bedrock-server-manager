import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Security and Process Management', () => {
    let testDir;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-test-'));
        backend.init({
            serverDirectory: path.join(testDir, 'server'),
            tempDirectory: path.join(testDir, 'temp'),
            backupDirectory: path.join(testDir, 'backup'),
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    describe('isProcessRunning', () => {
        it('should return true if process.kill(pid, 0) throws EPERM', async () => {
            // Mock process.kill to throw EPERM
            const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
                if (signal === 0) {
                    const err = new Error('EPERM');
                    err.code = 'EPERM';
                    throw err;
                }
            });

            // We need to set serverPID or have a server.pid file
            const serverDir = path.join(testDir, 'server');
            fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(path.join(serverDir, 'server.pid'), '1234');

            const isRunning = await backend.isProcessRunning();
            expect(isRunning).toBe(true);
            killSpy.mockRestore();
        });

        it('should return false if process.kill(pid, 0) throws ESRCH', async () => {
            const killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
                if (signal === 0) {
                    const err = new Error('ESRCH');
                    err.code = 'ESRCH';
                    throw err;
                }
            });

            const serverDir = path.join(testDir, 'server');
            fs.mkdirSync(serverDir, { recursive: true });
            fs.writeFileSync(path.join(serverDir, 'server.pid'), '1234');

            const isRunning = await backend.isProcessRunning();
            expect(isRunning).toBe(false);
            // Check if stale PID file was removed
            expect(fs.existsSync(path.join(serverDir, 'server.pid'))).toBe(false);
            killSpy.mockRestore();
        });
    });

    describe('extractFiles Zip Slip protection', () => {
        it('should skip entries that attempt Zip Slip', async () => {
            const zipPath = path.join(testDir, 'malicious.zip');
            const extractPath = path.join(testDir, 'extract');
            fs.mkdirSync(extractPath, { recursive: true });

            const zip = new AdmZip();
            zip.addFile('safe.txt', Buffer.from('safe content'));
            zip.addFile('../malicious.txt', Buffer.from('malicious content'));
            zip.writeZip(zipPath);

            await backend.extractFiles(zipPath, extractPath);

            expect(fs.existsSync(path.join(extractPath, 'safe.txt'))).toBe(true);
            expect(fs.existsSync(path.join(testDir, 'malicious.txt'))).toBe(false);
        });
    });
});
