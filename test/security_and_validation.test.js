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
});
