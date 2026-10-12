import { jest } from '@jest/globals';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the backend
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
  init: jest.fn(),
  isProcessRunning: jest.fn(),
  startServer: jest.fn(),
  stopServer: jest.fn(),
  restartServer: jest.fn(),
  sendServerCommand: jest.fn(),
  checkAndInstall: jest.fn(),
  readServerProperties: jest.fn(),
  writeServerProperties: jest.fn(),
  listWorlds: jest.fn().mockResolvedValue(['test_world']),
  activateWorld: jest.fn(),
  readGlobalConfig: jest.fn().mockResolvedValue({}),
  writeGlobalConfig: jest.fn(),
  uploadPack: jest.fn(),
  startAutoUpdateScheduler: jest.fn(),
  getStoredVersion: jest.fn(),
  log: jest.fn(),
  isValidWorldName: jest.fn().mockReturnValue(true),
  isValidBackupName: jest.fn().mockReturnValue(true),
}));

const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Security and Validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/properties validation', () => {
        it('should reject property values with newlines', async () => {
            const res = await request(app)
                .post('/api/properties')
                .send({ 'server-name': 'Malicious\nInjected=true' });

            expect(res.statusCode).toBe(400);
            expect(res.body.error).toContain('Invalid character in server property value');
            expect(backend.writeServerProperties).not.toHaveBeenCalled();
        });

        it('should reject property keys with newlines', async () => {
            const res = await request(app)
                .post('/api/properties')
                .send({ 'server\nname': 'Value' });

            expect(res.statusCode).toBe(400);
            expect(res.body.error).toContain('Invalid character in server property key');
        });
    });

    describe('POST /api/config validation', () => {
        it('should reject configuration values with control characters', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({ serverName: 'Bad\x00Name' });

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('Invalid characters in setting');
        });

        it('should reject invalid autoUpdateIntervalMinutes', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({ autoUpdateIntervalMinutes: 0 });

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toContain('Update interval must be a positive integer');
        });
    });

    describe('POST /api/command validation', () => {
        it('should reject commands containing newlines or carriage returns', async () => {
            const res = await request(app)
                .post('/api/command')
                .send({ command: 'say Hello\nstop' });

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Invalid command. Newlines and control characters are not allowed.');
            expect(backend.sendServerCommand).not.toHaveBeenCalled();
        });

        it('should reject non-string commands', async () => {
            const res = await request(app)
                .post('/api/command')
                .send({ command: 12345 });

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('Invalid command. Newlines and control characters are not allowed.');
            expect(backend.sendServerCommand).not.toHaveBeenCalled();
        });
    });

    describe('Backup Name Validation Middleware', () => {
        it('should reject invalid backup names in DELETE /api/backups/:backupName', async () => {
            backend.isValidBackupName.mockReturnValue(false);
            const res = await request(app).delete('/api/backups/invalid_backup');

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid backup name format.');
        });

        it('should reject invalid backup names in GET /api/backups/:backupName/download', async () => {
            backend.isValidBackupName.mockReturnValue(false);
            const res = await request(app).get('/api/backups/invalid_backup/download');

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid backup name format.');
        });

        it('should reject invalid backup names in POST /api/backups/:backupName/restore', async () => {
            backend.isValidBackupName.mockReturnValue(false);
            const res = await request(app).post('/api/backups/invalid_backup/restore');

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('Invalid backup name format.');
        });
    });
});
