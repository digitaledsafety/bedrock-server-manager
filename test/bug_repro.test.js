import * as backend from '../minecraft_bedrock_installer_nodejs.js';
import * as fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Bug Reproductions', () => {
    const testServerDir = path.join(__dirname, 'test_server_props');

    beforeAll(() => {
        if (!fs.existsSync(testServerDir)) {
            fs.mkdirSync(testServerDir, { recursive: true });
        }
        backend.init({
            serverDirectory: testServerDir,
            tempDirectory: path.join(__dirname, 'temp'),
            backupDirectory: path.join(__dirname, 'backup'),
            logLevel: 'ERROR'
        });
    });

    afterAll(() => {
        fs.rmSync(testServerDir, { recursive: true, force: true });
    });

    test('readServerProperties should handle values with equals signs', async () => {
        const propsContent = 'server-name=My=Server\nlevel-name=world\n';
        fs.writeFileSync(path.join(testServerDir, 'server.properties'), propsContent);

        const props = await backend.readServerProperties();
        expect(props['server-name']).toBe('My=Server');
        expect(props['level-name']).toBe('world');
    });

    test('readServerProperties should handle CRLF', async () => {
        const propsContent = 'server-name=My Server\r\nlevel-name=world\r\n';
        fs.writeFileSync(path.join(testServerDir, 'server.properties'), propsContent);

        const props = await backend.readServerProperties();
        expect(props['server-name']).toBe('My Server');
        expect(props['level-name']).toBe('world');
    });
});
