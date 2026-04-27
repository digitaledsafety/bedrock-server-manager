import { jest } from '@jest/globals';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock the backend module
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
  init: jest.fn(),
  isProcessRunning: jest.fn(),
  startServer: jest.fn(),
  stopServer: jest.fn(),
  restartServer: jest.fn(),
  checkAndInstall: jest.fn(),
  readServerProperties: jest.fn(),
  writeServerProperties: jest.fn(),
  listWorlds: jest.fn(),
  activateWorld: jest.fn(),
  readGlobalConfig: jest.fn().mockResolvedValue({}),
  writeGlobalConfig: jest.fn(),
  uploadPack: jest.fn().mockResolvedValue({ success: true, message: 'Mocked success' }),
  startAutoUpdateScheduler: jest.fn(),
  getStoredVersion: jest.fn(),
  log: jest.fn(),
  isValidWorldName: jest.fn().mockReturnValue(true),
}));

// Dynamically import the app and the mocked backend after setup
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Upload API Verification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    backend.listWorlds.mockResolvedValue([{ name: 'test_world', size: 1000 }]);
    backend.readGlobalConfig.mockResolvedValue({ uiPort: 3000 });
  });

  it('should successfully upload a .mcpack file', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'test_behavior.mcpack');
    if (!fs.existsSync(filePath)) {
        throw new Error(`Fixture not found: ${filePath}`);
    }

    const res = await request(app)
      .post('/api/upload-pack')
      .field('packType', 'behavior')
      .field('worldName', 'test_world')
      .attach('packFile', filePath);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(backend.uploadPack).toHaveBeenCalledWith(
      expect.stringContaining('test_behavior.mcpack'),
      'test_behavior.mcpack',
      'behavior',
      'test_world'
    );
  });

  it('should successfully upload a .mcaddon file without packType', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'test_addon.mcaddon');

    const res = await request(app)
      .post('/api/upload-pack')
      .field('worldName', 'test_world')
      .attach('packFile', filePath);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(backend.uploadPack).toHaveBeenCalledWith(
      expect.stringContaining('test_addon.mcaddon'),
      'test_addon.mcaddon',
      undefined,
      'test_world'
    );
  });

  it('should successfully upload a .mcpack file without packType (auto-detection)', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'test_behavior.mcpack');

    const res = await request(app)
      .post('/api/upload-pack')
      .field('worldName', 'test_world')
      .attach('packFile', filePath);

    expect(res.statusCode).toEqual(200);
    expect(res.body.success).toBe(true);
    expect(backend.uploadPack).toHaveBeenCalledWith(
      expect.stringContaining('test_behavior.mcpack'),
      'test_behavior.mcpack',
      undefined,
      'test_world'
    );
  });

  it('should return error if worldName is missing', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'test_behavior.mcpack');

    const res = await request(app)
      .post('/api/upload-pack')
      .field('packType', 'behavior')
      .attach('packFile', filePath);

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('World name is required');
  });

  it('should return error for invalid file extension', async () => {
    const filePath = path.join(__dirname, 'fixtures', 'manifest_behavior.json');

    const res = await request(app)
      .post('/api/upload-pack')
      .field('packType', 'behavior')
      .field('worldName', 'test_world')
      .attach('packFile', filePath);

    expect(res.statusCode).toEqual(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Only .mcpack and .mcaddon files are allowed!');
  });
});
