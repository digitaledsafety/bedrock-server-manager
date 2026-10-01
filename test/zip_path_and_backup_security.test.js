import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('ZIP Path Normalization and Backup Security Tests', () => {
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

    describe('ZIP Entry Backslash Normalization', () => {
        test('uploadWorld handles zip files created with Windows backslashes', async () => {
            const zip = new AdmZip();
            // Add entries with backslashes
            zip.addFile('my_win_world\\level.dat', Buffer.from('level_data'));
            zip.addFile('my_win_world\\levelname.txt', Buffer.from('Windows World'));

            const zipPath = path.join(tempDir, 'win_world.mcworld');
            zip.writeZip(zipPath);

            const result = await backend.uploadWorld(zipPath, 'win_world.mcworld');
            expect(result.success).toBe(true);
            expect(result.worldName).toBe('Windows World');

            const extractedLevelDat = path.join(serverDir, 'worlds', 'Windows World', 'level.dat');
            expect(fs.existsSync(extractedLevelDat)).toBe(true);
            expect(fs.readFileSync(extractedLevelDat, 'utf8')).toBe('level_data');
        });

        test('uploadPack handles .mcpack created with Windows backslashes', async () => {
            const worldName = 'test_world';
            await backend.createWorld(worldName);

            const manifest = {
                header: {
                    name: 'Windows Pack',
                    uuid: 'win-pack-uuid-123',
                    version: [1, 0, 0]
                },
                modules: [{ type: 'data' }]
            };

            const zip = new AdmZip();
            zip.addFile('pack_folder\\manifest.json', Buffer.from(JSON.stringify(manifest)));
            zip.addFile('pack_folder\\functions\\test.mcfunction', Buffer.from('say hello'));

            const zipPath = path.join(tempDir, 'win_pack.mcpack');
            zip.writeZip(zipPath);

            const result = await backend.uploadPack(zipPath, 'win_pack.mcpack', null, worldName);
            expect(result.success).toBe(true);

            const packPath = path.join(serverDir, 'behavior_packs', 'Windows_Pack', 'functions', 'test.mcfunction');
            expect(fs.existsSync(packPath)).toBe(true);
            expect(fs.readFileSync(packPath, 'utf8')).toBe('say hello');
        });
    });

    describe('Control Character Rejection in Backup and Pack Operations', () => {
        test('exportBackup rejects backup names with newline or control characters', async () => {
            const badName = 'backup_2026\r\nHeader-Injection: evil';
            const result = await backend.exportBackup(badName);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });

        test('deleteBackup rejects backup names with control characters', async () => {
            const badName = 'backup_\x00_null';
            const result = await backend.deleteBackup(badName);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });

        test('restoreBackup rejects backup names with control characters', async () => {
            const badName = 'world_test\n_backup';
            const result = await backend.restoreBackup(badName);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid backup name.');
        });

        test('deletePack rejects packId with control characters or invalid types', async () => {
            const worldName = 'test_world';
            await backend.createWorld(worldName);

            let result = await backend.deletePack(worldName, 'behavior', 'uuid\nwith\nnewlines');
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid pack ID.');

            result = await backend.deletePack(worldName, 'behavior', null);
            expect(result.success).toBe(false);
            expect(result.message).toBe('Invalid pack ID.');
        });
    });
});
