import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

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
});
