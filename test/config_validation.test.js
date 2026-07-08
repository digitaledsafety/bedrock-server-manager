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
  isValidWorldName: jest.fn().mockReturnValue(true),
  getConfig: jest.fn().mockReturnValue({}),
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

describe('Config Validation', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    backend.readGlobalConfig.mockResolvedValue({
        uiPort: 3000,
        serverPortIPv4: 19132,
        serverPortIPv6: 19133,
        autoUpdateIntervalMinutes: 60
    });
  });

  it('POST /api/config should fail if uiPort is out of range', async () => {
      const res = await request(app)
          .post('/api/config')
          .send({ uiPort: 70000 });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toBe('UI Port must be between 1 and 65535.');
      expect(backend.writeGlobalConfig).not.toHaveBeenCalled();
  });

  it('POST /api/config should fail if serverPortIPv4 is invalid', async () => {
      const res = await request(app)
          .post('/api/config')
          .send({ serverPortIPv4: 'invalid' });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toBe('IPv4 Port must be between 1 and 65535.');
  });

  it('POST /api/config should fail if serverPortIPv6 is 0', async () => {
      const res = await request(app)
          .post('/api/config')
          .send({ serverPortIPv6: 0 });

      expect(res.statusCode).toEqual(400);
      expect(res.body.message).toBe('IPv6 Port must be between 1 and 65535.');
  });

  it('POST /api/config should succeed with valid ports', async () => {
      const validConfig = {
          uiPort: 8080,
          serverPortIPv4: 10000,
          serverPortIPv6: 10001
      };
      const res = await request(app)
          .post('/api/config')
          .send(validConfig);

      expect(res.statusCode).toEqual(200);
      expect(res.body.success).toBe(true);
      expect(backend.writeGlobalConfig).toHaveBeenCalled();
      const calledConfig = backend.writeGlobalConfig.mock.calls[0][0];
      expect(calledConfig.uiPort).toBe(8080);
      expect(calledConfig.serverPortIPv4).toBe(10000);
      expect(calledConfig.serverPortIPv6).toBe(10001);
  });
});
