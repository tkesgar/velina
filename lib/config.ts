import * as z from 'zod'
import { YAML } from "bun"
import { resolve } from 'node:path'

const zConfigFileEntry = z.union([
  z.object({
    path: z.string(),
    content: z.union([
      z.object({
        type: z.literal('string'),
        content: z.string(),
      }),
      z.object({
        type: z.literal('cmd'),
        cmd: z.string(),
      })
    ])
  }),
  z.object({
    path: z.string(),
    cmd: z.string(),
  }),
  z.object({
    path: z.string(),
    content: z.string(),
  }),
])

const zConfigTaskEntry = z.object({
  cmd: z.string(),
  cwd: z.string(),
  env: z.record(z.string(), z.string().nullable()),
  files: z.array(zConfigFileEntry),
})

const zConfig = z.object({
  port: z.number(),
  host: z.hostname(),
  var: z.record(z.string(), z.string()),
  env: z.record(z.string(), z.string().nullable()),
  files: z.array(zConfigFileEntry),
  rootDir: z.string(),
  tasks: z.record(z.string(), zConfigTaskEntry)
}).partial();

type VelinaConfig = z.infer<typeof zConfig>;

export const DEFAULT_CONFIG_PATH = '.velina.yml'

export async function readConfig(configPath?: string, cwd = process.cwd()): Promise<VelinaConfig> {
  const path = resolve(cwd, configPath ?? DEFAULT_CONFIG_PATH)
  const file = Bun.file(path)
  let content: string

  try {
    content = await file.text()
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      if (configPath === undefined) {
        return {}
      }

      throw new Error(`Config file does not exist: ${path}`)
    }

    throw error
  }

  return zConfig.parse(YAML.parse(content))
}
