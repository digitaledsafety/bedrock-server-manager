import { jest } from '@jest/globals';

// Use jest.unstable_mockModule for ES modules
jest.unstable_mockModule('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn(),
    rm: jest.fn(),
  },
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  createWriteStream: jest.fn(() => ({ write: jest.fn(), end: jest.fn(), on: jest.fn() })),
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

    it('should handle property values containing equals signs', async () => {
      const mockProperties = `
server-name=My=Server=Name
level-name=World=1
`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(mockProperties);
      backend.init({ serverDirectory: '/test/server' });

      const properties = await backend.readServerProperties();

      expect(properties).toEqual({
        'server-name': 'My=Server=Name',
        'level-name': 'World=1',
      });
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

  describe('writeServerProperties', () => {
    it('should preserve comments and order when writing', async () => {
      const originalContent = `# Comment
key1=val1
# Another comment
key2=val2`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(originalContent);
      backend.init({ serverDirectory: '/test/server' });

      await backend.writeServerProperties({ key1: 'newval1', key3: 'val3' });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/server/server.properties',
        `# Comment
key1=newval1
# Another comment
key2=val2
key3=val3
`,
        'utf8'
      );
    });

    it('should handle CRLF line endings', async () => {
      const originalContent = `key1=val1\r\nkey2=val2\r\n`;
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(originalContent);
      backend.init({ serverDirectory: '/test/server' });

      await backend.writeServerProperties({ key1: 'newval1' });

      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/server/server.properties',
        `key1=newval1\r\nkey2=val2\r\n`,
        'utf8'
      );
    });
  });

  describe('deleteWorld', () => {
    it('should not delete the active world', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue('level-name=ActiveWorld\n');
      backend.init({ serverDirectory: '/test/server' });

      const result = await backend.deleteWorld('ActiveWorld');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot delete the currently active world.');
    });

    it('should delete an inactive world', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue('level-name=OtherWorld\n');
      backend.init({ serverDirectory: '/test/server' });

      const result = await backend.deleteWorld('InactiveWorld');

      expect(result.success).toBe(true);
      expect(fs.promises.rm).toHaveBeenCalledWith(expect.stringContaining('InactiveWorld'), expect.any(Object));
    });
  });

  describe('activateWorld', () => {
    it('should update server.properties and restart server', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue('level-name=OldWorld\n');
      backend.init({ serverDirectory: '/test/server' });

      // Mock stopServer and startServer behavior (restartServer calls both)
      // Since they are async and might involve timeouts, we just care about the property update here

      const success = await backend.activateWorld('NewWorld');

      expect(success).toBe(true);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/server/server.properties',
        expect.stringContaining('level-name=NewWorld'),
        'utf8'
      );
    });
  });
});
