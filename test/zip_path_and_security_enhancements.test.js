import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import express from 'express';
import supertest from 'supertest';
import AdmZip from 'adm-zip';

import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import app from '../app.js';

const __filenameESM = fileURLToPath(import.meta.url);
const __dirnameESM = dirname(__filenameESM);

describe('ZIP Path and Security Enhancements Unit Tests', () => {
    let testDir;
    let serverDir;
    let tempDir;
    let backupDir;

    beforeEach(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-sec-test-'));
        serverDir = path.join(testDir, 'server');
        tempDir = path.join(testDir, 'temp');
        backupDir = path.join(testDir, 'backup');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(tempDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            tempDirectory: tempDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG'
        });
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    test('extractFiles handles Windows-style backslashes in ZIP entry paths', async () => {
        const zipPath = path.join(tempDir, 'win-archive.zip');
        const zip = new AdmZip();
        zip.addFile('subfolder\\nested\\file.txt', Buffer.from('hello world'));
        zip.writeZip(zipPath);

        const extractTarget = path.join(testDir, 'extracted');
        await backend.extractFiles(zipPath, extractTarget);

        const extractedFilePath = path.join(extractTarget, 'subfolder', 'nested', 'file.txt');
        expect(fs.existsSync(extractedFilePath)).toBe(true);
        expect(fs.readFileSync(extractedFilePath, 'utf8')).toBe('hello world');
    });

    test('uploadWorld handles Windows-style backslashes in .mcworld archive', async () => {
        const mcworldPath = path.join(tempDir, 'win-world.mcworld');
        const zip = new AdmZip();
        zip.addFile('MyWorld\\level.dat', Buffer.from('level data'));
        zip.addFile('MyWorld\\levelname.txt', Buffer.from('Windows World'));
        zip.writeZip(mcworldPath);

        const result = await backend.uploadWorld(mcworldPath, 'win-world.mcworld');
        expect(result.success).toBe(true);
        expect(result.worldName).toBe('Windows World');

        const levelDat = path.join(serverDir, 'worlds', 'Windows World', 'level.dat');
        expect(fs.existsSync(levelDat)).toBe(true);
    });

    test('uploadPack auto-detects and extracts .mcpack with backslashes in entry paths', async () => {
        const worldPath = path.join(serverDir, 'worlds', 'test_world');
        fs.mkdirSync(worldPath, { recursive: true });

        const mcpackPath = path.join(tempDir, 'win-pack.mcpack');
        const zip = new AdmZip();
        const manifest = {
            format_version: 2,
            header: {
                name: 'Win Pack',
                description: 'Pack with backslashes',
                uuid: 'win-pack-uuid-1234',
                version: [1, 0, 0]
            },
            modules: [{ type: 'resources', uuid: 'mod-1', version: [1, 0, 0] }]
        };
        zip.addFile('pack_folder\\manifest.json', Buffer.from(JSON.stringify(manifest)));
        zip.addFile('pack_folder\\textures\\item.png', Buffer.from('fake png'));
        zip.writeZip(mcpackPath);

        const result = await backend.uploadPack(mcpackPath, 'win-pack.mcpack', null, 'test_world');
        expect(result.success).toBe(true);

        const texturePath = path.join(serverDir, 'resource_packs', 'Win_Pack', 'textures', 'item.png');
        expect(fs.existsSync(texturePath)).toBe(true);
    });

    test('Control character rejection in backup functions', async () => {
        const badName = 'backup\x07test';

        const exportRes = await backend.exportBackup(badName);
        expect(exportRes.success).toBe(false);

        const deleteRes = await backend.deleteBackup(badName);
        expect(deleteRes.success).toBe(false);

        const restoreRes = await backend.restoreBackup(badName);
        expect(restoreRes.success).toBe(false);
    });

    test('Control character rejection in sendServerCommand and deletePack', async () => {
        const cmdRes = await backend.sendServerCommand('say hi\r\nlist');
        expect(cmdRes.success).toBe(false);

        const packRes = await backend.deletePack('test_world', 'behavior', 'bad-id\x00');
        expect(packRes.success).toBe(false);
    });

    test('POST /api/config port number validation', async () => {
        const request = supertest(app);

        const res1 = await request.post('/api/config').send({ uiPort: 70000 });
        expect(res1.status).toBe(400);
        expect(res1.body.message).toMatch(/uiPort must be a valid port number/);

        const res2 = await request.post('/api/config').send({ serverPortIPv4: -5 });
        expect(res2.status).toBe(400);
        expect(res2.body.message).toMatch(/serverPortIPv4 must be a valid port number/);

        const res3 = await request.post('/api/config').send({ serverPortIPv6: 'invalid' });
        expect(res3.status).toBe(400);
        expect(res3.body.message).toMatch(/serverPortIPv6 must be a valid port number/);
    });

    test('writeGlobalConfig handles non-string or undefined directory paths safely', async () => {
        const configWithNulls = {
            serverDirectory: null,
            tempDirectory: undefined,
            backupDirectory: 12345
        };

        await expect(backend.writeGlobalConfig(configWithNulls)).resolves.not.toThrow();
    });
});
