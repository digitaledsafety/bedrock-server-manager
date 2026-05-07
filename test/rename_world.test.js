import { jest } from '@jest/globals';
import request from 'supertest';
import * as path from 'path';

// Mock the backend module
jest.unstable_mockModule('../minecraft_bedrock_installer_nodejs.js', () => ({
  init: jest.fn(),
  isProcessRunning: jest.fn(),
  readServerProperties: jest.fn(),
  writeServerProperties: jest.fn(),
  listWorlds: jest.fn(),
  renameWorld: jest.fn(),
  readGlobalConfig: jest.fn(),
  isValidWorldName: jest.fn(),
  log: jest.fn(),
  startAutoUpdateScheduler: jest.fn(),
  getStoredVersion: jest.fn(),
}));

// Mock the fs module
jest.unstable_mockModule('fs', () => ({
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    createWriteStream: jest.fn(() => ({ write: jest.fn() })),
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    promises: {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        truncate: jest.fn(),
        stat: jest.fn(),
        open: jest.fn(),
    }
}));

// Dynamically import the app and the mocked backend after setup
const { default: app } = await import('../app.js');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('World Rename API', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    backend.readGlobalConfig.mockResolvedValue({ uiPort: 3000 });
    backend.isValidWorldName.mockImplementation((name) => /^[a-zA-Z0-9_ -]+$/.test(name));
  });

  it('should rename a world successfully via API', async () => {
    backend.renameWorld.mockResolvedValue({ success: true, message: 'World renamed successfully.', restartRequired: false });

    const res = await request(app)
      .post('/api/rename-world')
      .send({ oldWorldName: 'OldWorld', newWorldName: 'NewWorld' });

    expect(res.statusCode).toEqual(200);
    expect(res.body).toEqual({ success: true, message: 'World renamed successfully.', restartRequired: false });
    expect(backend.renameWorld).toHaveBeenCalledWith('OldWorld', 'NewWorld');
  });

  it('should return 400 if world names are missing', async () => {
    const res = await request(app)
      .post('/api/rename-world')
      .send({ oldWorldName: 'OldWorld' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('required');
  });

  it('should return 400 if new world name is invalid', async () => {
    const res = await request(app)
      .post('/api/rename-world')
      .send({ oldWorldName: 'OldWorld', newWorldName: 'Invalid/Name' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toContain('Invalid world name format');
  });

  it('should return 400 if backend renameWorld fails', async () => {
    backend.renameWorld.mockResolvedValue({ success: false, message: 'A world with the new name already exists.' });

    const res = await request(app)
      .post('/api/rename-world')
      .send({ oldWorldName: 'OldWorld', newWorldName: 'ExistingWorld' });

    expect(res.statusCode).toEqual(400);
    expect(res.body.message).toBe('A world with the new name already exists.');
  });
});
