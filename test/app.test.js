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
  log: jest.fn(), // Mock the log function as well
}));

// Mock the fs module for app.js initialization
jest.unstable_mockModule('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true), // Assume temp dir exists
    mkdirSync: jest.fn(),
}));


// Dynamically import the app and the mocked backend after setup
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('API Endpoints', () => {

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    // Provide default mock implementations for a "happy path"
    backend.readGlobalConfig.mockResolvedValue({ uiPort: 3000 });
    backend.readServerProperties.mockResolvedValue({});
    backend.listWorlds.mockResolvedValue([]);
    backend.isProcessRunning.mockResolvedValue(false);
    backend.getStoredVersion.mockReturnValue('1.0.0');
  });

  describe('GET /api/status', () => {
    it('should return { status: "running" } when the server is running', async () => {
      backend.isProcessRunning.mockResolvedValue(true);

      const res = await request(app).get('/api/status');

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ status: 'running' });
      expect(backend.isProcessRunning).toHaveBeenCalledTimes(1);
    });

    it('should return { status: "stopped" } when the server is not running', async () => {
      backend.isProcessRunning.mockResolvedValue(false);

      const res = await request(app).get('/api/status');

      expect(res.statusCode).toEqual(200);
      expect(res.body).toEqual({ status: 'stopped' });
    });

    it('should return 500 if there is an error checking the status', async () => {
        backend.isProcessRunning.mockRejectedValue(new Error('Process check failed'));

        const res = await request(app).get('/api/status');

        expect(res.statusCode).toEqual(500);
        expect(res.body).toEqual({ error: 'Failed to get server status' });
    });
  });

  describe('POST /api/start', () => {
    it('should call backend.startServer and return success', async () => {
        backend.startServer.mockResolvedValue(); // Mocks a successful start

        const res = await request(app).post('/api/start');

        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual({ success: true, message: 'Server start initiated.' });
        expect(backend.startServer).toHaveBeenCalledTimes(1);
    });

    it('should return 500 if backend.startServer fails', async () => {
        backend.startServer.mockRejectedValue(new Error('Failed to launch'));

        const res = await request(app).post('/api/start');

        expect(res.statusCode).toEqual(500);
        expect(res.body).toEqual({ error: 'Failed to start server' });
    });
  });

});
