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
  isValidWorldName: jest.fn((name) => !/[./\\]/.test(name)),
}));

// Mock the fs module for app.js initialization
jest.unstable_mockModule('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    promises: {
        stat: jest.fn(),
        open: jest.fn(),
    }
}));


// Dynamically import the app and the mocked backend after setup
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Extended Features API', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    backend.readGlobalConfig.mockResolvedValue({ uiPort: 3000 });
    backend.readServerProperties.mockResolvedValue({});
    backend.listWorlds.mockResolvedValue([]);
    backend.isProcessRunning.mockResolvedValue(false);
    backend.getStoredVersion.mockReturnValue('1.0.0');
  });

  describe('Backup Management', () => {
    it('GET /api/backups should return list of backups', async () => {
        const mockBackups = ['backup1', 'backup2'];
        backend.listBackups.mockResolvedValue(mockBackups);

        const res = await request(app).get('/api/backups');

        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual({ success: true, backups: mockBackups });
        expect(backend.listBackups).toHaveBeenCalled();
    });

    it('DELETE /api/backups/:backupName should call deleteBackup', async () => {
        backend.deleteBackup.mockResolvedValue({ success: true, message: 'Deleted' });

        const res = await request(app).delete('/api/backups/mybackup');

        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual({ success: true, message: 'Deleted' });
        expect(backend.deleteBackup).toHaveBeenCalledWith('mybackup');
    });

    it('DELETE /api/backups/:backupName should return 400 on failure', async () => {
        backend.deleteBackup.mockResolvedValue({ success: false, message: 'Not found' });

        const res = await request(app).delete('/api/backups/invalid');

        expect(res.statusCode).toEqual(400);
        expect(res.body).toEqual({ success: false, message: 'Not found' });
    });
  });

  describe('Player List', () => {
    it('GET /api/players should return player info', async () => {
        const mockPlayerInfo = { success: true, count: 2, max: 20, players: ['player1', 'player2'] };
        backend.getPlayers.mockResolvedValue(mockPlayerInfo);

        const res = await request(app).get('/api/players');

        expect(res.statusCode).toEqual(200);
        expect(res.body).toEqual(mockPlayerInfo);
        expect(backend.getPlayers).toHaveBeenCalled();
    });
  });

});
