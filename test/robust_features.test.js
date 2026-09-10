import { jest } from '@jest/globals';
import * as backend from '../minecraft_bedrock_installer_nodejs.js';

describe('Robust features & security edge cases', () => {
    describe('Backup functions control character check', () => {
        beforeAll(() => {
            backend.init({
                backupDirectory: '/tmp/test_backups',
                serverDirectory: '/tmp/test_server'
            });
        });

        it('should reject exportBackup with control characters', async () => {
            const res = await backend.exportBackup('backup\n1');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });

        it('should reject deleteBackup with control characters', async () => {
            const res = await backend.deleteBackup('backup\r1');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });

        it('should reject restoreBackup with control characters', async () => {
            const res = await backend.restoreBackup('backup\x001');
            expect(res.success).toBe(false);
            expect(res.message).toBe('Invalid backup name.');
        });
    });

    describe('sendServerCommand control character check', () => {
        it('should reject command containing newline or control characters', async () => {
            const res = await backend.sendServerCommand('say hi\nstop');
            expect(res.success).toBe(false);
            expect(res.message).toContain('Newlines and control characters are not allowed');
        });
    });

    describe('getDiskUsage path safety', () => {
        it('should safely handle falsy or non-string dirPath without throwing', async () => {
            expect(await backend.getDiskUsage(null)).toEqual({ total: 0, available: 0 });
            expect(await backend.getDiskUsage(undefined)).toEqual({ total: 0, available: 0 });
            expect(await backend.getDiskUsage(12345)).toEqual({ total: 0, available: 0 });
            expect(await backend.getDiskUsage('')).toEqual({ total: 0, available: 0 });
        });
    });
});
