import { jest } from '@jest/globals';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the backend for Express API tests
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
  exportBackup: jest.fn(),
  deleteBackup: jest.fn(),
  restoreBackup: jest.fn(),
}));

const { default: app } = await import('../app.js');

describe('Config Port Validation & Backup Control Character Validation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('POST /api/config port validation', () => {
        it('should accept valid port numbers (uiPort, serverPortIPv4, serverPortIPv6)', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({
                    uiPort: 8080,
                    serverPortIPv4: 19132,
                    serverPortIPv6: 19133
                });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
        });

        it('should reject non-integer uiPort', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({ uiPort: 'invalid' });

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('uiPort must be a valid port number between 1 and 65535');
        });

        it('should reject out-of-range serverPortIPv4 (0)', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({ serverPortIPv4: 0 });

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('serverPortIPv4 must be a valid port number between 1 and 65535');
        });

        it('should reject out-of-range serverPortIPv6 (65536)', async () => {
            const res = await request(app)
                .post('/api/config')
                .send({ serverPortIPv6: 65536 });

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain('serverPortIPv6 must be a valid port number between 1 and 65535');
        });
    });
});
