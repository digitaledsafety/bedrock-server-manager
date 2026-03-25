import { jest } from '@jest/globals';

// Use jest.unstable_mockModule for ES modules
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn(),
    stat: jest.fn(),
    open: jest.fn(),
    writeFile: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn() })),
  mkdirSync: jest.fn(),
}));

// Dynamically import the modules after mocks are defined
const fs = await import('fs');
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Minecraft Bedrock Installer Backend', () => {
  let consoleLogSpy;

  beforeAll(() => {
    // Spy on console.log and silence it
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    // Restore original console.log
    consoleLogSpy.mockRestore();
  });

  // Before each test, reset the mocks
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readServerProperties', () => {
    it('should read and parse server.properties correctly', async () => {
      const mockProperties = `
# A comment
server-name=My Test Server
level-seed=12345
gamemode=survival
`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(mockProperties);

      // Initialize the backend which sets the server directory
      backend.init({ serverDirectory: '/test/server' });

      const properties = await backend.readServerProperties();

      expect(fs.promises.readFile).toHaveBeenCalledWith('/test/server/server.properties', 'utf8');
      expect(properties).toEqual({
        'server-name': 'My Test Server',
        'level-seed': '12345',
        'gamemode': 'survival',
      });
    });

    it('should correctly parse values containing = characters', async () => {
        const mockProperties = 'motd=Hello=World';
        fs.existsSync.mockReturnValue(true);
        fs.promises.readFile.mockResolvedValue(mockProperties);
        backend.init({ serverDirectory: '/test/server' });

        const properties = await backend.readServerProperties();

        expect(properties).toEqual({
            'motd': 'Hello=World',
        });
    });

    it('should return an empty object if the file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      backend.init({ serverDirectory: '/test/server' });

      const properties = await backend.readServerProperties();

      expect(properties).toEqual({});
    });

    it('should handle empty files gracefully', async () => {
        fs.existsSync.mockReturnValue(true);
        fs.promises.readFile.mockResolvedValue('');
        backend.init({ serverDirectory: '/test/server' });

        const properties = await backend.readServerProperties();

        expect(properties).toEqual({});
    });
  });

  describe('readGlobalConfig', () => {
    it('should read and parse config.json correctly', async () => {
      const mockConfig = {
        serverName: "My Custom Server",
        autoUpdateEnabled: true,
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

      const config = await backend.readGlobalConfig();

      expect(fs.readFileSync).toHaveBeenCalledWith(expect.stringContaining('config.json'), 'utf8');
      expect(config.serverName).toBe("My Custom Server");
      expect(config.autoUpdateEnabled).toBe(true);
      expect(config.logLevel).toBe("INFO");
    });

    it('should return default config if config.json does not exist', async () => {
      fs.existsSync.mockReturnValue(false);

      const config = await backend.readGlobalConfig();

      expect(config.serverName).toBe("Default Minecraft Server");
      expect(config.autoUpdateEnabled).toBe(false);
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should override config with command line arguments', async () => {
        const mockConfig = { serverName: "File Server Name" };
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        process.argv = ['node', 'script.js', '--serverName', 'CLI Server Name', '--autoUpdateEnabled', 'true'];

        const config = await backend.readGlobalConfig();

        expect(config.serverName).toBe("CLI Server Name");
        expect(config.autoUpdateEnabled).toBe(true);

        process.argv = [];
    });
  });

  describe('isValidWorldName', () => {
    it('should return true for valid world names', () => {
        expect(backend.isValidWorldName('My_World-123')).toBe(true);
        expect(backend.isValidWorldName('Standard World')).toBe(true);
    });

    it('should return false for empty or whitespace strings', () => {
        expect(backend.isValidWorldName('')).toBe(false);
        expect(backend.isValidWorldName('   ')).toBe(false);
    });

    it('should return false for invalid characters or path traversal', () => {
        expect(backend.isValidWorldName('World/../Path')).toBe(false);
        expect(backend.isValidWorldName('World.zip')).toBe(false);
        expect(backend.isValidWorldName('World@123')).toBe(false);
    });
  });

  describe('getServerLogs', () => {
      it('should return logs correctly from file', async () => {
          const mockLogContent = 'Line 1\nLine 2\nLine 3';
          const mockStats = { size: mockLogContent.length };
          const mockFileHandle = {
              read: jest.fn().mockImplementation((buffer) => {
                  buffer.write(mockLogContent);
                  return Promise.resolve({ bytesRead: mockLogContent.length });
              }),
              close: jest.fn().mockResolvedValue(undefined),
          };

          fs.existsSync.mockReturnValue(true);
          fs.promises.stat.mockResolvedValue(mockStats);
          fs.promises.open.mockResolvedValue(mockFileHandle);

          backend.init({ serverDirectory: '/test/server' });
          const logs = await backend.getServerLogs();

          expect(logs).toBe('Line 1\nLine 2\nLine 3');
      });
  });

  describe('getConfig', () => {
      it('should return the current configuration', async () => {
          const testConfig = { serverName: 'Test Config' };
          backend.init(testConfig);
          expect(backend.getConfig()).toEqual(expect.objectContaining(testConfig));
      });
  });
});
