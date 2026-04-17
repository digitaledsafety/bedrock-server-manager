import { jest } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import path from 'path';

// Mocking the backend for the app test
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
    isProcessRunning: jest.fn(),
    startServer: jest.fn(),
    stopServer: jest.fn(),
    restartServer: jest.fn(),
    checkAndInstall: jest.fn(),
    readServerProperties: jest.fn(),
    writeServerProperties: jest.fn(),
    listWorlds: jest.fn(),
    deleteWorld: jest.fn(),
    activateWorld: jest.fn(),
    readGlobalConfig: jest.fn(),
    writeGlobalConfig: jest.fn(),
    init: jest.fn(),
    startAutoUpdateScheduler: jest.fn(),
    getStoredVersion: jest.fn(),
    clearServerLogs: jest.fn(),
    createWorld: jest.fn(),
    renameWorld: jest.fn(),
    listBackups: jest.fn(),
    deleteBackup: jest.fn(),
    zipBackup: jest.fn(),
    log: jest.fn(),
    isValidWorldName: jest.fn((name) => !/[./\\]/.test(name)),
}));

// Dynamically import the app after mocks are defined
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('New Features API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // GET /api/logs/download is tested partially by its presence.
    // Mocking fs.existsSync is difficult in ES modules with Jest.

    describe('POST /api/create-world', () => {
        it('should create a world successfully', async () => {
            backend.createWorld.mockResolvedValue({ success: true, message: 'World created successfully.' });

            const response = await request(app)
                .post('/api/create-world')
                .send({ worldName: 'TestWorld' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(backend.createWorld).toHaveBeenCalledWith('TestWorld');
        });

        it('should return 400 for invalid world name', async () => {
            const response = await request(app)
                .post('/api/create-world')
                .send({ worldName: 'invalid/name' });

            expect(response.status).toBe(400);
            expect(response.body.error).toContain('Invalid worldName format');
        });

        it('should return 400 if world creation fails in backend', async () => {
            backend.createWorld.mockResolvedValue({ success: false, message: 'World already exists.' });

            const response = await request(app)
                .post('/api/create-world')
                .send({ worldName: 'ExistingWorld' });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
            expect(response.body.message).toBe('World already exists.');
        });
    });

    describe('POST /api/rename-world', () => {
        it('should rename a world successfully', async () => {
            backend.renameWorld.mockResolvedValue({ success: true, message: 'World renamed.' });

            const response = await request(app)
                .post('/api/rename-world')
                .send({ oldName: 'world1', newName: 'world2' });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(backend.renameWorld).toHaveBeenCalledWith('world1', 'world2');
        });
    });

    describe('Backup Management API', () => {
        it('GET /api/backups should list backups', async () => {
            backend.listBackups.mockResolvedValue(['backup1']);
            const response = await request(app).get('/api/backups');
            expect(response.status).toBe(200);
            expect(response.body.backups).toEqual(['backup1']);
        });

        it('DELETE /api/backups/:name should delete a backup', async () => {
            backend.deleteBackup.mockResolvedValue({ success: true, message: 'Deleted.' });
            const response = await request(app).delete('/api/backups/backup1');
            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(backend.deleteBackup).toHaveBeenCalledWith('backup1');
        });
    });
});
