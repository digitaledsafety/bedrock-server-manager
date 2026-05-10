import { jest } from '@jest/globals';
import request from 'supertest';
import * as fs from 'fs';
import path from 'path';
import os from 'util';

// Mock the backend
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
  init: jest.fn(),
  isProcessRunning: jest.fn(),
  startServer: jest.fn(),
  stopServer: jest.fn(),
  restartServer: jest.fn(),
  listPacks: jest.fn(),
  deletePack: jest.fn(),
  readGlobalConfig: jest.fn().mockResolvedValue({}),
  isValidWorldName: jest.fn().mockReturnValue(true),
  log: jest.fn(),
  getStoredVersion: jest.fn(),
  getConfig: jest.fn().mockReturnValue({}),
  readServerProperties: jest.fn().mockResolvedValue({}),
  listWorlds: jest.fn().mockResolvedValue(['test_world']),
  startAutoUpdateScheduler: jest.fn(),
}));

const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Pack Management API', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/worlds/:worldName/packs', () => {
        it('should return packs for a world', async () => {
            const mockPacks = {
                success: true,
                behaviorPacks: [{ pack_id: 'bp1', version: [1, 0, 0] }],
                resourcePacks: [{ pack_id: 'rp1', version: [1, 0, 0] }]
            };
            backend.listPacks.mockResolvedValue(mockPacks);

            const res = await request(app).get('/api/worlds/test_world/packs');

            expect(res.statusCode).toBe(200);
            expect(res.body).toEqual(mockPacks);
            expect(backend.listPacks).toHaveBeenCalledWith('test_world');
        });

        it('should return 400 if listing fails', async () => {
            backend.listPacks.mockResolvedValue({ success: false, message: 'World not found' });

            const res = await request(app).get('/api/worlds/unknown/packs');

            expect(res.statusCode).toBe(400);
            expect(res.body.message).toBe('World not found');
        });
    });

    describe('POST /api/delete-pack', () => {
        it('should delete a pack from a world', async () => {
            backend.deletePack.mockResolvedValue({ success: true, message: 'Pack removed' });

            const res = await request(app)
                .post('/api/delete-pack')
                .send({ worldName: 'test_world', packType: 'behavior', packId: 'bp1' });

            expect(res.statusCode).toBe(200);
            expect(res.body.success).toBe(true);
            expect(backend.deletePack).toHaveBeenCalledWith('test_world', 'behavior', 'bp1');
        });

        it('should return 400 if validation fails', async () => {
            const res = await request(app)
                .post('/api/delete-pack')
                .send({ worldName: 'test_world' }); // missing packType and packId

            expect(res.statusCode).toBe(400);
        });
    });
});
