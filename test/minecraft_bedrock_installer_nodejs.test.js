import { jest } from '@jest/globals';

// Use jest.unstable_mockModule for ES modules
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn() })),
  mkdirSync: jest.fn(), // Added mock for mkdirSync
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
    // Default mock for existsSync to false so we don't accidentally try to load non-existent files
    fs.existsSync.mockReturnValue(false);
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

    it('should return an empty object if the file does not exist', async () => {
      fs.existsSync.mockReturnValue(false);
      backend.init({ serverDirectory: '/test/server' });

      const properties = await backend.readServerProperties();

      expect(properties).toEqual({});
    });

    it('should handle empty files gracefully', async () => {
        fs.existsSync.mockImplementation((path) => path.includes('server.properties'));
        fs.promises.readFile.mockResolvedValue('');
        backend.init({ serverDirectory: '/test/server' });

        const properties = await backend.readServerProperties();

        expect(properties).toEqual({});
    });
  });

  describe('PID Persistence', () => {
    it('should load persisted PID on init', async () => {
      fs.existsSync.mockImplementation((path) => path.includes('server.pid'));
      fs.readFileSync.mockReturnValue('12345');

      const processKillSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

      backend.init({ serverDirectory: '/test/server' });

      const isRunning = await backend.isProcessRunning();

      expect(processKillSpy).toHaveBeenCalledWith(12345, 0);
      expect(isRunning).toBe(true);

      processKillSpy.mockRestore();
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

    it('should override uiPort with command line arguments', async () => {
        const mockConfig = { uiPort: 3000 };
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify(mockConfig));

        process.argv = ['node', 'script.js', '--uiPort', '4000'];

        const config = await backend.readGlobalConfig();

        expect(config.uiPort).toBe(4000);

        process.argv = [];
    });
  });
});
