import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock fs to control what readGlobalConfig reads
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn(),
    statfs: jest.fn().mockResolvedValue({ bsize: 1024, blocks: 1000000, bavail: 800000 }),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn(), end: jest.fn() })),
  mkdirSync: jest.fn(),
}));

// Mock https to intercept the API version checks
const mockHttpsGet = jest.fn().mockImplementation((url, options, callback) => {
  const req = new EventEmitter();
  Promise.resolve().then(() => {
    req.emit('error', new Error('Mock network error'));
  });
  return req;
});

jest.unstable_mockModule('https', () => ({
  default: {
    get: mockHttpsGet,
  },
}));

const fs = await import('fs');
const https = (await import('https')).default;
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Auto-Update Scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock fs existsSync to return false so we get default configurations
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(async () => {
    // Force auto-update to be disabled for cleanup to clear any scheduled timers
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({ autoUpdateEnabled: false }));
    try {
      await backend.startAutoUpdateScheduler();
    } catch (e) {}

    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('should not schedule any timers if autoUpdateEnabled is false', async () => {
    const mockConfig = {
      autoUpdateEnabled: false,
      autoUpdateIntervalMinutes: 60,
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    await backend.startAutoUpdateScheduler();

    expect(mockHttpsGet).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('should run immediately and schedule recursive check if autoUpdateEnabled is true', async () => {
    const mockConfig = {
      autoUpdateEnabled: true,
      autoUpdateIntervalMinutes: 10,
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    await backend.startAutoUpdateScheduler();

    // checkAndInstall runs once immediately upon start, calling https.get
    expect(mockHttpsGet).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 10 * 60 * 1000);

    // Fast-forward to run the scheduled timer
    await jest.runOnlyPendingTimersAsync();

    // Check that https.get ran again (rescheduled check ran)
    expect(mockHttpsGet).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
  });

  it('should clear existing timers before starting a new one', async () => {
    const mockConfig = {
      autoUpdateEnabled: true,
      autoUpdateIntervalMinutes: 10,
    };
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    await backend.startAutoUpdateScheduler();
    expect(clearTimeoutSpy).not.toHaveBeenCalled(); // No scheduler was active prior

    // Start it again to simulate config changes/re-activation
    await backend.startAutoUpdateScheduler();
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
  });
});
