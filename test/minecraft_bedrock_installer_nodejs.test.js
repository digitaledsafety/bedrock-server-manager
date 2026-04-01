import { jest } from '@jest/globals';
import { EventEmitter } from 'events';
import path from 'path';

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

jest.unstable_mockModule('https', () => ({
  default: {
    get: jest.fn(),
  },
}));

// Mock AdmZip
class MockZip {
  constructor(filePath) { this.filePath = filePath; }
  getEntries() { return []; }
}
jest.unstable_mockModule('adm-zip', () => ({
  default: MockZip
}));

// Dynamically import the modules after mocks are defined
const fs = await import('fs');
const https = (await import('https')).default;
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

  describe('getLatestVersion', () => {
    it('should extract version from redirect URL for bedrock_education', async () => {
      backend.init({ serverType: 'bedrock_education' });

      const mockRedirectUrl = 'https://example.com/MinecraftEducation_Server_Windows_1.21.1.0.zip';
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 302;
      mockResponse.headers = { location: mockRedirectUrl };
      mockResponse.resume = jest.fn();

      https.get.mockImplementation((url, callback) => {
        callback(mockResponse);
        return new EventEmitter();
      });

      const result = await backend.getLatestVersion();

      expect(result).toEqual({
        latestVersion: '1.21.1.0',
        downloadUrl: mockRedirectUrl,
      });
    });

    it('should throw error if version cannot be extracted for bedrock_education', async () => {
      backend.init({ serverType: 'bedrock_education' });

      const mockRedirectUrl = 'https://example.com/some-other-file.zip';
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 302;
      mockResponse.headers = { location: mockRedirectUrl };
      mockResponse.resume = jest.fn();

      https.get.mockImplementation((url, callback) => {
        callback(mockResponse);
        return new EventEmitter();
      });

      await expect(backend.getLatestVersion()).rejects.toThrow('Could not extract version from the redirected URL');
    });
  });

  describe('writeServerProperties', () => {
    it('should preserve comments and order when updating properties', async () => {
      const existingContent = '# Server Properties\nserver-name=Old Name\ngamemode=survival\n# Another comment\ndifficulty=easy\n';
      fs.existsSync.mockReturnValue(true);
      fs.promises.readFile.mockResolvedValue(existingContent);
      backend.init({ serverDirectory: '/test/server' });

      await backend.writeServerProperties({
        'server-name': 'New Name',
        'difficulty': 'hard',
        'new-prop': 'value'
      });

      const expectedContent = '# Server Properties\nserver-name=New Name\ngamemode=survival\n# Another comment\ndifficulty=hard\nnew-prop=value\n';
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        '/test/server/server.properties',
        expectedContent,
        'utf8'
      );
    });
  });

  describe('uploadPack', () => {
    it('should return error if server directory is not set', async () => {
      backend.init({ serverDirectory: null });
      const result = await backend.uploadPack('temp.zip', 'test.mcpack', 'behavior', 'world');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Server directory not configured.');
    });

    it('should return error if world name is invalid', async () => {
      backend.init({ serverDirectory: '/test/server' });
      const result = await backend.uploadPack('temp.zip', 'test.mcpack', 'behavior', 'invalid/world');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid world name format.');
    });

    it('should return error if world directory does not exist', async () => {
      backend.init({ serverDirectory: '/test/server' });
      fs.existsSync.mockReturnValue(false);
      const result = await backend.uploadPack('temp.zip', 'test.mcpack', 'behavior', 'world');
      expect(result.success).toBe(false);
      expect(result.message).toBe("World 'world' not found.");
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
