import { jest } from '@jest/globals';

// Use jest.unstable_mockModule for ES modules
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn() })),
  mkdirSync: jest.fn(),
  rmSync: jest.fn(),
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

    it('should correctly handle property values containing equal signs', async () => {
      const mockProperties = `
server-name=My Server=Name
extra-info=key=value
`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(mockProperties);
      backend.init({ serverDirectory: '/test/server' });

      const properties = await backend.readServerProperties();

      expect(properties).toEqual({
        'server-name': 'My Server=Name',
        'extra-info': 'key=value',
      });
    });
  });

  describe('deleteWorld', () => {
    it('should delete a world directory if it is not active', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue('level-name=OtherWorld\n');
      backend.init({ serverDirectory: '/test/server' });

      const result = await backend.deleteWorld('TargetWorld');

      expect(result.success).toBe(true);
      expect(fs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('TargetWorld'),
        { recursive: true, force: true }
      );
    });

    it('should not delete a world if it is currently active', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue('level-name=ActiveWorld\n');
      backend.init({ serverDirectory: '/test/server' });

      const result = await backend.deleteWorld('ActiveWorld');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot delete the currently active world.');
      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });

  describe('writeServerProperties', () => {
    it('should update properties non-destructively, preserving comments', async () => {
      const initialProperties = `# Minecraft Server Properties
server-name=Old Name
# A comment
gamemode=survival`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(initialProperties);
      backend.init({ serverDirectory: '/test/server' });

      await backend.writeServerProperties({ 'server-name': 'New Name', 'pvp': 'false' });

      const expectedOutput = `# Minecraft Server Properties
server-name=New Name
# A comment
gamemode=survival
pvp=false
`;
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('server.properties'),
        expectedOutput,
        'utf8'
      );
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
});
