import request from 'supertest';
import { jest } from '@jest/globals';

// Mock the backend module
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
  init: jest.fn(),
  isProcessRunning: jest.fn().mockResolvedValue(false),
  startServer: jest.fn(),
  stopServer: jest.fn(),
  restartServer: jest.fn(),
  checkAndInstall: jest.fn(),
  readServerProperties: jest.fn().mockResolvedValue({ 'level-name': 'world' }),
  writeServerProperties: jest.fn(),
  listWorlds: jest.fn().mockResolvedValue(['world']),
  activateWorld: jest.fn(),
  readGlobalConfig: jest.fn().mockResolvedValue({
    serverDirectory: './test_server',
    backupDirectory: './test_backups'
  }),
  writeGlobalConfig: jest.fn(),
  uploadPack: jest.fn(),
  startAutoUpdateScheduler: jest.fn(),
  getStoredVersion: jest.fn().mockReturnValue('1.0.0'),
  log: jest.fn(),
  isValidWorldName: jest.fn().mockReturnValue(true),
  listBackups: jest.fn().mockResolvedValue(['backup1', 'backup2']),
  deleteBackup: jest.fn().mockResolvedValue({ success: true, message: 'Deleted' }),
}));

// Dynamically import the app and the mocked backend
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Extra Features API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/backups should return list of backups', async () => {
    const response = await request(app).get('/api/backups');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.backups).toEqual(['backup1', 'backup2']);
    expect(backend.listBackups).toHaveBeenCalled();
  });

  test('POST /api/delete-backup should call backend delete', async () => {
    const response = await request(app)
      .post('/api/delete-backup')
      .send({ backupName: 'backup1' });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(backend.deleteBackup).toHaveBeenCalledWith('backup1');
  });
});
