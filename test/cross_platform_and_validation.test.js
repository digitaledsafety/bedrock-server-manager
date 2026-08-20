import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Cross-Platform ZIP handling and parameter sanitization', () => {
    let testDir;
    let serverDir;
    let backupDir;
    let tempDir;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cross-platform-test-'));
        serverDir = path.join(testDir, 'server');
        backupDir = path.join(testDir, 'backup');
        tempDir = path.join(testDir, 'temp');

        fs.mkdirSync(path.join(serverDir, 'worlds', 'test_world'), { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: tempDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should extract ZIP entries with Windows backslashes correctly', async () => {
        const zip = new AdmZip();
        // Add files using Windows style backslash separators
        zip.addFile('subfolder\\level.dat', Buffer.from('dummy level data'));
        zip.addFile('subfolder\\levelname.txt', Buffer.from('Windows_Zip_World'));

        const zipPath = path.join(tempDir, 'win_world.mcworld');
        zip.writeZip(zipPath);

        const result = await backend.uploadWorld(zipPath, 'win_world.mcworld');
        expect(result.success).toBe(true);
        expect(result.worldName).toBe('Windows_Zip_World');

        const extractedLevelDat = path.join(serverDir, 'worlds', 'Windows_Zip_World', 'level.dat');
        expect(fs.existsSync(extractedLevelDat)).toBe(true);
    });

    it('should reject invalid packType in deletePack', async () => {
        const result = await backend.deletePack('test_world', 'invalid_type', 'some-uuid');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid pack type specified.');
    });

    it('should reject control characters in backupName for exportBackup', async () => {
        const result = await backend.exportBackup('backup_name\nwith_newline');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid backup name.');
    });

    it('should reject control characters in backupName for deleteBackup', async () => {
        const result = await backend.deleteBackup('backup_name\r\nwith_crlf');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid backup name.');
    });

    it('should reject control characters in backupName for restoreBackup', async () => {
        const result = await backend.restoreBackup('backup_name\x00null_byte');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid backup name.');
    });
});
