import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Backup Restoration Tests', () => {
    let testDir;
    let serverDir;
    let backupDir;

    beforeAll(() => {
        testDir = path.join(os.tmpdir(), `restore-test-${Math.random().toString(36).substring(7)}`);
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

    test('restoreBackup should restore a world-specific backup', async () => {
        const worldName = 'restore_world';
        const worldPath = path.join(serverDir, 'worlds', worldName);
        fs.mkdirSync(worldPath, { recursive: true });
        fs.writeFileSync(path.join(worldPath, 'level.dat'), 'original data');

        // Create a backup
        const backupPath = await backend.backupWorld(worldName);
        expect(backupPath).toBeDefined();

        // Modify original world
        fs.writeFileSync(path.join(worldPath, 'level.dat'), 'modified data');

        // Restore
        const backupName = path.basename(backupPath);
        const result = await backend.restoreBackup(backupName);

        expect(result.success).toBe(true);
        expect(fs.readFileSync(path.join(worldPath, 'level.dat'), 'utf8')).toBe('original data');
    });

    test('restoreBackup should restore a full server backup', async () => {
        // Prepare server data
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'gamemode=survival');
        fs.mkdirSync(path.join(serverDir, 'worlds', 'full_world'), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'worlds', 'full_world', 'level.dat'), 'full data');

        // Create full backup
        const backupPath = await backend.backupServer();
        expect(backupPath).toBeDefined();

        // Modify current state
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'gamemode=creative');
        fs.rmSync(path.join(serverDir, 'worlds', 'full_world'), { recursive: true });

        // Restore
        const backupName = path.basename(backupPath);
        const result = await backend.restoreBackup(backupName);

        expect(result.success).toBe(true);
        const properties = await backend.readServerProperties();
        expect(properties['gamemode']).toBe('survival');
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'full_world', 'level.dat'))).toBe(true);
    });

    test('POST /api/backups/:backupName/restore should trigger restoration', async () => {
        const worldName = 'api_world';
        const worldPath = path.join(serverDir, 'worlds', worldName);
        fs.mkdirSync(worldPath, { recursive: true });
        fs.writeFileSync(path.join(worldPath, 'level.dat'), 'api data');

        const backupPath = await backend.backupWorld(worldName);
        const backupName = path.basename(backupPath);

        const response = await request(app)
            .post(`/api/backups/${backupName}/restore`);

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('restored successfully');
    });

    test('restoreBackup should fail for non-existent backup', async () => {
        const result = await backend.restoreBackup('non_existent_backup');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Backup not found.');
    });

    test('restoreBackup should fail for invalid backup name', async () => {
        const result = await backend.restoreBackup('../outside');
        expect(result.success).toBe(false);
        expect(result.message).toBe('Invalid backup name.');
    });
});
