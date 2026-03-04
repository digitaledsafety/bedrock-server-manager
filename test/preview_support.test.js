import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mocking https, fs, and os before importing the backend
jest.unstable_mockModule('https', () => ({
  default: {
    get: jest.fn(),
  },
}));

jest.unstable_mockModule('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
  })),
  writeFileSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.unstable_mockModule('os', () => ({
  default: {
    platform: jest.fn(),
  },
}));

// Import modules after mocks are defined
const https = (await import('https')).default;
const os = (await import('os')).default;
const backend = await import('../minecraft_bedrock_installer_nodejs.js');

describe('Preview Server Support', () => {
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

  it('should correctly select the preview download URL for Windows', async () => {
    os.platform.mockReturnValue('win32');
    backend.init({ serverType: 'bedrock_preview', logLevel: 'DEBUG' });

    const mockApiResponse = {
      result: {
        links: [
          { downloadType: 'serverBedrockWindows', downloadUrl: 'https://example.com/bedrock-server-1.20.0.1.zip' },
          { downloadType: 'serverBedrockPreviewWindows', downloadUrl: 'https://example.com/bedrock-server-1.21.0.2.zip' },
        ],
      },
    };

    const mockResponse = new EventEmitter();
    mockResponse.statusCode = 200;

    https.get.mockImplementation((url, options, callback) => {
        if (typeof options === 'function') {
            callback = options;
        }

        callback(mockResponse);
        mockResponse.emit('data', JSON.stringify(mockApiResponse));
        mockResponse.emit('end');
        return new EventEmitter();
    });

    const result = await backend.getLatestVersion();

    expect(result).toEqual({
      latestVersion: '1.21.0.2',
      downloadUrl: 'https://example.com/bedrock-server-1.21.0.2.zip',
    });
  });

  it('should correctly select the preview download URL for Linux', async () => {
    os.platform.mockReturnValue('linux');
    backend.init({ serverType: 'bedrock_preview', logLevel: 'DEBUG' });

    const mockApiResponse = {
      result: {
        links: [
          { downloadType: 'serverBedrockLinux', downloadUrl: 'https://example.com/bedrock-server-1.20.0.1.zip' },
          { downloadType: 'serverBedrockPreviewLinux', downloadUrl: 'https://example.com/bedrock-server-1.21.0.2.zip' },
        ],
      },
    };

    const mockResponse = new EventEmitter();
    mockResponse.statusCode = 200;

    https.get.mockImplementation((url, options, callback) => {
        if (typeof options === 'function') {
            callback = options;
        }

        callback(mockResponse);
        mockResponse.emit('data', JSON.stringify(mockApiResponse));
        mockResponse.emit('end');
        return new EventEmitter();
    });

    const result = await backend.getLatestVersion();

    expect(result).toEqual({
      latestVersion: '1.21.0.2',
      downloadUrl: 'https://example.com/bedrock-server-1.21.0.2.zip',
    });
  });
});
