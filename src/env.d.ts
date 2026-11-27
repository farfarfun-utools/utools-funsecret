export interface SecretEntry {
  path: string[]
  display_path: string
  gmt_create: string | null
  gmt_modified: string | null
  expire_time: number
}

export interface StoreInfo {
  backend: string
  database_url: string
  database_file: string | null
  secret_count: number
  cipher_key_configured: boolean
  mysql_example_url: string
}

export interface CliDetectResult {
  found: boolean
  path: string | null
  version: string | null
  supportsJson: boolean
  supportsDelete: boolean
  supportsStdin: boolean
  error: string | null
}

export interface FunSecretConfig {
  binaryPath: string
  secretPath: string
  secretUrl: string
  clipboardClearSeconds: number
  revealSeconds: number
  theme: 'system' | 'light' | 'dark'
}

export interface SyncOptions {
  dbUrl?: string
  cipherKey?: string
}

export interface EnterAction {
  code: string
  type: string
  payload: any
}

export interface FunSecretBridge {
  onEnter(callback: (action: EnterAction) => void): void
  detect(config?: Partial<FunSecretConfig>): Promise<CliDetectResult>
  info(config?: Partial<FunSecretConfig>): Promise<StoreInfo>
  list(config?: Partial<FunSecretConfig>): Promise<SecretEntry[]>
  read(config: Partial<FunSecretConfig> | undefined, categories: string[]): Promise<string>
  write(
    config: Partial<FunSecretConfig> | undefined,
    categories: string[],
    value: string,
    expire?: number | null,
  ): Promise<{ written: boolean; path: string[] }>
  remove(config: Partial<FunSecretConfig> | undefined, categories: string[]): Promise<boolean>
  clear(config?: Partial<FunSecretConfig>): Promise<number>
  sync(
    config: Partial<FunSecretConfig> | undefined,
    direction: 'save' | 'load',
    options?: SyncOptions,
  ): Promise<{ action: string; synced?: number }>
  copySecret(value: string, clearSeconds: number): void
  chooseBinary(): string | null
  chooseDirectory(): string | null
}

export interface UToolsApi {
  setExpendHeight?(height: number): void
  copyText(text: string): boolean
  hideMainWindow?(isRestorePreWindow?: boolean): void
  showNotification?(body: string): void
  isDarkColors?(): boolean
  dbStorage?: {
    getItem(key: string): any
    setItem(key: string, value: any): void
    removeItem(key: string): void
  }
}

declare global {
  interface Window {
    funsecret?: FunSecretBridge
    utools?: UToolsApi
  }
}

export {}
