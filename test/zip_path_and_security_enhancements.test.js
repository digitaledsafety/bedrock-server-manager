import { jest } from '@jest/globals';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';

describe('ZIP Entry Path and Security Enhancements', () => {
    let testDir;
    let backend;

    beforeEach(async () => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-sec-test-'));
        const serverDir = path.join(testDir, 'server');
        const tempDir = path.join(testDir, 'temp');
        const backupDir = path.join(testDir, 'backup');
        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        backend = await import('../minecraft_bedrock_installer_nodejs.js');
        backend.init({
            serverDirectory: serverDir,
            tempDirectory: tempDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        if (testDir && fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('should normalize backslashes in ZIP entry names during extractFiles', async () => {
        const zipPath = path.join(testDir, 'windows_style.zip');
        const extractPath = path.join(testDir, 'extracted');
        fs.mkdirSync(extractPath, { recursive: true });

        const zip = new AdmZip();
        zip.addFile('subfolder\\nested_file.txt', Buffer.from('hello world'));
        zip.writeZip(zipPath);

        await backend.extractFiles(zipPath, extractPath);

        const targetFile = path.join(extractPath, 'subfolder', 'nested_file.txt');
        expect(fs.existsSync(targetFile)).toBe(true);
        expect(fs.readFileSync(targetFile, 'utf8')).toBe('hello world');
    });

    it('should reject backup names containing control characters', async () => {
        const exportRes = await backend.exportBackup('backup\x00test');
        expect(exportRes.success).toBe(false);
        expect(exportRes.message).toBe('Invalid backup name.');

        const deleteRes = await backend.deleteBackup('backup\x07test');
        expect(deleteRes.success).toBe(false);
        expect(deleteRes.message).toBe('Invalid backup name.');

        const restoreRes = await backend.restoreBackup('backup\x1Ftest');
        expect(restoreRes.success).toBe(false);
        expect(restoreRes.message).toBe('Invalid backup name.');
    });

    it('should reject invalid or control character pack IDs in deletePack', async () => {
        const res = await backend.deletePack('world', 'behavior', 'invalid\x00packid');
        expect(res.success).toBe(false);
        expect(res.message).toBe('Invalid pack ID format.');
    });

    it('should return default disk usage when dirPath is invalid', async () => {
        const usage1 = await backend.getDiskUsage(null);
        expect(usage1).toEqual({ total: 0, available: 0 });

        const usage2 = await backend.getDiskUsage('');
        expect(usage2).toEqual({ total: 0, available: 0 });
    });
});
