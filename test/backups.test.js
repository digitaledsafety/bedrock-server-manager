import { jest } from '@jest/globals';
import * as fs from 'fs';
import path from 'path';
import os from 'os';
import request from 'supertest';

// Mocking the backend for the app test
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
    listBackups: jest.fn(),
    deleteBackup: jest.fn(),
    log: jest.fn(),
    init: jest.fn(),
    readGlobalConfig: jest.fn().mockResolvedValue({ uiPort: 3000 }),
    writeGlobalConfig: jest.fn(),
    startAutoUpdateScheduler: jest.fn(),
    getConfig: jest.fn().mockReturnValue({}),
    readServerProperties: jest.fn().mockResolvedValue({}),
    listWorlds: jest.fn().mockResolvedValue([]),
    isProcessRunning: jest.fn().mockResolvedValue(false),
    getStoredVersion: jest.fn().mockReturnValue('1.0.0'),
    startServer: jest.fn(),
}));

const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Backups API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('GET /api/backups should return list of backups', async () => {
        const mockBackups = [
            { name: 'backup1', date: '2023-01-01T00:00:00.000Z' },
            { name: 'backup2', date: '2023-01-02T00:00:00.000Z' }
        ];
        backend.listBackups.mockResolvedValue(mockBackups);

        const response = await request(app).get('/api/backups');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.backups).toEqual(mockBackups);
        expect(backend.listBackups).toHaveBeenCalled();
    });

    test('DELETE /api/backups/:folderName should delete a backup', async () => {
        backend.deleteBackup.mockResolvedValue({ success: true, message: 'Backup deleted successfully.' });

        const response = await request(app).delete('/api/backups/backup1');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Backup deleted successfully.');
        expect(backend.deleteBackup).toHaveBeenCalledWith('backup1');
    });

    test('DELETE /api/backups/:folderName should return 400 on failure', async () => {
        backend.deleteBackup.mockResolvedValue({ success: false, message: 'Backup not found.' });

        const response = await request(app).delete('/api/backups/nonexistent');

        expect(response.status).toBe(400);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('Backup not found.');
    });
});
