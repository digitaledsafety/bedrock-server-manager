import { jest } from '@jest/globals';
import request from 'supertest';

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
  readGlobalConfig: jest.fn(),
  writeGlobalConfig: jest.fn(),
  uploadPack: jest.fn(),
  startAutoUpdateScheduler: jest.fn(),
  getStoredVersion: jest.fn(),
  log: jest.fn(),
  listBackups: jest.fn(),
  deleteBackup: jest.fn(),
  getPlayers: jest.fn(),
  renameWorld: jest.fn(),
  isValidWorldName: jest.fn((name) => {
      if (!name || typeof name !== 'string') return false;
      const worldNameRegex = /^[a-zA-Z0-9_ -]+$/;
      if (name.includes('.') || name.includes('/') || name.includes('\\') || !worldNameRegex.test(name)) {
          return false;
      }
      return true;
  }),
}));

// Mock the fs module for app.js initialization
jest.unstable_mockModule('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    promises: {
        stat: jest.fn(),
        open: jest.fn(),
        unlink: jest.fn(),
    }
}));


// Dynamically import the app and the mocked backend after setup
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Rename World Validation', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    backend.readGlobalConfig.mockResolvedValue({ uiPort: 3000 });
    backend.readServerProperties.mockResolvedValue({});
    backend.listWorlds.mockResolvedValue([]);
    backend.isProcessRunning.mockResolvedValue(false);
    backend.getStoredVersion.mockReturnValue('1.0.0');
  });

  it('POST /api/rename-world should fail if oldWorldName is invalid', async () => {
      const res = await request(app)
          .post('/api/rename-world')
          .send({ oldWorldName: 'invalid/name', newWorldName: 'validname' });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toContain('Invalid oldWorldName format');
      expect(backend.renameWorld).not.toHaveBeenCalled();
  });

  it('POST /api/rename-world should fail if newWorldName is invalid', async () => {
      const res = await request(app)
          .post('/api/rename-world')
          .send({ oldWorldName: 'validname', newWorldName: 'invalid/name' });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toContain('Invalid newWorldName format');
      expect(backend.renameWorld).not.toHaveBeenCalled();
  });

  it('POST /api/rename-world should succeed if both names are valid', async () => {
      backend.renameWorld.mockResolvedValue({ success: true, message: 'Renamed' });

      const res = await request(app)
          .post('/api/rename-world')
          .send({ oldWorldName: 'oldName', newWorldName: 'newName' });

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(backend.renameWorld).toHaveBeenCalledWith('oldName', 'newName');
  });

  it('POST /api/rename-world should fail if names are missing', async () => {
      const res = await request(app)
          .post('/api/rename-world')
          .send({});

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toBe('World name is required.');
      expect(backend.renameWorld).not.toHaveBeenCalled();
  });
});
