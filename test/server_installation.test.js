import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mocking dependencies
jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  renameSync: jest.fn(),
  chmodSync: jest.fn(),
  cpSync: jest.fn(),
  rmSync: jest.fn(),
  createWriteStream: jest.fn(() => {
    const stream = new EventEmitter();
    stream.write = jest.fn();
    stream.close = jest.fn((cb) => cb && cb());
    return stream;
  }),
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    readdir: jest.fn(),
    rm: jest.fn(),
    truncate: jest.fn(),
  },
}));

jest.unstable_mockModule('https', () => ({
  default: {
    get: jest.fn(),
    request: jest.fn(),
  },
}));

jest.unstable_mockModule('os', () => ({
  default: {
    platform: jest.fn(),
  },
}));

jest.unstable_mockModule('child_process', () => ({
  spawn: jest.fn((cmd, args, options) => {
    const mockProcess = new EventEmitter();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stdin = { write: jest.fn() };
    mockProcess.unref = jest.fn();
    mockProcess.pid = 12345;

    if (cmd === 'chown') {
      process.nextTick(() => {
        mockProcess.emit('close', 0);
      });
    }

    return mockProcess;
  }),
  exec: jest.fn(),
}));

// Mock adm-zip
const mockExtractAllTo = jest.fn();
jest.unstable_mockModule('adm-zip', () => ({
  default: jest.fn().mockImplementation(() => ({
    extractAllTo: mockExtractAllTo,
    getEntries: jest.fn(() => []),
    readAsText: jest.fn(),
  })),
}));

// Import modules after mocks are defined
const fs = await import('fs');
const https = (await import('https')).default;
const os = (await import('os')).default;
const child_process = await import('child_process');
const AdmZip = (await import('adm-zip')).default;
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Server Installation and Type Verification', () => {
  let consoleLogSpy;

  beforeAll(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getServerExeName', () => {
    it('should return bedrock_server.exe for Windows (bedrock type)', () => {
      os.platform.mockReturnValue('win32');
      backend.init({ serverType: 'bedrock' });
      expect(backend.getServerExeName()).toBe('bedrock_server.exe');
    });

    it('should return bedrock_server for Linux (bedrock type)', () => {
      os.platform.mockReturnValue('linux');
      backend.init({ serverType: 'bedrock' });
      expect(backend.getServerExeName()).toBe('bedrock_server');
    });

    it('should return bedrock_server.exe for Windows (bedrock_education type)', () => {
      os.platform.mockReturnValue('win32');
      backend.init({ serverType: 'bedrock_education' });
      expect(backend.getServerExeName()).toBe('bedrock_server.exe');
    });

    it('should return bedrock_server_edu for Linux (bedrock_education type)', () => {
      os.platform.mockReturnValue('linux');
      backend.init({ serverType: 'bedrock_education' });
      expect(backend.getServerExeName()).toBe('bedrock_server_edu');
    });
  });

  describe('getLatestVersion', () => {
    it('should fetch the correct download type for bedrock on Linux', async () => {
      os.platform.mockReturnValue('linux');
      backend.init({ serverType: 'bedrock' });

      const mockApiResponse = {
        result: {
          links: [
            { downloadType: 'serverBedrockLinux', downloadUrl: 'https://example.com/bedrock-server-1.20.1.zip' },
          ],
        },
      };

      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      https.get.mockImplementation((url, options, callback) => {
        if (typeof options === 'function') callback = options;
        callback(mockResponse);
        mockResponse.emit('data', JSON.stringify(mockApiResponse));
        mockResponse.emit('end');
        return new EventEmitter();
      });

      const result = await backend.getLatestVersion();
      expect(result).toEqual({
        latestVersion: '1.20.1',
        downloadUrl: 'https://example.com/bedrock-server-1.20.1.zip',
      });
      expect(https.get).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'net-secondary.web.minecraft-services.net' }),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should fetch the correct download type for bedrock_preview on Windows', async () => {
      os.platform.mockReturnValue('win32');
      backend.init({ serverType: 'bedrock_preview' });

      const mockApiResponse = {
        result: {
          links: [
            { downloadType: 'serverBedrockPreviewWindows', downloadUrl: 'https://example.com/bedrock-server-1.21.0.zip' },
          ],
        },
      };

      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      https.get.mockImplementation((url, options, callback) => {
        if (typeof options === 'function') callback = options;
        callback(mockResponse);
        mockResponse.emit('data', JSON.stringify(mockApiResponse));
        mockResponse.emit('end');
        return new EventEmitter();
      });

      const result = await backend.getLatestVersion();
      expect(result).toEqual({
        latestVersion: '1.21.0',
        downloadUrl: 'https://example.com/bedrock-server-1.21.0.zip',
      });
    });

    it('should follow redirects and extract version for bedrock_education on Linux', async () => {
      os.platform.mockReturnValue('linux');
      backend.init({ serverType: 'bedrock_education' });

      const mockRedirectResponse = new EventEmitter();
      mockRedirectResponse.statusCode = 302;
      mockRedirectResponse.headers = { location: 'https://example.com/MinecraftEducation_Server_Linux_1.20.1.zip' };
      mockRedirectResponse.resume = jest.fn();

      https.get.mockImplementation((url, callback) => {
        callback(mockRedirectResponse);
        return new EventEmitter();
      });

      const result = await backend.getLatestVersion();
      expect(result).toEqual({
        latestVersion: '1.20.1',
        downloadUrl: 'https://example.com/MinecraftEducation_Server_Linux_1.20.1.zip',
      });
      expect(https.get).toHaveBeenCalledWith(
        new URL('https://aka.ms/downloadmee-linuxServerBeta'),
        expect.any(Function)
      );
    });
  });

  describe('extractFiles', () => {
    it('should extract files using AdmZip and set permissions on Linux', async () => {
      os.platform.mockReturnValue('linux');
      backend.init({ serverType: 'bedrock' });

      const zipPath = '/path/to/server.zip';
      const extractPath = '/path/to/extract';

      await backend.extractFiles(zipPath, extractPath);

      expect(AdmZip).toHaveBeenCalledWith(zipPath);
      expect(mockExtractAllTo).toHaveBeenCalledWith(extractPath, true);
      expect(fs.chmodSync).toHaveBeenCalledWith(
        expect.stringContaining('bedrock_server'),
        0o755
      );
    });

    it('should not set permissions on Windows', async () => {
      os.platform.mockReturnValue('win32');
      backend.init({ serverType: 'bedrock' });

      const zipPath = '/path/to/server.zip';
      const extractPath = '/path/to/extract';

      await backend.extractFiles(zipPath, extractPath);

      expect(mockExtractAllTo).toHaveBeenCalledWith(extractPath, true);
      expect(fs.chmodSync).not.toHaveBeenCalled();
    });
  });

  describe('checkAndInstall', () => {
    it('should coordinate a full installation when a new version is available', async () => {
      os.platform.mockReturnValue('linux');
      backend.init({
        serverType: 'bedrock',
        serverDirectory: '/server',
        tempDirectory: '/temp',
        backupDirectory: '/backup',
        minecraftUser: 'mc',
        minecraftGroup: 'mc'
      });

      // Mock getLatestVersion
      const mockApiResponse = {
        result: {
          links: [{ downloadType: 'serverBedrockLinux', downloadUrl: 'https://example.com/bedrock-server-1.20.2.zip' }],
        },
      };
      const mockResponse = new EventEmitter();
      mockResponse.statusCode = 200;
      https.get.mockImplementation((url, options, callback) => {
        if (typeof options === 'function') {
          callback = options;
          options = {};
        }

        const urlStr = url.toString();
        if (urlStr.includes('minecraft-services.net')) {
          callback(mockResponse);
          mockResponse.emit('data', JSON.stringify(mockApiResponse));
          mockResponse.emit('end');
        } else {
          // Mock for downloadFile
          const res = new EventEmitter();
          res.statusCode = 200;
          res.pipe = jest.fn((dest) => {
            process.nextTick(() => {
              dest.emit('finish');
            });
            return dest;
          });
          callback(res);
          // Don't emit end immediately if pipe is used, or follow standard flow
        }
        return new EventEmitter();
      });

      const existingPaths = new Set(['/temp/1.20.2/bedrock_server']);
      fs.existsSync.mockImplementation((path) => existingPaths.has(path));
      fs.mkdirSync.mockImplementation((path) => {
        existingPaths.add(path);
      });
      fs.readFileSync.mockReturnValue(''); // No stored version

      // Orchestrate successful install
      const result = await backend.checkAndInstall();

      expect(result.success).toBe(true);
      expect(result.message).toContain('1.20.2');
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('1.20.2'), { recursive: true });
      expect(mockExtractAllTo).toHaveBeenCalled();
      expect(fs.renameSync).toHaveBeenCalled();
      expect(child_process.spawn).toHaveBeenCalled(); // Should start server at the end
    });
  });
});
