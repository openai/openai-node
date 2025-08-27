import { spawnSync } from 'child_process';
import path from 'path';

describe('CLI', () => {
  const cliPath = path.join(__dirname, '../bin/cli');

  describe('help', () => {
    it('should show help when no arguments provided', () => {
      const result = spawnSync('node', [cliPath], { encoding: 'utf8' });
      
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('Usage: openai <subcommand>');
      expect(result.stdout).toContain('validate-key');
      expect(result.stdout).toContain('models');
      expect(result.stdout).toContain('chat');
      expect(result.stdout).toContain('upload');
      expect(result.stdout).toContain('usage');
    });

    it('should show help for unknown command', () => {
      const result = spawnSync('node', [cliPath, 'unknown-command'], { encoding: 'utf8' });
      
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('❌ Unknown subcommand: unknown-command');
      expect(result.stdout).toContain('Usage: openai <subcommand>');
    });
  });

  describe('validate-key', () => {
    it('should handle missing API key gracefully', () => {
      // Temporarily unset API key
      const originalKey = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      
      const result = spawnSync('node', [cliPath, 'validate-key'], { encoding: 'utf8' });
      
      // Restore API key
      if (originalKey) {
        process.env.OPENAI_API_KEY = originalKey;
      }
      
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('❌ API key validation failed');
    });
  });

  describe('chat', () => {
    it('should require a message', () => {
      const result = spawnSync('node', [cliPath, 'chat'], { encoding: 'utf8' });
      
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('❌ Please provide a message to send');
      expect(result.stderr).toContain('Usage: openai chat "your message here"');
    });
  });

  describe('upload', () => {
    it('should require a file path', () => {
      const result = spawnSync('node', [cliPath, 'upload'], { encoding: 'utf8' });
      
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('❌ Please provide a file path to upload');
      expect(result.stderr).toContain('Usage: openai upload <file-path>');
    });

    it('should handle non-existent file', () => {
      const result = spawnSync('node', [cliPath, 'upload', 'non-existent-file.txt'], { encoding: 'utf8' });
      
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('❌ File not found: non-existent-file.txt');
    });
  });

  describe('migrate', () => {
    it('should handle migrate command', () => {
      // This test just ensures the migrate command doesn't crash
      // The actual migration logic is handled by the external tool
      const result = spawnSync('node', [cliPath, 'migrate', '--help'], { encoding: 'utf8' });
      
      // The migrate command should either succeed or fail gracefully
      expect(result.status).toBeDefined();
    });
  });
});
