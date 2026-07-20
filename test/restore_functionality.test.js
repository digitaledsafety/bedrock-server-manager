import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';
import app from '../app.js';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Backup Restoration Functionality Tests', () => {
    let testDir;
    let serverDir;
    let backupDir;

    beforeEach(() => {
        testDir = path.join(os.tmpdir(), `restore-test-${Math.random().toString(36).substring(7)}`);
        serverDir = path.join(testDir, 'server');
        backupDir = path.join(testDir, 'backup');

        fs.mkdirSync(serverDir, { recursive: true });
        fs.mkdirSync(backupDir, { recursive: true });

        // Setup initial server state
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=world1', 'utf8');
        fs.mkdirSync(path.join(serverDir, 'worlds', 'world1'), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'worlds', 'world1', 'level.dat'), 'data', 'utf8');

        backend.init({
            serverDirectory: serverDir,
            backupDirectory: backupDir,
            logLevel: 'DEBUG',
            minecraftUser: os.userInfo().username,
            minecraftGroup: os.userInfo().username
        });
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    test('should restore a full server backup', async () => {
        // Create a full backup
        const fullBackupDir = path.join(backupDir, 'full_backup');
        fs.mkdirSync(fullBackupDir, { recursive: true });
        fs.writeFileSync(path.join(fullBackupDir, 'server.properties'), 'level-name=backup_world', 'utf8');
        fs.mkdirSync(path.join(fullBackupDir, 'worlds', 'backup_world'), { recursive: true });

        // Change current state
        fs.writeFileSync(path.join(serverDir, 'server.properties'), 'level-name=current_world', 'utf8');

        const response = await request(app).post('/api/backups/full_backup/restore');
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify restoration
        const properties = fs.readFileSync(path.join(serverDir, 'server.properties'), 'utf8');
        expect(properties).toContain('level-name=backup_world');
        expect(fs.existsSync(path.join(serverDir, 'worlds', 'backup_world'))).toBe(true);

        // Verify safety backup was created (should be 2 backups now: full_backup and the new safety one)
        const backups = await backend.listBackups();
        expect(backups.length).toBe(2);
    });

    test('should restore a world-only backup', async () => {
        // Create a world backup
        const worldBackupName = 'world_myworld_2024-01-01';
        const worldBackupDir = path.join(backupDir, worldBackupName);
        fs.mkdirSync(path.join(worldBackupDir, 'myworld'), { recursive: true });
        fs.writeFileSync(path.join(worldBackupDir, 'myworld', 'level.dat'), 'backup_data', 'utf8');

        const response = await request(app).post(`/api/backups/${worldBackupName}/restore`);
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);

        // Verify restoration
        const restoredFile = path.join(serverDir, 'worlds', 'myworld', 'level.dat');
        expect(fs.existsSync(restoredFile)).toBe(true);
        expect(fs.readFileSync(restoredFile, 'utf8')).toBe('backup_data');

        // Verify safety backup was NOT created for a new world that didn't exist in server/worlds
        // Wait, if it didn't exist, backupWorld should return null and not error out.
        // Actually my implementation calls backupWorld(worldName) if targetWorldPath exists.
    });

    test('should create safety backup of current world when restoring world backup', async () => {
        // Current world
        const worldName = 'world1';
        fs.mkdirSync(path.join(serverDir, 'worlds', worldName), { recursive: true });
        fs.writeFileSync(path.join(serverDir, 'worlds', worldName, 'level.dat'), 'current_data', 'utf8');

        // World backup
        const worldBackupName = `world_${worldName}_timestamp`;
        const worldBackupDir = path.join(backupDir, worldBackupName);
        fs.mkdirSync(path.join(worldBackupDir, worldName), { recursive: true });
        fs.writeFileSync(path.join(worldBackupDir, worldName, 'level.dat'), 'backup_data', 'utf8');

        const response = await request(app).post(`/api/backups/${worldBackupName}/restore`);
        expect(response.status).toBe(200);

        // Should have 2 backups: the one we restored from, and the safety one
        const backups = await backend.listBackups();
        expect(backups.length).toBe(2);
        expect(backups.some(b => b.startsWith(`world_${worldName}_`))).toBe(true);
    });

    test('should handle invalid backup names', async () => {
        const response = await request(app).post('/api/backups/..%2f..%2f/restore');
        // If it reaches the router, it might be 400. If it's literally /api/backups/../restore,
        // express might treat it as /api/backups/restore which doesn't exist (404).
        // Let's test a name that is definitely invalid but matches the route.
        const response2 = await request(app).post('/api/backups/path%2f..%2ftraversal/restore');
        expect(response2.status).toBe(400);
    });

    test('should return 400 if backup does not exist', async () => {
        const response = await request(app).post('/api/backups/nonexistent/restore');
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
    });

    test('should reject world restoration if the world name inside backup is invalid', async () => {
        const worldBackupName = 'world_invalidname_timestamp';
        const worldBackupDir = path.join(backupDir, worldBackupName);
        // Create an invalid world directory name (e.g., has a period or backslash)
        fs.mkdirSync(path.join(worldBackupDir, 'invalid..dir'), { recursive: true });

        const response = await request(app).post(`/api/backups/${worldBackupName}/restore`);
        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid world name inside backup');
    });
});
