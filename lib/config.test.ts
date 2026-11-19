import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_CONFIG_PATH, readConfig } from './config'

describe('readConfig', () => {
  let testDir: string

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'velina-config-'))
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true })
  })

  describe('configPath is not provided', () => {
    it('should read config from default path', async () => {
      await Bun.write(join(testDir, DEFAULT_CONFIG_PATH), 'port: 3000\nhost: example.com\n')

      await expect(readConfig(undefined, testDir)).resolves.toEqual({
        port: 3000,
        host: 'example.com',
      })
    })

    it('should return empty config if config file does not exist', async () => {
      await expect(readConfig(undefined, testDir)).resolves.toEqual({})
    })

    it('should throw error if config file is not valid', async () => {
      await Bun.write(join(testDir, DEFAULT_CONFIG_PATH), 'port: invalid\n')

      await expect(readConfig(undefined, testDir)).rejects.toThrow()
    })
  })

  describe('configPath is provided', () => {
    it('should read config from the provided path', async () => {
      const configPath = join(testDir, 'custom.yml')
      await Bun.write(configPath, 'var:\n  GREETING: hello\n')

      await expect(readConfig(configPath)).resolves.toEqual({
        var: {
          GREETING: 'hello',
        },
      })
    })

    it('should throw error if config file does not exist', async () => {
      const configPath = join(testDir, 'missing.yml')

      await expect(readConfig(configPath)).rejects.toThrow(
        `Config file does not exist: ${configPath}`,
      )
    })

    it('should throw error if config file is not valid', async () => {
      const configPath = join(testDir, 'invalid.yml')
      await Bun.write(configPath, 'port: invalid\n')

      await expect(readConfig(configPath)).rejects.toThrow()
    })
  })
})
