import { jest } from '@jest/globals';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import AdmZip from 'adm-zip';

import * as backend from '../minecraft_bedrock_installer_nodejs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('ZIP Path Normalization and Security Enhancements', () => {
    let tempDir;
    let serverDir;
    let backupDir;
    let tempUploadDir;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-sec-test-'));
        serverDir = path.join(tempDir, 'server');
        backupDir = path.join(tempDir, 'backup');
        tempUploadDir = path.join(tempDir, 'temp');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });
        fs.mkdirSync(tempUploadDir, { recursive: true });

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            tempDirectory: tempUploadDir,
            logLevel: 'ERROR'
        });
    });

    afterEach(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('extractFiles handles ZIP entry paths with backslashes on all platforms', async () => {
        const zip = new AdmZip();
        zip.addFile('subfolder\\nested_file.txt', Buffer.from('hello nested'));
        const zipPath = path.join(tempUploadDir, 'backslash_test.zip');
        zip.writeZip(zipPath);

        const extractPath = path.join(tempDir, 'extracted');
        await backend.extractFiles(zipPath, extractPath);

        const expectedFilePath = path.join(extractPath, 'subfolder', 'nested_file.txt');
        expect(fs.existsSync(expectedFilePath)).toBe(true);
        expect(fs.readFileSync(expectedFilePath, 'utf8')).toBe('hello nested');
    });

    test('uploadWorld handles ZIP entries with backslashes correctly', async () => {
        const zip = new AdmZip();
        zip.addFile('WorldFolder\\level.dat', Buffer.from('leveldata'));
        zip.addFile('WorldFolder\\levelname.txt', Buffer.from('BackslashWorld'));
        zip.addFile('WorldFolder\\db\\000001.ldb', Buffer.from('dbcontent'));

        const worldZipPath = path.join(tempUploadDir, 'backslash_world.mcworld');
        zip.writeZip(worldZipPath);

        const result = await backend.uploadWorld(worldZipPath, 'backslash_world.mcworld');
        expect(result.success).toBe(true);

        const worldPath = path.join(serverDir, 'worlds', 'BackslashWorld');
        expect(fs.existsSync(path.join(worldPath, 'level.dat'))).toBe(true);
        expect(fs.existsSync(path.join(worldPath, 'db', '000001.ldb'))).toBe(true);
    });

    test('uploadPack handles .mcpack entries with backslashes correctly', async () => {
        // Create a world
        const worldPath = path.join(serverDir, 'worlds', 'MyTestWorld');
        fs.mkdirSync(worldPath, { recursive: true });

        const manifest = {
            format_version: 2,
            header: {
                name: 'Backslash Pack',
                description: 'Pack with backslashes',
                uuid: '11111111-2222-3333-4444-555555555555',
                version: [1, 0, 0]
            },
            modules: [{ type: 'data', uuid: '66666666-7777-8888-9999-000000000000', version: [1, 0, 0] }]
        };

        const zip = new AdmZip();
        zip.addFile('PackSubdir\\manifest.json', Buffer.from(JSON.stringify(manifest)));
        zip.addFile('PackSubdir\\functions\\main.mcfunction', Buffer.from('say hello'));

        const packPath = path.join(tempUploadDir, 'backslash_pack.mcpack');
        zip.writeZip(packPath);

        const result = await backend.uploadPack(packPath, 'backslash_pack.mcpack', 'behavior', 'MyTestWorld');
        expect(result.success).toBe(true);

        const extractedPackFile = path.join(serverDir, 'behavior_packs', 'Backslash_Pack', 'functions', 'main.mcfunction');
        expect(fs.existsSync(extractedPackFile)).toBe(true);
    });

    test('backup operations reject names with control characters', async () => {
        const invalidName1 = 'test\nbackup';
        const invalidName2 = 'test\r\nbackup';
        const invalidName3 = 'test\x00backup';

        expect((await backend.exportBackup(invalidName1)).success).toBe(false);
        expect((await backend.exportBackup(invalidName2)).success).toBe(false);
        expect((await backend.exportBackup(invalidName3)).success).toBe(false);

        expect((await backend.deleteBackup(invalidName1)).success).toBe(false);
        expect((await backend.deleteBackup(invalidName2)).success).toBe(false);
        expect((await backend.deleteBackup(invalidName3)).success).toBe(false);

        expect((await backend.restoreBackup(invalidName1)).success).toBe(false);
        expect((await backend.restoreBackup(invalidName2)).success).toBe(false);
        expect((await backend.restoreBackup(invalidName3)).success).toBe(false);
    });
});
